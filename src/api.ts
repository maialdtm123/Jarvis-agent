import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, Provider } from "./types";

export function askClaude(messages: ChatMessage[], model?: string): Promise<string> {
  return invoke<string>("ask_claude", { messages, model });
}

export function askOpenai(messages: ChatMessage[], model?: string): Promise<string> {
  return invoke<string>("ask_openai", { messages, model });
}

export function jarvisAgent(message: string, sessionId?: string): Promise<string> {
  return invoke<string>("jarvis_agent", { message, sessionId });
}

export interface JarvisStreamHandlers {
  onToken: (text: string) => void;
  onToolEvent?: (event: { type: "tool_start" | "tool_result"; agent: string; tool: string }) => void;
}

export interface TraceEvent {
  at: string;
  type: "start" | "token" | "tool_start" | "tool_result" | "done" | "error";
  agent?: string;
  tool?: string;
  text?: string;
  output?: string;
  error?: string;
}

export interface TraceRun {
  id: string;
  sessionId: string;
  message: string;
  stream: boolean;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "running" | "ok" | "error";
  reply?: string;
  error?: string;
  events: TraceEvent[];
}

export interface MemorySnapshot {
  facts: string[];
  sessions: Array<{ id: string; turns: number; lastRole?: string }>;
}

function jarvisServerUrl(): string {
  return (import.meta.env.VITE_JARVIS_SERVER_URL ?? "http://localhost:8791").replace(/\/+$/, "");
}

function jarvisHeaders(): Record<string, string> {
  const token = import.meta.env.VITE_JARVIS_API_TOKEN;
  return token ? { "x-jarvis-token": token } : {};
}

async function jarvisJson<T>(path: string): Promise<T> {
  const response = await fetch(`${jarvisServerUrl()}${path}`, { headers: jarvisHeaders() });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Jarvis HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function parseSseBlock(block: string): { event: string; data: any } | null {
  const event = block.match(/^event: (.+)$/m)?.[1];
  const data = block.match(/^data: (.+)$/m)?.[1];
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

export async function streamJarvisAgent(
  message: string,
  sessionId: string,
  handlers: JarvisStreamHandlers,
): Promise<string> {
  const response = await fetch(`${jarvisServerUrl()}/chat`, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
      ...jarvisHeaders(),
    },
    body: JSON.stringify({ message, sessionId, stream: true }),
  });

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Jarvis stream falhou (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const parsed = parseSseBlock(block.trim());
      if (!parsed) continue;
      if (parsed.event === "token") {
        const text = String(parsed.data.text ?? "");
        reply += text;
        handlers.onToken(text);
      } else if (parsed.event === "tool_start" || parsed.event === "tool_result") {
        handlers.onToolEvent?.({
          type: parsed.event,
          agent: String(parsed.data.agent ?? ""),
          tool: String(parsed.data.tool ?? ""),
        });
      } else if (parsed.event === "done") {
        return String(parsed.data.reply ?? reply);
      } else if (parsed.event === "error") {
        throw new Error(String(parsed.data.error ?? "Erro no stream Jarvis."));
      }
    }

    if (done) break;
  }

  return reply;
}

export function jarvisHealth(): Promise<boolean> {
  return invoke<boolean>("jarvis_health");
}

export async function jarvisLogs(limit = 50): Promise<TraceRun[]> {
  const body = await jarvisJson<{ traces: TraceRun[] }>(`/logs?limit=${encodeURIComponent(limit)}`);
  return body.traces;
}

export function jarvisMemory(): Promise<MemorySnapshot> {
  return jarvisJson<MemorySnapshot>("/memory");
}

export function jarvisReset(sessionId?: string): Promise<boolean> {
  return invoke<boolean>("jarvis_reset", { sessionId });
}

export function jarvisWipe(): Promise<boolean> {
  return invoke<boolean>("jarvis_wipe");
}

/** Route a turn to the selected provider. */
export function sendToProvider(
  provider: Provider,
  history: ChatMessage[],
  sessionId: string,
): Promise<string> {
  switch (provider) {
    case "claude":
      return askClaude(history);
    case "openai":
      return askOpenai(history);
    case "jarvis":
    default: {
      const last = history[history.length - 1];
      return jarvisAgent(last?.content ?? "", sessionId);
    }
  }
}
