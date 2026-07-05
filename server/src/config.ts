import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Minimal zero-dependency .env loader (looks next to the server root). */
function loadEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, "../.env"), resolve(here, "../../.env"), ".env"]) {
    if (!existsSync(candidate)) continue;
    for (const raw of readFileSync(candidate, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = val;
    }
    break;
  }
}

loadEnv();

export type Provider = "anthropic" | "openrouter" | "ollama";

const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
const explicit = (process.env.JARVIS_PROVIDER ?? "").toLowerCase();

/** Provider: explicit env wins, else auto-detect from key, else local Ollama. */
function resolveProvider(): Provider {
  if (explicit === "ollama" || explicit === "anthropic" || explicit === "openrouter") {
    return explicit as Provider;
  }
  if (apiKey.startsWith("sk-ant")) return "anthropic";
  if (apiKey) return "openrouter";
  return "ollama";
}

const provider = resolveProvider();

const DEFAULTS: Record<Provider, { model: string; fast: string }> = {
  anthropic: { model: "claude-opus-4-8", fast: "claude-sonnet-4-6" },
  openrouter: {
    model: "meta-llama/llama-3.3-70b-instruct:free",
    fast: "meta-llama/llama-3.3-70b-instruct:free",
  },
  ollama: { model: "llama3.1:8b", fast: "llama3.1:8b" },
};

export const config = {
  apiKey,
  provider,
  /** Ollama OpenAI-compatible endpoint (local, no key). */
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434/v1/chat/completions",
  /** Optional shared secret. If set, /chat and /reset require header x-jarvis-token. */
  apiToken: process.env.JARVIS_API_TOKEN ?? "",
  port: Number(process.env.PORT ?? 8791),
  /** Deep model for the orchestrator and hard reasoning. */
  model: process.env.JARVIS_MODEL ?? DEFAULTS[provider].model,
  /** Fast model for specialists / simple turns. */
  fastModel: process.env.JARVIS_FAST_MODEL ?? DEFAULTS[provider].fast,
  /** Coding specialist model (Ollama has a dedicated coder model). */
  coderModel:
    process.env.JARVIS_CODER_MODEL ??
    (provider === "ollama" ? "qwen2.5-coder:7b" : DEFAULTS[provider].model),
};

export function assertConfig(): void {
  if (config.provider !== "ollama" && !config.apiKey) {
    throw new Error(
      "Chave em falta. Define ANTHROPIC_API_KEY / OPENROUTER_API_KEY, ou usa JARVIS_PROVIDER=ollama.",
    );
  }
}
