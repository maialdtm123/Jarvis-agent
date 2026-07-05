import { useEffect, useRef, useState } from "react";
import "./App.css";
import { PROVIDERS, type ChatMessage, type Provider } from "./types";
import { jarvisHealth, jarvisReset, sendToProvider } from "./api";

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
  const [online, setOnline] = useState<boolean | null>(null);
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

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);

    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);

    try {
      const reply = await sendToProvider(provider, next, SESSION_ID);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
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
              {busy && (
                <div className="bubble assistant">
                  <div className="who">Jarvis</div>
                  <div className="typing">
                    <span /> <span /> <span />
                  </div>
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
        ) : (
          <Placeholder view={view} />
        )}
      </main>
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
