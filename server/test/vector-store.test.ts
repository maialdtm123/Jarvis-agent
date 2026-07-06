import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteVectorStore,
  type EmbeddingProvider,
  type VectorMetadata,
} from "../src/vector-store.js";

class FakeEmbeddings implements EmbeddingProvider {
  constructor(private readonly vectors: Record<string, number[]>) {}

  async embed(text: string): Promise<number[]> {
    const vector = this.vectors[text];
    if (!vector) throw new Error(`Embedding de teste em falta: ${text}`);
    return vector;
  }
}

const temporaryDirectories: string[] = [];

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-vector-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "memory.db");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqliteVectorStore", () => {
  it("returns nearest memories with metadata and cosine scores", async () => {
    const store = new SqliteVectorStore({
      databasePath: ":memory:",
      embeddings: new FakeEmbeddings({
        "gosta de café": [1, 0, 0],
        "prefere chá": [0, 1, 0],
        "trabalha em TypeScript": [0, 0, 1],
        bebida: [0.9, 0.1, 0],
      }),
    });

    await store.upsert("gosta de café", { type: "fact" });
    await store.upsert("prefere chá", { type: "fact" });
    await store.upsert("trabalha em TypeScript", { type: "project" });

    const matches = await store.query("bebida", 2);

    expect(matches.map((match) => match.text)).toEqual(["gosta de café", "prefere chá"]);
    expect(matches[0].metadata).toEqual({ type: "fact" });
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
    store.close();
  });

  it("upserts duplicate text and persists data in one SQLite file", async () => {
    const databasePath = temporaryDatabase();
    const embeddings = new FakeEmbeddings({
      "facto persistente": [1, 0],
      consulta: [1, 0],
    });
    const first = new SqliteVectorStore({ databasePath, embeddings });

    await first.upsert("facto persistente", { version: 1 });
    await first.upsert("facto persistente", { version: 2 });
    first.close();

    const reopened = new SqliteVectorStore({ databasePath, embeddings });
    const matches = await reopened.query("consulta", 10);

    expect(matches).toHaveLength(1);
    expect(matches[0].metadata).toEqual({ version: 2 });
    reopened.close();
  });

  it("rejects vectors whose dimensions differ from the persisted store", async () => {
    const store = new SqliteVectorStore({
      databasePath: ":memory:",
      embeddings: new FakeEmbeddings({
        primeiro: [1, 0],
        incompatível: [1, 0, 0],
      }),
    });

    await store.upsert("primeiro");
    await expect(store.upsert("incompatível")).rejects.toThrow(
      "Dimensão de embedding incompatível",
    );
    store.close();
  });

  it("rejects invalid query limits before embedding", async () => {
    const embeddings: EmbeddingProvider = {
      embed: async () => {
        throw new Error("não deve ser chamado");
      },
    };
    const store = new SqliteVectorStore({ databasePath: ":memory:", embeddings });

    await expect(store.query("consulta", 0)).rejects.toThrow("k deve ser um inteiro");
    await expect(store.query("consulta", 101)).rejects.toThrow("k deve ser um inteiro");
    store.close();
  });

  it("rejects metadata that cannot be serialized", async () => {
    const store = new SqliteVectorStore({
      databasePath: ":memory:",
      embeddings: new FakeEmbeddings({ texto: [1] }),
    });
    const cyclic: VectorMetadata = {};
    cyclic.self = cyclic;

    await expect(store.upsert("texto", cyclic)).rejects.toThrow("não é serializável");
    store.close();
  });
});
