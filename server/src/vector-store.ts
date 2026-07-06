import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import { config } from "./config.js";
import { embeddingClient } from "./embeddings.js";

const MAX_QUERY_RESULTS = 100;

export type VectorMetadata = Record<string, unknown>;

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface VectorMatch {
  text: string;
  metadata: VectorMetadata;
  /** Cosine similarity: 1 is identical, 0 is orthogonal. */
  score: number;
  /** Raw cosine distance returned by sqlite-vec. */
  distance: number;
}

interface VectorStoreOptions {
  databasePath?: string;
  embeddings?: EmbeddingProvider;
}

interface IdRow {
  id: number | bigint;
}

interface ConfigRow {
  value: string;
}

interface MatchRow {
  text: string;
  metadata: string;
  distance: number;
}

function vectorBlob(vector: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vector).buffer);
}

function assertVector(vector: number[]): void {
  if (
    vector.length === 0 ||
    !vector.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    throw new Error("Embedding deve ser um vetor numérico finito e não vazio.");
  }
}

function parseMetadata(value: string): VectorMetadata {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as VectorMetadata)
      : {};
  } catch {
    return {};
  }
}

/** Persistent sqlite-vec store. Embeddings are generated outside SQLite and injected for testability. */
export class SqliteVectorStore {
  private readonly db: DatabaseSync;
  private readonly embeddings: EmbeddingProvider;
  private dimension?: number;

  constructor(options: VectorStoreOptions = {}) {
    const databasePath = options.databasePath ?? config.vectorDbPath;
    if (databasePath !== ":memory:" && !existsSync(dirname(databasePath))) {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.db = new DatabaseSync(databasePath, { allowExtension: true });
    try {
      sqliteVec.load(this.db);
    } finally {
      this.db.enableLoadExtension(false);
    }
    this.embeddings = options.embeddings ?? embeddingClient;

    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS vector_store_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL UNIQUE,
        metadata TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;
    `);

    const row = this.db
      .prepare("SELECT value FROM vector_store_config WHERE key = 'dimension'")
      .get() as ConfigRow | undefined;
    if (row) this.dimension = Number(row.value);
  }

  private ensureVectorTable(dimension: number): void {
    if (this.dimension !== undefined && this.dimension !== dimension) {
      throw new Error(
        `Dimensão de embedding incompatível: store=${this.dimension}, recebido=${dimension}.`,
      );
    }
    if (this.dimension !== undefined) return;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE memory_vectors USING vec0(
          embedding float[${dimension}] distance_metric=cosine
        );
      `);
      this.db
        .prepare("INSERT INTO vector_store_config(key, value) VALUES ('dimension', ?)")
        .run(String(dimension));
      this.db.exec("COMMIT");
      this.dimension = dimension;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async upsert(text: string, metadata: VectorMetadata = {}): Promise<void> {
    const cleanText = text.trim();
    if (!cleanText) throw new Error("Texto da memória não pode estar vazio.");

    let metadataJson: string;
    try {
      metadataJson = JSON.stringify(metadata);
    } catch (error) {
      throw new Error(
        `Metadata da memória não é serializável: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const vector = await this.embeddings.embed(cleanText);
    assertVector(vector);
    this.ensureVectorTable(vector.length);
    const blob = vectorBlob(vector);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare("SELECT id FROM memories WHERE text = ?")
        .get(cleanText) as IdRow | undefined;
      let id: bigint;

      if (existing) {
        id = BigInt(existing.id);
        this.db
          .prepare(
            "UPDATE memories SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .run(metadataJson, id);
        this.db.prepare("DELETE FROM memory_vectors WHERE rowid = ?").run(id);
      } else {
        const result = this.db
          .prepare("INSERT INTO memories(text, metadata) VALUES (?, ?)")
          .run(cleanText, metadataJson);
        id = BigInt(result.lastInsertRowid);
      }

      this.db
        .prepare("INSERT INTO memory_vectors(rowid, embedding) VALUES (?, ?)")
        .run(id, blob as SQLInputValue);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async query(text: string, k: number): Promise<VectorMatch[]> {
    const cleanText = text.trim();
    if (!cleanText) throw new Error("Texto de consulta não pode estar vazio.");
    if (!Number.isInteger(k) || k < 1 || k > MAX_QUERY_RESULTS) {
      throw new Error(`k deve ser um inteiro entre 1 e ${MAX_QUERY_RESULTS}.`);
    }

    const vector = await this.embeddings.embed(cleanText);
    assertVector(vector);
    this.ensureVectorTable(vector.length);

    const rows = this.db
      .prepare(`
        WITH nearest AS (
          SELECT rowid, distance
          FROM memory_vectors
          WHERE embedding MATCH ? AND k = ?
        )
        SELECT memories.text, memories.metadata, nearest.distance
        FROM nearest
        JOIN memories ON memories.id = nearest.rowid
        ORDER BY nearest.distance
      `)
      .all(vectorBlob(vector) as SQLInputValue, k) as unknown as MatchRow[];

    return rows.map((row) => ({
      text: row.text,
      metadata: parseMetadata(row.metadata),
      distance: row.distance,
      score: 1 - row.distance,
    }));
  }

  close(): void {
    this.db.close();
  }
}
