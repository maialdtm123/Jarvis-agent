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

/** Free web lookup via DuckDuckGo Instant Answer (no API key required). */
const webSearch: Tool = {
  name: "web_search",
  description:
    "Pesquisa rápida na web (DuckDuckGo Instant Answer). Bom para factos, definições e resumos. Sem chave.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "O que pesquisar" } },
    required: ["query"],
  },
  run: async (input: { query: string }) => {
    const q = String(input.query ?? "").trim();
    if (!q) return "Query vazia.";
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(url, {
        headers: { "user-agent": "jarvis-agent/0.1" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return `Pesquisa falhou (HTTP ${res.status}).`;
      const data: any = await res.json();
      if (data.AbstractText) {
        return `${data.AbstractText}${data.AbstractURL ? `\nFonte: ${data.AbstractURL}` : ""}`;
      }
      const related = (data.RelatedTopics ?? [])
        .map((t: any) => t.Text)
        .filter(Boolean)
        .slice(0, 5);
      if (related.length) return `Resultados relacionados:\n- ${related.join("\n- ")}`;
      if (data.Answer) return String(data.Answer);
      return "Sem resultado direto. Tenta uma query mais específica.";
    } catch (e) {
      return `Erro na pesquisa: ${e instanceof Error ? e.message : String(e)}`;
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

/** Persist a durable global fact. */
const memorySave: Tool = {
  name: "memory_save",
  description: "Guarda um facto importante sobre o Lauro ou o contexto, para lembrar no futuro.",
  input_schema: {
    type: "object",
    properties: { fact: { type: "string", description: "O facto a guardar" } },
    required: ["fact"],
  },
  run: (input: { fact: string }, ctx) => {
    ctx.memory.addFact(String(input.fact ?? ""));
    return "Guardado na memória.";
  },
};

/** Recall durable facts. */
const memoryRecall: Tool = {
  name: "memory_recall",
  description: "Recupera factos guardados. Sem query devolve todos.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Filtro opcional" } },
  },
  run: (input: { query?: string }, ctx) => {
    const facts = ctx.memory.recall(input?.query);
    return facts.length ? facts.map((f) => `• ${f}`).join("\n") : "Sem factos guardados.";
  },
};

export const ALL_TOOLS: Tool[] = [
  datetime,
  calculator,
  webSearch,
  fetchUrl,
  memorySave,
  memoryRecall,
];

export const TOOLS_BY_NAME: Record<string, Tool> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export function pickTools(names: string[]): Tool[] {
  return names.map((n) => TOOLS_BY_NAME[n]).filter(Boolean);
}
