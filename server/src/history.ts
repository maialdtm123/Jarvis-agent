import type { Turn } from "./types.js";
import type { Memory } from "./memory.js";
import type { SqliteVectorStore } from "./vector-store.js";

/** Drop non-chat and leading assistant turns so provider history starts with a user. */
export function normaliseHistory(
  turns: Turn[],
): { role: "user" | "assistant"; content: string }[] {
  const flat = turns
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: typeof turn.content === "string" ? turn.content : "",
    }));
  const firstUser = flat.findIndex((turn) => turn.role === "user");
  return firstUser === -1 ? [] : flat.slice(firstUser);
}

export const HISTORY_COMPACTION_TRIGGER = 40;
export const HISTORY_COMPACTION_KEEP = 20;

export interface HistorySummarizer {
  (turns: Turn[]): Promise<string>;
}

export interface CompactionResult {
  compacted: boolean;
  removedTurns: number;
  keptTurns: number;
  summary?: string;
}

/** Summarise old turns into a durable memory fact and keep only the recent window. */
export async function compactHistoryIfNeeded(
  memory: Memory,
  sessionId: string,
  summarize: HistorySummarizer,
  vectorStore: Pick<SqliteVectorStore, "upsert">,
  options: { trigger?: number; keep?: number } = {},
): Promise<CompactionResult> {
  const trigger = options.trigger ?? HISTORY_COMPACTION_TRIGGER;
  const keep = options.keep ?? HISTORY_COMPACTION_KEEP;
  const history = memory.getHistory(sessionId);

  if (history.length <= trigger || history.length <= keep) {
    return { compacted: false, removedTurns: 0, keptTurns: history.length };
  }

  const removed = history.slice(0, history.length - keep);
  const kept = history.slice(-keep);

  let summary: string;
  try {
    summary = (await summarize(removed)).trim();
  } catch {
    return { compacted: false, removedTurns: 0, keptTurns: history.length };
  }

  if (!summary) {
    return { compacted: false, removedTurns: 0, keptTurns: history.length };
  }

  const summaryFact = `Resumo da sessão ${sessionId}: ${summary}`;
  memory.addFact(summaryFact);
  memory.replaceHistory(sessionId, kept);
  try {
    await vectorStore.upsert(summaryFact, {
      kind: "history_summary",
      sessionId,
      compactedAt: new Date().toISOString(),
    });
  } catch {
    // Keep the compacted history and durable fact even if semantic persistence is unavailable.
  }

  return {
    compacted: true,
    removedTurns: removed.length,
    keptTurns: kept.length,
    summary,
  };
}
