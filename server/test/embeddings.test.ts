import { describe, expect, it, vi } from "vitest";
import { OllamaEmbeddingsClient } from "../src/embeddings.js";

describe("OllamaEmbeddingsClient", () => {
  it("posts the configured model and text to Ollama", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ embedding: [0.25, -0.5, 1] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new OllamaEmbeddingsClient({
      url: "http://ollama.test/api/embeddings",
      model: "test-embed",
      fetchImpl,
    });

    await expect(client.embed("memória semântica")).resolves.toEqual([0.25, -0.5, 1]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://ollama.test/api/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "test-embed", prompt: "memória semântica" }),
      }),
    );
  });

  it("reports Ollama HTTP errors with response context", async () => {
    const client = new OllamaEmbeddingsClient({
      fetchImpl: async () => new Response("model not found", { status: 404 }),
    });

    await expect(client.embed("texto")).rejects.toThrow(
      "Ollama embeddings 404: model not found",
    );
  });

  it("rejects malformed or non-finite embedding vectors", async () => {
    const client = new OllamaEmbeddingsClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ embedding: [0.1, "invalid"] }), { status: 200 }),
    });

    await expect(client.embed("texto")).rejects.toThrow("vetor numérico válido");
  });

  it("rejects empty input without making a request", async () => {
    const fetchImpl = vi.fn(async () => new Response());
    const client = new OllamaEmbeddingsClient({ fetchImpl });

    await expect(client.embed("   ")).rejects.toThrow("não pode estar vazio");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
