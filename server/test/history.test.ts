import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Memory } from "../src/memory.js";
import { compactHistoryIfNeeded, normaliseHistory } from "../src/history.js";

const tempDirs: string[] = [];

function memoryPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  tempDirs.push(dir);
  return join(dir, "memory.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("normaliseHistory", () => {
  it("drops leading assistant and non-chat turns", () => {
    expect(
      normaliseHistory([
        { role: "assistant", content: "Saudação local" },
        { role: "tool", content: "resultado", tool_call_id: "call-1" },
        { role: "user", content: "Pergunta" },
        { role: "assistant", content: "Resposta" },
      ]),
    ).toEqual([
      { role: "user", content: "Pergunta" },
      { role: "assistant", content: "Resposta" },
    ]);
  });

  it("returns an empty history when there is no user turn", () => {
    expect(normaliseHistory([{ role: "assistant", content: "Olá" }])).toEqual([]);
  });
});

describe("compactHistoryIfNeeded", () => {
  it("summarises the old window into memory and keeps only the recent turns", async () => {
    const memory = new Memory(memoryPath());
    const upserts: Array<{ text: string; metadata: unknown }> = [];
    const vectorStore = {
      upsert: async (text: string, metadata: unknown) => {
        upserts.push({ text, metadata });
      },
    };
    memory.appendHistory("session", { role: "user", content: "Pergunta 1" });
    memory.appendHistory("session", { role: "assistant", content: "Resposta 1" });
    memory.appendHistory("session", { role: "user", content: "Pergunta 2" });
    memory.appendHistory("session", { role: "assistant", content: "Resposta 2" });
    memory.appendHistory("session", { role: "user", content: "Pergunta 3" });
    memory.appendHistory("session", { role: "assistant", content: "Resposta 3" });

    const result = await compactHistoryIfNeeded(
      memory,
      "session",
      async (turns) => `Resumo de ${turns.length} turnos`,
      vectorStore,
      { trigger: 4, keep: 2 },
    );

    expect(result).toEqual({
      compacted: true,
      removedTurns: 4,
      keptTurns: 2,
      summary: "Resumo de 4 turnos",
    });
    expect(memory.getHistory("session")).toEqual([
      { role: "user", content: "Pergunta 3" },
      { role: "assistant", content: "Resposta 3" },
    ]);
    expect(memory.facts()).toContain("Resumo da sessão session: Resumo de 4 turnos");
    expect(upserts).toEqual([
      {
        text: "Resumo da sessão session: Resumo de 4 turnos",
        metadata: expect.objectContaining({
          kind: "history_summary",
          sessionId: "session",
          compactedAt: expect.any(String),
        }),
      },
    ]);
  });
});
