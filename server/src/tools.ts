import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "./types.js";

const SHELL_DEFAULT_TIMEOUT_MS = 15_000;
const SHELL_MAX_TIMEOUT_MS = 60_000;
const SHELL_MAX_OUTPUT_BYTES = 64 * 1024;
const SHELL_CONFIRMATION_TTL_MS = 5 * 60_000;
const FORBIDDEN_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "node",
  "perl",
  "php",
  "powershell",
  "pwsh",
  "python",
  "python3",
  "ruby",
  "sh",
  "wsl",
  "wsl.exe",
  "zsh",
]);

interface RunCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  confirmationToken?: string;
}

interface ShellExecution {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type ShellExecutor = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
) => Promise<ShellExecution>;

interface PendingCommand {
  sessionId: string;
  fingerprint: string;
  expiresAt: number;
}

/** Current date/time. */
const datetime: Tool = {
  name: "datetime",
  description: "Devolve a data e hora atuais (ISO + legível, fuso de Portugal).",
  input_schema: { type: "object", properties: {} },
  run: () => {
    const now = new Date();
    const pt = now.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" });
    return `ISO: ${now.toISOString()} | Portugal: ${pt}`;
  },
};

/** Safe arithmetic evaluator (no eval). */
export const calculator: Tool = {
  name: "calculator",
  description: "Calcula uma expressão aritmética. Ex: '2 * (3 + 4) / 7'.",
  input_schema: {
    type: "object",
    properties: { expression: { type: "string", description: "Expressão aritmética" } },
    required: ["expression"],
  },
  run: (input: { expression: string }) => {
    const expr = String(input.expression ?? "");
    if (!/^[\d\s+\-*/().,%]+$/.test(expr)) {
      return "Expressão inválida: só são permitidos números e + - * / ( ) % .";
    }
    try {
      // Sanitised above; restricted to arithmetic characters only.
      const result = Function(`"use strict"; return (${expr.replace(/,/g, ".")});`)();
      if (typeof result !== "number" || !isFinite(result)) return "Resultado inválido.";
      return String(result);
    } catch {
      return "Não consegui calcular essa expressão.";
    }
  },
};

function tavilyApiKey(): string {
  return process.env.TAVILY_API_KEY ?? process.env.JARVIS_TAVILY_API_KEY ?? "";
}

function allowedDirectoryRoots(): string[] {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const raw = process.env.JARVIS_ALLOWED_DIRS?.trim();
  const roots = (raw ? raw.split(/[;,]/) : [repoRoot])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
  return [...new Set(roots.length ? roots : [repoRoot])];
}

function isWithinRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertAllowedPath(target: string): string {
  const resolved = resolve(target);
  const roots = allowedDirectoryRoots();
  if (!roots.some((root) => isWithinRoot(resolved, root))) {
    throw new Error(`Path fora do allowlist: ${target}`);
  }
  return resolved;
}

