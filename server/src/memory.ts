import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Turn } from "./types.js";

interface SessionData {
  history: Turn[];
}

interface Store {
  globalFacts: string[];
  sessions: Record<string, SessionData>;
}

const DATA_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../data/memory.json");
const MAX_HISTORY = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function turns(value: unknown): Turn[] {
  return Array.isArray(value) ? (value as Turn[]) : [];
}

function normaliseStore(value: unknown): { store: Store; migrated: boolean } {
  if (!isRecord(value)) {
    return { store: { globalFacts: [], sessions: {} }, migrated: true };
  }

  const sessions: Record<string, SessionData> = {};
  const facts = new Set(strings(value.globalFacts));
  let migrated = !Array.isArray(value.globalFacts);

  if (isRecord(value.sessions)) {
    for (const [id, sessionValue] of Object.entries(value.sessions)) {
      if (!isRecord(sessionValue)) {
        migrated = true;
        continue;
      }
      sessions[id] = { history: turns(sessionValue.history) };
      for (const fact of strings(sessionValue.facts)) facts.add(fact);
      if ("facts" in sessionValue) migrated = true;
    }
  }

  // Earliest store shape: { history: Turn[], facts: string[] }.
  if ("history" in value || "facts" in value) {
    sessions.default = { history: turns(value.history) };
    for (const fact of strings(value.facts)) facts.add(fact);
    migrated = true;
  }

  return { store: { globalFacts: [...facts], sessions }, migrated };
}

/** Persistent JSON store: global durable facts + per-session conversation history. */
export class Memory {
  private store: Store = { globalFacts: [], sessions: {} };
  private readonly dataFile: string;

  constructor(dataFile = DATA_FILE) {
    this.dataFile = dataFile;
    try {
      if (existsSync(this.dataFile)) {
        const loaded = normaliseStore(JSON.parse(readFileSync(this.dataFile, "utf8")));
        this.store = loaded.store;
        if (loaded.migrated) this.persist();
      }
    } catch {
      this.store = { globalFacts: [], sessions: {} };
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.dataFile), { recursive: true });
      writeFileSync(this.dataFile, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error("[memory] persist failed:", e);
    }
  }

  private session(id: string): SessionData {
    return (this.store.sessions[id] ??= { history: [] });
  }

  getHistory(id: string): Turn[] {
    return this.session(id).history;
  }

  appendHistory(id: string, turn: Turn): void {
    const s = this.session(id);
    s.history.push(turn);
    if (s.history.length > MAX_HISTORY) s.history = s.history.slice(-MAX_HISTORY);
    this.persist();
  }

  addFact(fact: string): void {
    const cleanFact = fact.trim();
    if (cleanFact && !this.store.globalFacts.includes(cleanFact)) {
      this.store.globalFacts.push(cleanFact);
      this.persist();
    }
  }

  recall(query?: string): string[] {
    if (!query) return this.store.globalFacts;
    const q = query.toLowerCase();
    return this.store.globalFacts.filter((fact) => fact.toLowerCase().includes(q));
  }

  facts(): string[] {
    return this.store.globalFacts;
  }

  /** Wipe a session's conversation history (keeps durable facts). */
  clearHistory(id: string): void {
    this.session(id).history = [];
    this.persist();
  }

  /** Remove one session's conversation history. Global facts are unaffected. */
  clearSession(id: string): void {
    delete this.store.sessions[id];
    this.persist();
  }

  /** Wipe all persisted conversation history and durable facts. */
  clearAll(): void {
    this.store = { globalFacts: [], sessions: {} };
    this.persist();
  }
}
