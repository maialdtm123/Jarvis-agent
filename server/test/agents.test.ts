import { describe, expect, it } from "vitest";
import {
  ORCHESTRATOR_DIRECT_TOOL_NAMES,
  SPECIALISTS,
  withGlobalFacts,
  withRelevantFacts,
} from "../src/agents.js";
import type { ToolContext } from "../src/types.js";

describe("withGlobalFacts", () => {
  it("injects global facts into a specialist system prompt", () => {
    const system = withGlobalFacts("És o especialista.", [
      "O Lauro prefere local-first.",
      "O projeto usa SQLite.",
    ]);

    expect(system).toContain("És o especialista.");
    expect(system).toContain("- O Lauro prefere local-first.");
    expect(system).toContain("- O projeto usa SQLite.");
  });

  it("does not add an empty facts section", () => {
    expect(withGlobalFacts("És o especialista.", [])).toBe("És o especialista.");
  });
});

describe("knowledge specialist", () => {
  it("has the source ingestion and semantic search tools", () => {
    expect(SPECIALISTS.knowledge.toolNames).toEqual([
      "ingest_source",
      "knowledge_search",
      "read_file",
      "list_dir",
    ]);
    expect(SPECIALISTS.knowledge.system).toContain("avaliação técnica honesta");
  });
});

describe("orchestrator tools", () => {
  it("can search indexed knowledge directly without delegating", () => {
    expect(ORCHESTRATOR_DIRECT_TOOL_NAMES).toContain("knowledge_search");
    expect(ORCHESTRATOR_DIRECT_TOOL_NAMES).not.toContain("ingest_source");
  });
});

describe("withRelevantFacts", () => {
  it("injects only the top-K relevant facts for the current turn", async () => {
    const ctx: ToolContext = {
      sessionId: "test",
      memory: {
        facts: () => ["Irrelevante"],
        recall: () => ["Irrelevante"],
      } as ToolContext["memory"],
      vectorStore: {
        query: async () => [
          { text: "Gosta de café", metadata: {}, score: 0.99, distance: 0.01 },
          { text: "Prefere chá", metadata: {}, score: 0.75, distance: 0.25 },
        ],
        upsert: async () => undefined,
        close: () => undefined,
      } as ToolContext["vectorStore"],
      knowledgeStore: {
        query: async () => [],
        upsert: async () => undefined,
        close: () => undefined,
      } as ToolContext["knowledgeStore"],
    };

    const system = await withRelevantFacts("És o especialista.", "café", ctx, 2);

    expect(system).toContain("És o especialista.");
    expect(system).toContain("- Gosta de café");
    expect(system).toContain("- Prefere chá");
    expect(system).not.toContain("Irrelevante");
  });
});