function allowedCommands(): Set<string> {
  const raw = process.env.JARVIS_ALLOWED_COMMANDS ?? "pwd,ls,git,npm,cargo";
  return new Set(
    raw
      .split(/[;,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function shellTimeout(input: unknown): number {
  const configured = Number(process.env.JARVIS_SHELL_TIMEOUT_MS ?? SHELL_DEFAULT_TIMEOUT_MS);
  const fallback =
    Number.isFinite(configured) && configured > 0 ? configured : SHELL_DEFAULT_TIMEOUT_MS;
  const requested = Number(input ?? fallback);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error("timeoutMs tem de ser um número positivo.");
  }
  return Math.min(Math.trunc(requested), SHELL_MAX_TIMEOUT_MS);
}

function validateCommand(command: string, args: unknown): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(command)) {
    throw new Error("Comando inválido: usa apenas o nome do executável, sem path ou operadores.");
  }
  const normalised = command.toLowerCase();
  if (FORBIDDEN_EXECUTABLES.has(normalised)) {
    throw new Error(`Comando proibido por segurança: ${command}`);
  }
  if (!allowedCommands().has(normalised)) {
    throw new Error(`Comando fora do allowlist: ${command}`);
  }
  if (args !== undefined && !Array.isArray(args)) {
    throw new Error("args tem de ser uma lista de strings.");
  }
  const values = (args ?? []) as unknown[];
  if (values.length > 64) throw new Error("Demasiados argumentos (máximo: 64).");
  const parsed = values.map((arg) => {
    if (typeof arg !== "string") throw new Error("Todos os argumentos têm de ser strings.");
    if (arg.length > 4096 || arg.includes("\0")) {
      throw new Error("Argumento inválido ou demasiado longo.");
    }
    return arg;
  });
  if (parsed.reduce((total, arg) => total + arg.length, 0) > 16_384) {
    throw new Error("Argumentos demasiado longos.");
  }
  return parsed;
}

export function isDestructiveCommand(command: string, args: string[]): boolean {
  const executable = command.toLowerCase();
  const lowerArgs = args.map((arg) => arg.toLowerCase());
  if (["del", "erase", "mv", "rm", "rmdir", "shred", "unlink"].includes(executable)) return true;

  if (executable === "git") {
    if (lowerArgs.some((arg) => ["clean", "config", "reset", "restore"].includes(arg))) return true;
    if (lowerArgs.includes("checkout") && lowerArgs.includes("--")) return true;
    if (lowerArgs.includes("branch") && lowerArgs.includes("-d")) {
      return true;
    }
    if (lowerArgs.includes("push") && lowerArgs.some((arg) => arg.includes("force"))) return true;
  }

  if (["npm", "pnpm", "yarn"].includes(executable)) {
    return lowerArgs.some((arg) =>
      ["add", "exec", "install", "remove", "uninstall", "update"].includes(arg),
    );
  }
  if (executable === "cargo") {
    return lowerArgs.some((arg) => ["clean", "install", "run", "uninstall"].includes(arg));
  }
  return false;
}

const executeInWsl: ShellExecutor = (command, args, cwd, timeoutMs) =>
  new Promise((resolveExecution, rejectExecution) => {
    execFile(
      "wsl.exe",
      ["--cd", cwd, "--", command, ...args],
      {
        encoding: "utf8",
        maxBuffer: SHELL_MAX_OUTPUT_BYTES,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = [stdout, stderr, error.message].filter(Boolean).join("\n").trim();
          rejectExecution(
            new Error(
              error.killed
                ? `Comando excedeu o timeout de ${timeoutMs} ms.`
                : detail || "Falha ao executar comando.",
            ),
          );
          return;
        }
        resolveExecution({ stdout, stderr, exitCode: 0 });
      },
    );
  });

