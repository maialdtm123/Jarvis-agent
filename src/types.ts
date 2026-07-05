export type Role = "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/** Which brain answers: the multi-agent server, or a raw model. */
export type Provider = "jarvis" | "claude" | "openai";

export interface ProviderInfo {
  id: Provider;
  label: string;
  hint: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "jarvis", label: "Jarvis Agent", hint: "Orquestrador multi-agente + tools" },
  { id: "claude", label: "Claude", hint: "Claude via OpenRouter" },
  { id: "openai", label: "GPT", hint: "GPT via OpenRouter" },
];
