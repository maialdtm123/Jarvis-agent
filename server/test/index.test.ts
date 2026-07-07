import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestHandler, type ServerDeps } from "../src/index.js";
import { TraceStore } from "../src/traces.js";
import type { Tool, ToolContext, Turn } from "../src/types.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function listen(deps: ServerDeps): Promise<string> {
  const server = createServer(createRequestHandler(deps));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function depsWithIngestTool(tool: Tool): ServerDeps {
  return {
    memory: {} as ServerDeps["memory"],
    vectorStore: {} as ServerDeps["vectorStore"],
    knowledgeStore: {} as ServerDeps["knowledgeStore"],
    ingestTool: tool,
    traceStore: new TraceStore(),
  };
}

function depsWithChat(orchestrator: ServerDeps["orchestrator"]): ServerDeps {
  const history: Turn[] = [];
  return {
    memory: {
      getHistory: () => history,
      appendHistory: (_sessionId: string, turn: Turn) => history.push(turn),
      facts: () => [],
      recall: () => [],
      snapshot: () => ({
        facts: ["O Lauro prefere local-first."],
        sessions: [{ id: "default", turns: history.length, lastRole: history.at(-1)?.role }],
      }),
    } as unknown as ServerDeps["memory"],
    vectorStore: { query: async () => [], upsert: async () => undefined } as ServerDeps["vectorStore"],
    knowledgeStore: {} as ServerDeps["knowledgeStore"],
    ingestTool: { name: "ingest_source", description: "fake", input_schema: {}, run: vi.fn() },
    traceStore: new TraceStore(),
    orchestrator,
  };
}

function sseEvents(raw: string): Array<{ event: string; data: any }> {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("event: "))
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? "";
      const data = block.match(/^data: (.+)$/m)?.[1] ?? "{}";
      return { event, data: JSON.parse(data) };
    });
}

describe("POST /ingest", () => {
  it("calls ingest_source directly and returns its result", async () => {
    const ingestTool: Tool = {
      name: "ingest_source",
      description: "fake",
      input_schema: {},
      run: vi.fn(async () => "Indexados 2 chunks de 1 ficheiros em repo-local."),
    };
    const deps = depsWithIngestTool(ingestTool);
    const baseUrl = await listen(deps);

    const response = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "C:\\repos\\sample",
        label: "repo-local",
        sessionId: "ingest-test",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: "Indexados 2 chunks de 1 ficheiros em repo-local.",
      sessionId: "ingest-test",
    });
    expect(ingestTool.run).toHaveBeenCalledWith(
      { path: "C:\\repos\\sample", label: "repo-local" },
      expect.objectContaining({
        sessionId: "ingest-test",
        knowledgeStore: deps.knowledgeStore,
        userMessage: "ingest C:\\repos\\sample",
      }),
    );
  });

  it("requires a path before calling ingest_source", async () => {
    const ingestTool: Tool = {
      name: "ingest_source",
      description: "fake",
      input_schema: {},
      run: vi.fn(),
    };
    const baseUrl = await listen(depsWithIngestTool(ingestTool));

    const response = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "repo-local" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Campo 'path' em falta." });
    expect(ingestTool.run).not.toHaveBeenCalled();
  });
});

describe("POST /chat streaming", () => {
  it("keeps the JSON response path for non-streaming chat", async () => {
    const orchestrator = vi.fn(async () => "Resposta final");
    const baseUrl = await listen(depsWithChat(orchestrator));

    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "teste", sessionId: "json-test" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      reply: "Resposta final",
      sessionId: "json-test",
    });
  });

  it("streams tokens and tool events as SSE while preserving the final reply", async () => {
    const orchestrator = vi.fn(async (_messages: any, ctx: ToolContext) => {
      ctx.events?.toolStart?.({ agent: "orchestrator", tool: "calculator" });
      ctx.events?.toolResult?.({ agent: "orchestrator", tool: "calculator", output: "4" });
      ctx.events?.text?.({ agent: "orchestrator", text: "Olá " });
      ctx.events?.text?.({ agent: "orchestrator", text: "Lauro" });
      return "Olá Lauro";
    });
    const baseUrl = await listen(depsWithChat(orchestrator));

    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ message: "teste", sessionId: "stream-test" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = sseEvents(await response.text());

    expect(events.map((event) => event.event)).toEqual([
      "start",
      "tool_start",
      "tool_result",
      "token",
      "token",
      "done",
    ]);
    expect(events[1].data).toMatchObject({ agent: "orchestrator", tool: "calculator" });
    expect(events[3].data).toEqual({ agent: "orchestrator", text: "Olá " });
    expect(events[5].data).toEqual({ reply: "Olá Lauro", sessionId: "stream-test" });
  });
});

describe("observability endpoints", () => {
  it("returns structured traces from real chat runs", async () => {
    const orchestrator = vi.fn(async (_messages: any, ctx: ToolContext) => {
      ctx.events?.toolStart?.({ agent: "orchestrator", tool: "datetime" });
      ctx.events?.toolResult?.({ agent: "orchestrator", tool: "datetime", output: "agora" });
      ctx.events?.text?.({ agent: "orchestrator", text: "Feito" });
      return "Feito";
    });
    const baseUrl = await listen(depsWithChat(orchestrator));

    await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "que horas são?", sessionId: "logs-test" }),
    });
    const response = await fetch(`${baseUrl}/logs?limit=1`);

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.traces).toHaveLength(1);
    expect(body.traces[0]).toMatchObject({
      sessionId: "logs-test",
      message: "que horas são?",
      status: "ok",
      reply: "Feito",
    });
    expect(body.traces[0].events.map((event: any) => event.type)).toEqual([
      "start",
      "tool_start",
      "tool_result",
      "token",
      "done",
    ]);
  });

  it("returns a real memory snapshot", async () => {
    const baseUrl = await listen(depsWithChat(async () => "ok"));

    const response = await fetch(`${baseUrl}/memory`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      facts: ["O Lauro prefere local-first."],
      sessions: [{ id: "default", turns: 0 }],
    });
  });
});
