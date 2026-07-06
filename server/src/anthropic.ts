import { config } from "./config.js";
import type { Tool, ToolContext, ToolSchema, Turn } from "./types.js";

// The agent loop speaks one internal format (OpenAI-style). callLLM adapts it to
// whichever provider the key belongs to: Anthropic native or OpenRouter (OpenAI).
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function log(label: string, msg: string): void {
  console.log(`  [${label}] ${msg}`);
}

interface CallOpts {
  model: string;
  messages: Turn[];
  tools?: ToolSchema[];
  maxTokens?: number;
}

/** Normalised result the agent loop understands. */
interface LLMResult {
  text: string;
  toolCalls: { id: string; name: string; args: any }[];
  done: boolean;
}

function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new Error(`LLM inacessível (rede/timeout): ${e instanceof Error ? e.message : String(e)}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      await sleep(retryAfter > 0 ? retryAfter : backoff(attempt));
      continue;
    }
    return res;
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM: falha após retries.");
}

// ---------- OpenRouter (OpenAI format) ----------

function toFunctionTools(tools: ToolSchema[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

async function callOpenAICompatible(
  opts: CallOpts,
  url: string,
  extraHeaders: Record<string, string>,
  label: string,
): Promise<LLMResult> {
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    messages: opts.messages,
    ...(opts.tools?.length ? { tools: toFunctionTools(opts.tools), tool_choice: "auto" } : {}),
  });
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body,
  });
  if (!res.ok) throw new Error(`${label} ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  if (data.usage) {
    log("usage", `${opts.model}: in=${data.usage.prompt_tokens} out=${data.usage.completion_tokens}`);
  }
  const choice = data.choices?.[0];
  const msg = choice?.message ?? {};
  return {
    text: msg.content ?? "",
    toolCalls: (msg.tool_calls ?? []).map((c: any) => ({
      id: c.id,
      name: c.function?.name,
      args: safeParse(c.function?.arguments),
    })),
    done: choice?.finish_reason !== "tool_calls",
  };
}

// ---------- Anthropic (native messages format) ----------

export function toAnthropicMessages(messages: Turn[]): { system: string; msgs: any[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content ?? "")
    .join("\n");

  const msgs: any[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content ?? "" };
      const last = msgs[msgs.length - 1];
      // Anthropic groups all tool_results for one assistant turn in a single user msg.
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        msgs.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (m.role === "assistant") {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function?.name,
          input: safeParse(tc.function?.arguments),
        });
      }
      msgs.push({ role: "assistant", content: blocks.length ? blocks : (m.content ?? "") });
      continue;
    }

    msgs.push({ role: "user", content: m.content ?? "" });
  }
  return { system, msgs };
}

async function callAnthropic(opts: CallOpts): Promise<LLMResult> {
  const { system, msgs } = toAnthropicMessages(opts.messages);
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    ...(system ? { system } : {}),
    messages: msgs,
    ...(opts.tools?.length
      ? {
          tools: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
        }
      : {}),
  });
  const res = await fetchWithRetry(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body,
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  if (data.usage) {
    log("usage", `${opts.model}: in=${data.usage.input_tokens} out=${data.usage.output_tokens}`);
  }
  const content: any[] = data.content ?? [];
  return {
    text: content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
    toolCalls: content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
    done: data.stop_reason !== "tool_use",
  };
}

function safeParse(s: any): any {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

async function callLLM(opts: CallOpts): Promise<LLMResult> {
  if (config.provider === "anthropic") return callAnthropic(opts);
  if (config.provider === "ollama") {
    return callOpenAICompatible(opts, config.ollamaUrl, {}, "Ollama");
  }
  if (!config.apiKey) throw new Error("Chave OpenRouter em falta no servidor.");
  return callOpenAICompatible(
    opts,
    OPENROUTER_URL,
    { authorization: `Bearer ${config.apiKey}`, "x-title": "Jarvis" },
    "OpenRouter",
  );
}

// ---------- Agent loop (provider-agnostic) ----------

interface RunOpts {
  label: string;
  system: string;
  model: string;
  tools: Tool[];
  messages: Turn[];
  ctx: ToolContext;
  maxSteps?: number;
}

function emitTextChunks(ctx: ToolContext, agent: string, text: string): void {
  const sink = ctx.events?.text;
  if (!sink) return;
  const chunks = text.match(/\S+\s*/g) ?? [text];
  for (const chunk of chunks) {
    if (chunk) sink({ agent, text: chunk });
  }
}

export async function runAgent(opts: RunOpts): Promise<string> {
  const schemas: ToolSchema[] = opts.tools.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
  const messages: Turn[] = [{ role: "system", content: opts.system }, ...opts.messages];
  const maxSteps = opts.maxSteps ?? 10;

  for (let step = 0; step < maxSteps; step++) {
    const result = await callLLM({ model: opts.model, messages, tools: schemas });

    if (result.done || result.toolCalls.length === 0) {
      const finalText = result.text.trim() || "(sem resposta)";
      if (opts.label === "orchestrator") emitTextChunks(opts.ctx, opts.label, finalText);
      return finalText;
    }

    // Record the assistant's tool-call turn in our internal (OpenAI) format.
    messages.push({
      role: "assistant",
      content: result.text || null,
      tool_calls: result.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
      })),
    });

    for (const call of result.toolCalls) {
      const tool = opts.tools.find((t) => t.name === call.name);
      let out: string;
      opts.ctx.events?.toolStart?.({ agent: opts.label, tool: call.name });
      try {
        out = tool ? String(await tool.run(call.args, opts.ctx)) : `Tool desconhecida: ${call.name}`;
      } catch (e) {
        out = `Erro na tool ${call.name}: ${e instanceof Error ? e.message : String(e)}`;
      }
      log(opts.label, `tool ${call.name} -> ${out.slice(0, 100).replace(/\n/g, " ")}`);
      opts.ctx.events?.toolResult?.({ agent: opts.label, tool: call.name, output: out });
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }
  }

  const limitReply = "Atingi o limite de passos sem concluir. Tenta reformular.";
  if (opts.label === "orchestrator") emitTextChunks(opts.ctx, opts.label, limitReply);
  return limitReply;
}
