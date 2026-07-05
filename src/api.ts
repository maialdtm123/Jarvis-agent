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

export function jarvisHealth(): Promise<boolean> {
  return invoke<boolean>("jarvis_health");
}

export function jarvisReset(sessionId?: string): Promise<boolean> {
  return invoke<boolean>("jarvis_reset", { sessionId });
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
