import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Memory } from "../src/memory.js";
import { memoryRecall, memorySave } from "../src/tools.js";
import { SqliteVectorStore, type EmbeddingProvider } from "../src/vector-store.js";
import type { ToolContext } from "../src/types.js";

class FakeEmbeddings implements EmbeddingProvider {
  constructor(private readonly vectors: Record<string, number[]>) {}

  async embed(text: string): Promise<number[]> {
    const vector = this.vectors[text];
    if (!vector) throw new Error(`Embedding de teste em falta: ${text}`);
    return vector;
  }
}

const tempDirs: string[] = [];

function memoryPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-tools-memory-"));
  tempDirs.push(dir);
  return join(dir, "memory.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createContext(
  vectors: Record<string, number[]>,
): { memory: Memory; vectorStore: SqliteVectorStore; ctx: ToolContext } {
  const memory = new Memory(memoryPath());
  const vectorStore = new SqliteVectorStore({
    databasePath: ":memory:",
    embeddings: new FakeEmbeddings(vectors),
  });
  return { memory, vectorStore, ctx: { sessionId: "test", memory, vectorStore } };
}

describe("memory tools", () => {
  it("memory_save writes to the JSON memory store and the semantic vector store", async () => {
    const { memory, vectorStore, ctx } = createContext({
      "Gosta de café": [1, 0],
      "Gosta de café também": [1, 0],
    });

    const reply = await memorySave.run({ fact: "Gosta de café" }, ctx);
    const matches = await vectorStore.query("Gosta de café também", 5);

    expect(reply).toBe("Guardado na memória.");
    expect(memory.facts()).toEqual(["Gosta de café"]);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("Gosta de café");
    expect(matches[0].metadata).toMatchObject({ savedAt: expect.any(String) });

    vectorStore.close();
  });

  it("memory_save keeps the fact even when semantic persistence fails", async () => {
    const { memory, vectorStore, ctx } = createContext({
      "Facto resiliente": [1],
    });
    vectorStore.upsert = async () => {
      throw new Error("Ollama offline");
    };

    const reply = await memorySave.run({ fact: "Facto resiliente" }, ctx);

    expect(reply).toBe(
      "Guardado na memória (recall semântico indisponível: Ollama offline).",
    );
    expect(memory.facts()).toEqual(["Facto resiliente"]);

    vectorStore.close();
  });

  it("memory_recall returns semantic top-K results with scores", async () => {
    const { vectorStore, ctx } = createContext({
      "Gosta de café": [1, 0],
      "Prefere chá": [0.8, 0.2],
      "Trabalha em TypeScript": [0, 1],
      bebida: [1, 0],
    });

    await memorySave.run({ fact: "Gosta de café" }, ctx);
    await memorySave.run({ fact: "Prefere chá" }, ctx);
    await memorySave.run({ fact: "Trabalha em TypeScript" }, ctx);

    const reply = await memoryRecall.run({ query: "bebida" }, ctx);

    expect(reply).toBe(
      "• Gosta de café (score: 1.00)\n• Prefere chá (score: 0.97)\n• Trabalha em TypeScript (score: 0.00)",
    );

    vectorStore.close();
  });

  it("memory_recall falls back to substring recall when semantic search fails", async () => {
    const { memory, vectorStore, ctx } = createContext({
      "Gosta de TypeScript": [1],
    });
    memory.addFact("Gosta de TypeScript");
    memory.addFact("Prefere Rust");
    vectorStore.query = async () => {
      throw new Error("Ollama offline");
    };

    const reply = await memoryRecall.run({ query: "typescript" }, ctx);

    expect(reply).toBe("• Gosta de TypeScript");

    vectorStore.close();
  });
});
