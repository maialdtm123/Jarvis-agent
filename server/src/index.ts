import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertConfig, config } from "./config.js";
import { listAgents, runOrchestrator, summarizeTurns } from "./agents.js";
import { compactHistoryIfNeeded, normaliseHistory } from "./history.js";
import { Memory } from "./memory.js";
import { ingestSource } from "./tools.js";
import { TraceStore } from "./traces.js";
import { SqliteVectorStore } from "./vector-store.js";
import type { AgentEventSink, Tool, ToolContext } from "./types.js";

const MAX_BODY_BYTES = 1_000_000; // 1 MB

export interface ServerDeps {
  memory: Memory;
  vectorStore: SqliteVectorStore;
  knowledgeStore: SqliteVectorStore;
  ingestTool: Tool;
  traceStore: TraceStore;
  orchestrator?: typeof runOrchestrator;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-jarvis-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function sendSseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-jarvis-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.write(": connected\n\n");
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Corpo do pedido demasiado grande."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

/** Returns true if the request is authorised (or if no token is configured). */
export function authorised(req: IncomingMessage): boolean {
  if (!config.apiToken) return true;
  return req.headers["x-jarvis-token"] === config.apiToken;
}

function queryNumber(req: IncomingMessage, key: string, fallback: number): number {
  const parsed = new URL(req.url ?? "/", "http://localhost");
  const value = Number(parsed.searchParams.get(key));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function createContext(
  deps: ServerDeps,
  sessionId: string,
  userMessage?: string,
  events?: AgentEventSink,
): ToolContext {
  return {
    sessionId,
    memory: deps.memory,
    vectorStore: deps.vectorStore,
    knowledgeStore: deps.knowledgeStore,
    userMessage,
    events,
  };
}

export function createRequestHandler(deps: ServerDeps) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? "/").split("?")[0];
    const method = req.method ?? "GET";

    if (method === "OPTIONS") return send(res, 204, {});

    if (method === "GET" && url === "/health") {
      return send(res, 200, {
        status: "ok",
        model: config.model,
        hasKey: Boolean(config.apiKey),
        authRequired: Boolean(config.apiToken),
      });
    }

    if (method === "GET" && url === "/agents") {
      return send(res, 200, { agents: listAgents() });
    }

    if (method === "GET" && (url === "/logs" || url === "/memory")) {
      if (!authorised(req)) return send(res, 401, { error: "Token inválido (x-jarvis-token)." });
      if (url === "/logs") {
        return send(res, 200, { traces: deps.traceStore.list(queryNumber(req, "limit", 50)) });
      }
      return send(res, 200, deps.memory.snapshot());
    }

    if (
      method === "POST" &&
      (url === "/chat" || url === "/reset" || url === "/wipe" || url === "/ingest")
    ) {
      if (!authorised(req)) return send(res, 401, { error: "Token inválido (x-jarvis-token)." });

      let traceId: string | undefined;
      try {
        const body = await readBody(req);
        const sessionId = String(body.sessionId ?? "default");

        if (url === "/reset") {
          deps.memory.clearHistory(sessionId);
          return send(res, 200, { ok: true, sessionId });
        }

        if (url === "/wipe") {
          deps.memory.clearAll();
          return send(res, 200, { ok: true });
        }

        if (url === "/ingest") {
          const path = String(body.path ?? "").trim();
          const label = body.label === undefined ? undefined : String(body.label);
          if (!path) return send(res, 400, { error: "Campo 'path' em falta." });

          const ctx = createContext(deps, sessionId, `ingest ${path}`);
          const result = await deps.ingestTool.run({ path, label }, ctx);
          return send(res, 200, { ok: true, result, sessionId });
        }

        const message = String(body.message ?? "").trim();
        if (!message) return send(res, 400, { error: "Campo 'message' em falta." });

        const wantsStream =
          req.headers.accept?.includes("text/event-stream") || body.stream === true;
        const trace = deps.traceStore.start({ sessionId, message, stream: wantsStream });
        traceId = trace.id;
        const events: AgentEventSink = {
          text: (event) => {
            deps.traceStore.add(trace.id, { type: "token", ...event });
            if (wantsStream) writeSse(res, "token", event);
          },
          toolStart: (event) => {
            deps.traceStore.add(trace.id, { type: "tool_start", ...event });
            if (wantsStream) writeSse(res, "tool_start", event);
          },
          toolResult: (event) => {
            deps.traceStore.add(trace.id, { type: "tool_result", ...event });
            if (wantsStream) {
              writeSse(res, "tool_result", {
                ...event,
                output: event.output.slice(0, 1000),
              });
            }
          },
        };
        const ctx = createContext(deps, sessionId, message, events);
        const messages = [
          ...normaliseHistory(deps.memory.getHistory(sessionId)),
          { role: "user" as const, content: message },
        ];

        console.log(`\n[chat:${sessionId}] ${message}`);
        if (wantsStream) {
          sendSseHeaders(res);
          writeSse(res, "start", { sessionId });
        }

        const reply = await (deps.orchestrator ?? runOrchestrator)(messages, ctx);
        deps.traceStore.finish(trace.id, reply);

        deps.memory.appendHistory(sessionId, { role: "user", content: message });
        deps.memory.appendHistory(sessionId, { role: "assistant", content: reply });

        await compactHistoryIfNeeded(
          deps.memory,
          sessionId,
          (turns) => summarizeTurns(turns, ctx),
          ctx.vectorStore,
        );

        if (wantsStream) {
          writeSse(res, "done", { reply, sessionId });
          return res.end();
        }

        return send(res, 200, { reply, sessionId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[request] erro:", msg);
        if (typeof traceId === "string") deps.traceStore.fail(traceId, msg);
        if (!res.headersSent) {
          return send(res, 500, { error: msg });
        }
        writeSse(res, "error", { error: msg });
        return res.end();
      }
    }

    return send(res, 404, { error: "Rota não encontrada" });
  };
}

function createServerDeps(): ServerDeps {
  return {
    memory: new Memory(),
    vectorStore: new SqliteVectorStore(),
    knowledgeStore: new SqliteVectorStore({ databasePath: config.knowledgeDbPath }),
    ingestTool: ingestSource,
    traceStore: new TraceStore(),
  };
}

let activeServer: ReturnType<typeof createServer> | undefined;

export function startServer(): void {
  try {
    assertConfig();
  } catch (e) {
    console.error("⚠️ ", e instanceof Error ? e.message : String(e));
    console.error("   O servidor arranca, mas /chat vai falhar sem a chave.\n");
  }

  activeServer = createServer(createRequestHandler(createServerDeps()));
  activeServer.listen(config.port, () => {
    console.log(`🤖 Jarvis server online em http://localhost:${config.port}`);
    console.log(`   modelo: ${config.model} · fast: ${config.fastModel}`);
    console.log(`   auth: ${config.apiToken ? "ON (x-jarvis-token)" : "OFF"}`);
    console.log(
      "   rotas: GET /health · GET /agents · GET /logs · GET /memory · POST /chat · POST /reset · POST /wipe · POST /ingest",
    );
  });
}

function shutdown(signal: string): void {
  console.log(`\n${signal} recebido — a encerrar…`);
  if (!activeServer) process.exit(0);
  activeServer.close(() => process.exit(0));
  // Hard exit if connections don't drain.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
