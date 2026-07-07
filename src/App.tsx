import { useEffect, useRef, useState } from "react";
import "./App.css";
import { PROVIDERS, type ChatMessage, type Provider } from "./types";
import {
  jarvisHealth,
  jarvisLogs,
  jarvisMemory,
  jarvisReset,
  jarvisWipe,
  sendToProvider,
  streamJarvisAgent,
  type MemorySnapshot,
  type TraceRun,
} from "./api";

type View = "chat" | "agents" | "memory" | "logs" | "settings";

const SESSION_ID = "default";
const STORAGE_KEY = "jarvis.chat.v1";

const GREETING: ChatMessage = {
  role: "assistant",
  content: "Olá Lauro. Jarvis online. Diz o que precisas — escolhe o cérebro em cima.",
};

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ChatMessage[];
  } catch {
    /* ignore corrupt storage */
  }
  return [GREETING];
}

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [provider, setProvider] = useState<Provider>("jarvis");
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [traces, setTraces] = useState<TraceRun[]>([]);
  const [memorySnapshot, setMemorySnapshot] = useState<MemorySnapshot | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* storage cheio ou indisponível — ignora */
    }
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-crescimento do textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    let alive = true;
    const ping = () => jarvisHealth().then((ok) => alive && setOnline(ok)).catch(() => {});
    ping();
    const t = setInterval(ping, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function refreshPanel(target: View = view) {
    if (target !== "logs" && target !== "memory") return;
    setPanelLoading(true);
    setPanelError(null);
    try {
      if (target === "logs") {
        setTraces(await jarvisLogs(50));
      } else {
        setMemorySnapshot(await jarvisMemory());
      }
    } catch (e) {
      setPanelError(String(e));
    } finally {
      setPanelLoading(false);
    }
  }

  useEffect(() => {
    if (view === "logs" || view === "memory") {
      void refreshPanel(view);
    }
  }, [view]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);

    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setLiveTools([]);

    try {
      if (provider === "jarvis") {
        const assistantIndex = next.length;
        setMessages([...next, { role: "assistant", content: "" }]);
        const finalReply = await streamJarvisAgent(text, SESSION_ID, {
          onToken: (chunk) => {
            setMessages((prev) =>
              prev.map((message, index) =>
                index === assistantIndex
                  ? { ...message, content: `${message.content}${chunk}` }
                  : message,
              ),
            );
          },
          onToolEvent: (event) => {
            const marker =
              event.type === "tool_start"
                ? `${event.agent}: ${event.tool}`
                : `${event.agent}: ${event.tool} ok`;
            setLiveTools((prev) => [...prev.slice(-3), marker]);
          },
        });
        setMessages((prev) =>
          prev.map((message, index) =>
            index === assistantIndex ? { ...message, content: finalReply } : message,
          ),
        );
      } else {
        const reply = await sendToProvider(provider, next, SESSION_ID);
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setLiveTools([]);
    }
  }

  async function clearChat() {
    setMessages([GREETING]);
    setError(null);
    // Limpa também a memória de conversa no servidor (só relevante para o Jarvis Agent).
    try {
      await jarvisReset(SESSION_ID);
    } catch {
      /* servidor offline — a limpeza local já aconteceu */
    }
  }

  async function wipeMemory() {
    const confirmed = window.confirm(
      "Apagar toda a memória do Jarvis? Esta ação remove factos e conversas e não pode ser anulada.",
    );
    if (!confirmed) return;

    setError(null);
    try {
      const ok = await jarvisWipe();
      if (!ok) throw new Error("O servidor recusou apagar a memória.");
      setMessages([GREETING]);
    } catch (e) {
      setError(String(e));
    }
  }

  const nav: { id: View; label: string; icon: string }[] = [
    { id: "chat", label: "Chat", icon: "💬" },
    { id: "agents", label: "Agentes", icon: "🤖" },
    { id: "memory", label: "Memória", icon: "🧠" },
    { id: "logs", label: "Logs", icon: "📜" },
    { id: "settings", label: "Configurações", icon: "⚙️" },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-orb" />
          <div>
            <h1>JARVIS</h1>
            <small>uso pessoal · Lauro</small>
          </div>
        </div>

        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => setView(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        <div className="status">
          <span className={`dot ${online ? "up" : online === false ? "down" : ""}`} />
          {online == null ? "a ligar…" : online ? "cloud online" : "cloud offline"}
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div className="providers">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`pill ${provider === p.id ? "active" : ""}`}
                title={p.hint}
                onClick={() => setProvider(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={clearChat} title="Limpar conversa">
            Limpar
          </button>
          <button className="ghost" onClick={wipeMemory} title="Apagar toda a memória">
            Apagar memória
          </button>
          {(view === "logs" || view === "memory") && (
            <button className="ghost" onClick={() => void refreshPanel()} title="Atualizar dados">
              Atualizar
            </button>
          )}
        </header>

        {view === "chat" ? (
          <>
            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role}`}>
                  <div className="who">{m.role === "user" ? "Tu" : "Jarvis"}</div>
                  <div className="text">{m.content}</div>
                </div>
              ))}
              {busy && (provider !== "jarvis" || liveTools.length > 0) && (
                <div className="bubble assistant">
                  <div className="who">Jarvis</div>
                  {provider === "jarvis" && liveTools.length ? (
                    <div className="tool-stream">
                      {liveTools.map((tool, i) => (
                        <span key={`${tool}-${i}`}>{tool}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="typing">
                      <span /> <span /> <span />
                    </div>
                  )}
                </div>
              )}
              {error && <div className="error">⚠️ {error}</div>}
              <div ref={endRef} />
            </div>

            <div className="input-area">
              <textarea
                ref={taRef}
                placeholder="Escreve aqui…  (Enter envia, Shift+Enter nova linha)"
                value={input}
                rows={1}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className="send" onClick={send} disabled={busy || !input.trim()}>
                {busy ? "…" : "Enviar"}
              </button>
            </div>
          </>
        ) : view === "logs" ? (
          <LogsView traces={traces} loading={panelLoading} error={panelError} />
        ) : view === "memory" ? (
          <MemoryView snapshot={memorySnapshot} loading={panelLoading} error={panelError} />
        ) : (
          <Placeholder view={view} />
        )}
      </main>
    </div>
  );
}

function LogsView({
  traces,
  loading,
  error,
}: {
  traces: TraceRun[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="panel-view">
      <div className="panel-title">
        <h2>Logs</h2>
        <span>{loading ? "a atualizar..." : `${traces.length} runs`}</span>
      </div>
      {error && <div className="error">⚠️ {error}</div>}
      <div className="trace-list">
        {traces.map((trace) => (
          <article key={trace.id} className="trace-row">
            <div className="trace-main">
              <span className={`trace-status ${trace.status}`}>{trace.status}</span>
              <strong>{trace.message}</strong>
              <small>
                {trace.sessionId} · {new Date(trace.startedAt).toLocaleString()} ·{" "}
                {trace.durationMs ?? 0} ms
              </small>
            </div>
            <div className="trace-events">
              {trace.events.slice(-8).map((event, index) => (
                <span key={`${trace.id}-${index}`}>
                  {event.type}
                  {event.tool ? `:${event.tool}` : ""}
                </span>
              ))}
            </div>
          </article>
        ))}
        {!loading && !traces.length && <div className="empty-state">Sem runs registados.</div>}
      </div>
    </div>
  );
}

function MemoryView({
  snapshot,
  loading,
  error,
}: {
  snapshot: MemorySnapshot | null;
  loading: boolean;
  error: string | null;
}) {
  const facts = snapshot?.facts ?? [];
  const sessions = snapshot?.sessions ?? [];
  return (
    <div className="panel-view">
      <div className="panel-title">
        <h2>Memória</h2>
        <span>
          {loading ? "a atualizar..." : `${facts.length} factos · ${sessions.length} sessões`}
        </span>
      </div>
      {error && <div className="error">⚠️ {error}</div>}
      <section className="memory-section">
        <h3>Factos</h3>
        <div className="fact-list">
          {facts.map((fact, index) => (
            <div key={`${fact}-${index}`} className="fact-item">
              {fact}
            </div>
          ))}
          {!loading && !facts.length && <div className="empty-state">Sem factos guardados.</div>}
        </div>
      </section>
      <section className="memory-section">
        <h3>Sessões</h3>
        <div className="session-list">
          {sessions.map((session) => (
            <div key={session.id} className="session-row">
              <strong>{session.id}</strong>
              <span>{session.turns} turnos</span>
              <span>{session.lastRole ?? "sem histórico"}</span>
            </div>
          ))}
          {!loading && !sessions.length && <div className="empty-state">Sem sessões guardadas.</div>}
        </div>
      </section>
    </div>
  );
}

function Placeholder({ view }: { view: View }) {
  const copy: Record<string, { title: string; body: string }> = {
    agents: {
      title: "🤖 Agentes",
      body: "Orchestrator → general · researcher · coder · memory. Geridos pelo servidor cloud (server/). Vê o /health no canto inferior da sidebar.",
    },
    memory: {
      title: "🧠 Memória",
      body: "A memória persistente vive no servidor (memory.json / store). Os agentes lêem e escrevem via tools.",
    },
    logs: {
      title: "📜 Logs",
      body: "Logs de execução dos agentes aparecem na consola do servidor. Próximo passo: streaming para a UI.",
    },
    settings: {
      title: "⚙️ Configurações",
      body: "Chaves em src-tauri/.env (ANTHROPIC_API_KEY, OPENAI_API_KEY) e JARVIS_SERVER_URL. Nunca no código.",
    },
  };
  const c = copy[view];
  return (
    <div className="placeholder">
      <h2>{c.title}</h2>
      <p>{c.body}</p>
    </div>
  );
}
