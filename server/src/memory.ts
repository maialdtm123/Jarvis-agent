import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Turn } from "./types.js";

interface SessionData {
  history: Turn[];
  facts: string[];
}

interface Store {
  sessions: Record<string, SessionData>;
}

const DATA_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../data/memory.json");
const MAX_HISTORY = 40;

/** Simple persistent JSON store: per-session conversation history + durable facts. */
export class Memory {
  private store: Store = { sessions: {} };

  constructor() {
    try {
      if (existsSync(DATA_FILE)) {
        this.store = JSON.parse(readFileSync(DATA_FILE, "utf8")) as Store;
      }
    } catch {
      this.store = { sessions: {} };
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error("[memory] persist failed:", e);
    }
  }

  private session(id: string): SessionData {
    return (this.store.sessions[id] ??= { history: [], facts: [] });
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

  addFact(id: string, fact: string): void {
    const s = this.session(id);
    if (fact.trim() && !s.facts.includes(fact.trim())) {
      s.facts.push(fact.trim());
      this.persist();
    }
  }

  recall(id: string, query?: string): string[] {
    const facts = this.session(id).facts;
    if (!query) return facts;
    const q = query.toLowerCase();
    return facts.filter((f) => f.toLowerCase().includes(q));
  }

  facts(id: string): string[] {
    return this.session(id).facts;
  }

  /** Wipe a session's conversation history (keeps durable facts). */
  clearHistory(id: string): void {
    this.session(id).history = [];
    this.persist();
  }

  /** Wipe everything for a session (history + facts). */
  clearSession(id: string): void {
    delete this.store.sessions[id];
    this.persist();
  }
}
