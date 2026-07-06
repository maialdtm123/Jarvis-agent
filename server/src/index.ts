import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { assertConfig, config } from "./config.js";
import { listAgents, runOrchestrator, summarizeTurns } from "./agents.js";
import { compactHistoryIfNeeded, normaliseHistory } from "./history.js";
import { Memory } from "./memory.js";
import { SqliteVectorStore } from "./vector-store.js";
import type { ToolContext } from "./types.js";

const memory = new Memory();
const vectorStore = new SqliteVectorStore();
const MAX_BODY_BYTES = 1_000_000; // 1 MB

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-jarvis-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
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
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

/** Returns true if the request is authorised (or if no token is configured). */
function authorised(req: IncomingMessage): boolean {
  if (!config.apiToken) return true;
  return req.headers["x-jarvis-token"] === config.apiToken;
}

const server = createServer(async (req, res) => {
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

  if (method === "POST" && (url === "/chat" || url === "/reset" || url === "/wipe")) {
    if (!authorised(req)) return send(res, 401, { error: "Token inválido (x-jarvis-token)." });

    try {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? "default");

      if (url === "/reset") {
        memory.clearHistory(sessionId);
        return send(res, 200, { ok: true, sessionId });
      }

      if (url === "/wipe") {
        memory.clearAll();
        return send(res, 200, { ok: true });
      }

      const message = String(body.message ?? "").trim();
      if (!message) return send(res, 400, { error: "Campo 'message' em falta." });

      const ctx: ToolContext = { sessionId, memory, vectorStore };
      const messages = [
        ...normaliseHistory(memory.getHistory(sessionId)),
        { role: "user" as const, content: message },
      ];

      console.log(`\n[chat:${sessionId}] ${message}`);
      const reply = await runOrchestrator(messages, ctx);

      memory.appendHistory(sessionId, { role: "user", content: message });
      memory.appendHistory(sessionId, { role: "assistant", content: reply });

      await compactHistoryIfNeeded(memory, sessionId, (turns) => summarizeTurns(turns, ctx), ctx.vectorStore);

      return send(res, 200, { reply, sessionId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[request] erro:", msg);
      return send(res, 500, { error: msg });
    }
  }

  send(res, 404, { error: "Rota não encontrada" });
});

try {
  assertConfig();
} catch (e) {
  console.error("⚠️ ", e instanceof Error ? e.message : String(e));
  console.error("   O servidor arranca, mas /chat vai falhar sem a chave.\n");
}

server.listen(config.port, () => {
  console.log(`🤖 Jarvis server online em http://localhost:${config.port}`);
  console.log(`   modelo: ${config.model} · fast: ${config.fastModel}`);
  console.log(`   auth: ${config.apiToken ? "ON (x-jarvis-token)" : "OFF"}`);
  console.log(`   rotas: GET /health · GET /agents · POST /chat · POST /reset · POST /wipe`);
});

function shutdown(signal: string): void {
  console.log(`\n${signal} recebido — a encerrar…`);
  server.close(() => process.exit(0));
  // Hard exit if connections don't drain.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
