export type Role = "system" | "user" | "assistant" | "tool";

/** A message in the OpenAI / OpenRouter chat-completions format. */
export interface Turn {
  role: Role;
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

/** Schema half of a tool definition (JSON Schema for the inputs). */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Runtime context handed to every tool invocation. */
export interface ToolContext {
  sessionId: string;
  memory: import("./memory.js").Memory;
  vectorStore: import("./vector-store.js").SqliteVectorStore;
  knowledgeStore: import("./vector-store.js").SqliteVectorStore;
  /** Exact user message for gates that must not be satisfiable by the model alone. */
  userMessage?: string;
  events?: AgentEventSink;
}

/** A tool = schema + executable implementation. */
export interface Tool extends ToolSchema {
  run: (input: any, ctx: ToolContext) => Promise<string> | string;
}

export interface AgentSpec {
  name: string;
  description: string;
  system: string;
  model: string;
  toolNames: string[];
}

export interface AgentEventSink {
  text?: (event: { agent: string; text: string }) => void;
  toolStart?: (event: { agent: string; tool: string }) => void;
  toolResult?: (event: { agent: string; tool: string; output: string }) => void;
}
