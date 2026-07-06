import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "./types.js";

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
  memorySave,
  memoryRecall,
];

export const TOOLS_BY_NAME: Record<string, Tool> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export function pickTools(names: string[]): Tool[] {
  return names.map((n) => TOOLS_BY_NAME[n]).filter(Boolean);
}
