import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Memory } from "../src/memory.js";

const tempDirs: string[] = [];

function memoryPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-memory-"));
  tempDirs.push(dir);
  return join(dir, "memory.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Memory", () => {
  it("keeps global facts when a session history is reset", () => {
    const memory = new Memory(memoryPath());
    memory.addFact("O Lauro prefere respostas diretas.");
    memory.appendHistory("one", { role: "user", content: "Olá" });

    memory.clearHistory("one");

    expect(memory.getHistory("one")).toEqual([]);
    expect(memory.facts()).toEqual(["O Lauro prefere respostas diretas."]);
  });

  it("wipes all facts and session histories explicitly", () => {
    const memory = new Memory(memoryPath());
    memory.addFact("Facto duradouro");
    memory.appendHistory("one", { role: "user", content: "Olá" });

    memory.clearAll();

    expect(memory.facts()).toEqual([]);
    expect(memory.getHistory("one")).toEqual([]);
  });

  it("shares facts across sessions and filters recall", () => {
    const memory = new Memory(memoryPath());
    memory.addFact("Usa SQLite local");
    memory.appendHistory("one", { role: "user", content: "Primeira sessão" });
    memory.appendHistory("two", { role: "user", content: "Segunda sessão" });

    expect(memory.recall("sqlite")).toEqual(["Usa SQLite local"]);
    expect(memory.getHistory("one")).toHaveLength(1);
    expect(memory.getHistory("two")).toHaveLength(1);
  });

  it("migrates per-session facts to the global store without duplicates", () => {
    const path = memoryPath();
    writeFileSync(
      path,
      JSON.stringify({
        sessions: {
          one: { history: [{ role: "user", content: "Olá" }], facts: ["Facto A"] },
          two: { history: [], facts: ["Facto A", "Facto B"] },
        },
      }),
    );

    const memory = new Memory(path);

    expect(memory.facts()).toEqual(["Facto A", "Facto B"]);
    expect(memory.getHistory("one")).toHaveLength(1);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      globalFacts: ["Facto A", "Facto B"],
      sessions: {
        one: { history: [{ role: "user", content: "Olá" }] },
        two: { history: [] },
      },
    });
  });
});
