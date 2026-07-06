import { config } from "./config.js";

const DEFAULT_TIMEOUT_MS = 30_000;

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OllamaEmbeddingsOptions {
  url?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchFn;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Small client for Ollama's legacy single-input embeddings endpoint.
 * Keeping transport injection here makes the RAG layer deterministic in tests.
 */
export class OllamaEmbeddingsClient {
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchFn;

  constructor(options: OllamaEmbeddingsOptions = {}) {
    this.url = options.url ?? config.ollamaEmbeddingsUrl;
    this.model = options.model ?? config.embeddingModel;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.url.trim()) throw new Error("URL de embeddings Ollama em falta.");
    if (!this.model.trim()) throw new Error("Modelo de embeddings Ollama em falta.");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Timeout de embeddings deve ser um número positivo.");
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!text.trim()) throw new Error("Texto para embedding não pode estar vazio.");

    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`Ollama embeddings inacessível (rede/timeout): ${errorMessage(error)}`);
    }

    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(
        `Ollama embeddings ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`Resposta inválida do Ollama embeddings: ${errorMessage(error)}`);
    }

    const embedding =
      typeof payload === "object" && payload !== null && "embedding" in payload
        ? payload.embedding
        : undefined;
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      !embedding.every((value): value is number => typeof value === "number" && Number.isFinite(value))
    ) {
      throw new Error("Resposta do Ollama embeddings não contém um vetor numérico válido.");
    }

    return [...embedding];
  }
}

export const embeddingClient = new OllamaEmbeddingsClient();
