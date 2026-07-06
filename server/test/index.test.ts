import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestHandler, type ServerDeps } from "../src/index.js";
import type { Tool } from "../src/types.js";

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
  };
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
