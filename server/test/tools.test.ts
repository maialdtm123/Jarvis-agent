import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Memory } from "../src/memory.js";
import {
  listDirTool,
  memoryRecall,
  memorySave,
  readFileTool,
  webSearch,
  writeFileTool,
} from "../src/tools.js";
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
  delete process.env.JARVIS_ALLOWED_DIRS;
  delete process.env.TAVILY_API_KEY;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
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

describe("web search", () => {
  it("uses Tavily when the API responds successfully", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        answer: "Resposta Tavily",
        results: [
          {
            title: "Tavily result",
            url: "https://example.com",
            content: "Snippet Tavily",
          },
        ],
      }),
    } as Response);

    const reply = await webSearch.run({ query: "jarvis" }, {} as ToolContext);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.tavily.com/search");
    expect(reply).toContain("Resposta Tavily");
    expect(reply).toContain("Tavily result");
    expect(reply).toContain("https://example.com");
    expect(reply).toContain("Snippet Tavily");
  });

  it("falls back to DuckDuckGo HTML scraping when Tavily fails", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "boom",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <div class="result results_links results_links_deep web-result">
            <div class="links_main links_deep result__body">
              <h2 class="result__title">
                <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org">
                  DDG result
                </a>
              </h2>
              <a class="result__snippet">Snippet DDG</a>
            </div>
          </div>
        `,
      } as Response);

    const reply = await webSearch.run({ query: "jarvis" }, {} as ToolContext);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("html.duckduckgo.com/html/?q=");
    expect(reply).toContain("DDG result");
    expect(reply).toContain("https://example.org");
    expect(reply).toContain("Snippet DDG");
  });
});

describe("filesystem tools", () => {
  it("list_dir, read_file and write_file are restricted to the allowlist", async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), "jarvis-fs-allowed-"));
    tempDirs.push(allowedRoot);
    process.env.JARVIS_ALLOWED_DIRS = allowedRoot;

    const nested = join(allowedRoot, "notes");
    const file = join(nested, "hello.txt");

    expect(await writeFileTool.run({ path: file, content: "olá mundo" }, {} as ToolContext)).toContain(
      "Escrito 9 caracteres",
    );
    expect(await readFileTool.run({ path: file }, {} as ToolContext)).toBe("olá mundo");
    expect(await listDirTool.run({ path: nested }, {} as ToolContext)).toBe("• hello.txt");

    const outsideRoot = mkdtempSync(join(tmpdir(), "jarvis-fs-outside-"));
    tempDirs.push(outsideRoot);
    const outsideFile = join(outsideRoot, "blocked.txt");

    const denied = await writeFileTool.run(
      { path: outsideFile, content: "blocked" },
      {} as ToolContext,
    );

    expect(denied).toContain("fora do allowlist");
  });
});