export function createRunCommandTool(
  executor: ShellExecutor = executeInWsl,
  createToken: () => string = () => randomBytes(8).toString("hex"),
  now: () => number = Date.now,
): Tool {
  const pending = new Map<string, PendingCommand>();

  return {
    name: "run_command",
    description:
      "Executa no WSL2 um comando allowlisted, sem shell intermédia. Operações destrutivas exigem confirmação explícita do utilizador num novo pedido.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Nome exato do executável allowlisted" },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Argumentos separados, sem operadores de shell",
        },
        cwd: { type: "string", description: "Diretório de trabalho allowlisted" },
        timeoutMs: { type: "number", description: "Timeout, limitado a 60000 ms" },
        confirmationToken: {
          type: "string",
          description: "Token devolvido anteriormente para confirmar uma operação destrutiva",
        },
      },
      required: ["command"],
    },
    run: async (input: RunCommandInput, ctx) => {
      try {
        const command = String(input.command ?? "").trim();
        const args = validateCommand(command, input.args);
        const cwd = assertAllowedPath(String(input.cwd ?? allowedDirectoryRoots()[0]).trim());
        const info = await stat(cwd);
        if (!info.isDirectory()) return "Erro ao executar comando: cwd não é um diretório.";
        const timeoutMs = shellTimeout(input.timeoutMs);
        const fingerprint = JSON.stringify([command.toLowerCase(), args, cwd]);

        for (const [token, request] of pending) {
          if (request.expiresAt <= now()) pending.delete(token);
        }

        if (isDestructiveCommand(command, args)) {
          const suppliedToken = String(input.confirmationToken ?? "").trim();
          const request = suppliedToken ? pending.get(suppliedToken) : undefined;
          const explicitlyConfirmed = ctx.userMessage?.trim() === `CONFIRMAR ${suppliedToken}`;
          if (
            !request ||
            request.sessionId !== ctx.sessionId ||
            request.fingerprint !== fingerprint ||
            request.expiresAt <= now() ||
            !explicitlyConfirmed
          ) {
            const token = createToken();
            pending.set(token, {
              sessionId: ctx.sessionId,
              fingerprint,
              expiresAt: now() + SHELL_CONFIRMATION_TTL_MS,
            });
            return `Confirmação necessária. Para executar este comando destrutivo, envia num novo pedido exatamente: CONFIRMAR ${token}`;
          }
          pending.delete(suppliedToken);
        }

        const result = await executor(command, args, cwd, timeoutMs);
        const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
        return output || `Comando concluído (exit ${result.exitCode}).`;
      } catch (error) {
        return `Erro ao executar comando: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

export const runCommandTool = createRunCommandTool();

function formatSearchResults(
  results: Array<{ title?: string; url?: string; snippet?: string; content?: string }>,
): string {
  const lines = results
    .map((result) => {
      const title = String(result.title ?? result.url ?? "Resultado").trim();
      const url = String(result.url ?? "").trim();
      const snippet = String(result.snippet ?? result.content ?? "").trim();
      if (!title && !url && !snippet) return "";
      const head = url ? `${title} — ${url}` : title;
      return snippet ? `${head}\n  ${snippet}` : head;
    })
    .filter(Boolean);
  return lines.join("\n");
}

async function searchTavily(query: string): Promise<string | null> {
  const apiKey = tavilyApiKey();
  if (!apiKey) return null;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
      include_raw_content: false,
      include_favicon: false,
      topic: "general",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Tavily ${res.status}: ${await res.text()}`);
  }

  const data: any = await res.json();
  const lines: string[] = [];
  const answer = typeof data.answer === "string" ? data.answer.trim() : "";
  if (answer) lines.push(answer);

  const results = Array.isArray(data.results) ? data.results : [];
  const formatted = formatSearchResults(
    results.slice(0, 5).map((item: any) => ({
      title: item.title,
      url: item.url,
      snippet: item.content ?? item.snippet,
    })),
  );
  if (formatted) {
    if (lines.length) lines.push("");
    lines.push(`Resultados Tavily:\n${formatted}`);
  }

  return lines.join("\n").trim() || null;
}

function decodeDuckDuckGoUrl(href: string): string {
  try {
    const parsed = new URL(href, "https://html.duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return href;
  }
}

async function searchDuckDuckGoHtml(query: string): Promise<string> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "jarvis-agent/0.1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return `Pesquisa DDG falhou (HTTP ${res.status}).`;

  const html = await res.text();
  const resultBlocks = [...html.matchAll(/<div class="result[^"]*">([\s\S]*?)<\/div>\s*<\/div>/gi)];
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  for (const block of resultBlocks) {
    const chunk = block[1];
    const titleMatch = chunk.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const snippetMatch = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const url = decodeDuckDuckGoUrl(titleMatch[1]);
    const snippet = (snippetMatch?.[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    results.push({ title, url, snippet });
    if (results.length >= 5) break;
  }

  if (!results.length) {
    return "Sem resultado direto. Tenta uma query mais específica.";
  }

  return formatSearchResults(results);
}

/** Free web lookup via Tavily with DDG HTML fallback. */
export const webSearch: Tool = {
  name: "web_search",
  description:
    "Pesquisa na web via Tavily e, se falhar ou não houver chave, faz fallback para scraping HTML do DuckDuckGo.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "O que pesquisar" } },
    required: ["query"],
  },
  run: async (input: { query: string }) => {
    const q = String(input.query ?? "").trim();
    if (!q) return "Query vazia.";

    try {
      const tavily = await searchTavily(q);
      if (tavily) return tavily;
    } catch {
      // Fall through to DDG HTML scraping.
    }

    try {
      return await searchDuckDuckGoHtml(q);
    } catch (error) {
      return `Erro na pesquisa: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/** Read the readable text of a web page. */
const fetchUrl: Tool = {
  name: "fetch_url",
  description:
    "Lê o conteúdo de texto de uma página web (HTTP/HTTPS). Útil para ler artigos, docs ou resultados encontrados via web_search.",
  input_schema: {
    type: "object",
    properties: { url: { type: "string", description: "URL completo (http/https)" } },
    required: ["url"],
  },
  run: async (input: { url: string }) => {
    const url = String(input.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return "URL inválido (tem de começar por http:// ou https://).";
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "jarvis-agent/0.1" },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });
      if (!res.ok) return `Falha ao obter a página (HTTP ${res.status}).`;
      const ct = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      if (ct.includes("application/json")) return raw.slice(0, 6000);
      const text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return text.slice(0, 6000) || "Página sem texto legível.";
    } catch (e) {
      return `Erro ao ler a página: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

/** Filesystem tools are allowlisted to configured workspace roots. */
export const readFileTool: Tool = {
  name: "read_file",
  description: "Lê um ficheiro de texto dentro de diretórios allowlisted.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "Caminho do ficheiro" } },
    required: ["path"],
  },
  run: async (input: { path: string }) => {
    const path = String(input.path ?? "").trim();
    if (!path) return "Path vazio.";
    try {
      const target = assertAllowedPath(path);
      const info = await stat(target);
      if (!info.isFile()) return "O caminho não é um ficheiro.";
      return (await readFile(target, "utf8")).slice(0, 20_000);
    } catch (error) {
      return `Erro ao ler o ficheiro: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const listDirTool: Tool = {
  name: "list_dir",
  description: "Lista o conteúdo de um diretório dentro de allowlist.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "Caminho do diretório" } },
  },
  run: async (input: { path?: string }) => {
    const path = String(input.path ?? ".").trim() || ".";
    try {
      const target = assertAllowedPath(path);
      const info = await stat(target);
      if (!info.isDirectory()) return "O caminho não é um diretório.";
      const entries = await readdir(target, { withFileTypes: true });
      if (!entries.length) return "Diretório vazio.";
      return entries
        .map((entry) => `• ${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .join("\n");
    } catch (error) {
      return `Erro ao listar o diretório: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Escreve um ficheiro de texto dentro de diretórios allowlisted.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Caminho do ficheiro" },
      content: { type: "string", description: "Conteúdo a escrever" },
    },
    required: ["path", "content"],
  },
  run: async (input: { path: string; content: string }) => {
    const path = String(input.path ?? "").trim();
    const content = String(input.content ?? "");
    if (!path) return "Path vazio.";
    try {
      const target = assertAllowedPath(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return `Escrito ${content.length} caracteres em ${target}.`;
    } catch (error) {
      return `Erro ao escrever o ficheiro: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/** Persist a durable global fact. */
export const memorySave: Tool = {
  name: "memory_save",
  description: "Guarda um facto importante sobre o Lauro ou o contexto, para lembrar no futuro.",
  input_schema: {
    type: "object",
    properties: { fact: { type: "string", description: "O facto a guardar" } },
    required: ["fact"],
  },
  run: async (input: { fact: string }, ctx) => {
    const fact = String(input.fact ?? "");
    ctx.memory.addFact(fact);
    try {
      await ctx.vectorStore.upsert(fact, { savedAt: new Date().toISOString() });
      return "Guardado na memória.";
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `Guardado na memória (recall semântico indisponível: ${msg}).`;
    }
  },
};

/** Recall durable facts. */
export const memoryRecall: Tool = {
  name: "memory_recall",
  description: "Recupera factos guardados. Sem query devolve todos.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Filtro opcional" } },
  },
  run: async (input: { query?: string }, ctx) => {
    const query = String(input?.query ?? "").trim();
    if (!query) {
      const facts = ctx.memory.facts();
      return facts.length ? facts.map((f) => `• ${f}`).join("\n") : "Sem factos guardados.";
    }

    try {
      const matches = await ctx.vectorStore.query(query, 5);
      if (matches.length) {
        return matches.map((match) => `• ${match.text} (score: ${match.score.toFixed(2)})`).join("\n");
      }
    } catch {
      // Fallback to substring recall below.
    }

    const facts = ctx.memory.recall(query);
    return facts.length ? facts.map((f) => `• ${f}`).join("\n") : "Sem factos guardados.";
  },
};

export const ALL_TOOLS: Tool[] = [
  datetime,
  calculator,
  webSearch,
  fetchUrl,
  readFileTool,
  listDirTool,
  writeFileTool,
  runCommandTool,
  memorySave,
  memoryRecall,
];

export const TOOLS_BY_NAME: Record<string, Tool> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export function pickTools(names: string[]): Tool[] {
  return names.map((n) => TOOLS_BY_NAME[n]).filter(Boolean);
}
