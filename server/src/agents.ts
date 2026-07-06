import { config } from "./config.js";
import { log, runAgent } from "./anthropic.js";
import { pickTools } from "./tools.js";
import type { AgentSpec, Tool, ToolContext, Turn } from "./types.js";

/** Layer 2 — specialist agents, each with a focused toolset. */
export const SPECIALISTS: Record<string, AgentSpec> = {
  general: {
    name: "general",
    description: "Assistente generalista para tarefas do dia-a-dia.",
    model: config.fastModel,
    toolNames: ["datetime", "calculator", "memory_save", "memory_recall"],
    system:
      "És um assistente generalista do Jarvis. Resolve a tarefa de forma direta e útil, em português de Portugal. Usa tools quando precisares de factos exatos.",
  },
  researcher: {
    name: "researcher",
    description: "Pesquisa e sintetiza informação da web.",
    model: config.fastModel,
    toolNames: ["web_search", "fetch_url", "datetime", "memory_save"],
    system:
      "És o agente de investigação do Jarvis. Pesquisa com web_search, lê páginas com fetch_url, cruza informação e devolve um resumo factual e conciso, citando fontes quando existirem. Português de Portugal.",
  },
  coder: {
    name: "coder",
    description: "Programação, debugging e design de software.",
    model: config.coderModel,
    toolNames: ["calculator", "read_file", "list_dir", "write_file", "run_command"],
    system:
      "És o agente de engenharia do Jarvis. Escreve código correto, completo e idiomático, explica decisões de forma breve e aponta riscos. Português de Portugal.",
  },
  memory: {
    name: "memory",
    description: "Gere a memória persistente sobre o Lauro.",
    model: config.fastModel,
    toolNames: ["memory_save", "memory_recall"],
    system:
      "És o agente de memória do Jarvis. Guarda e recupera factos relevantes sobre o Lauro de forma organizada. Português de Portugal.",
  },
  knowledge: {
    name: "knowledge",
    description: "Indexa e analisa código e documentação de repositórios locais.",
    model: config.coderModel,
    toolNames: ["ingest_source", "knowledge_search", "read_file", "list_dir"],
    system:
      "És o especialista de conhecimento técnico do Jarvis. Indexa e pesquisa código e documentação, cruza os resultados relevantes e analisa repositórios com rigor. Quando perguntarem se consegues construir algo com base no material indexado, responde com uma avaliação técnica honesta da viabilidade, dependências, lacunas e riscos. Não inventes capacidades que não estejam evidenciadas nas fontes. Português de Portugal.",
  },
};

export function withGlobalFacts(system: string, globalFacts: string[]): string {
  return (
    system +
    (globalFacts.length
      ? `\n\nFactos conhecidos sobre o Lauro:\n- ${globalFacts.join("\n- ")}`
      : "")
  );
}

export async function relevantMemoryFacts(
  query: string,
  ctx: ToolContext,
  limit = 5,
): Promise<string[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return ctx.memory.facts().slice(-limit);
  }

  try {
    const matches = await ctx.vectorStore.query(cleanQuery, limit);
    if (matches.length) return matches.map((match) => match.text);
  } catch {
    // Fallback below.
  }

  const recalled = ctx.memory.recall(cleanQuery).slice(0, limit);
  if (recalled.length) return recalled;
  return ctx.memory.facts().slice(-limit);
}

export async function withRelevantFacts(
  system: string,
  query: string,
  ctx: ToolContext,
  limit = 5,
): Promise<string> {
  const relevant = await relevantMemoryFacts(query, ctx, limit);
  return withGlobalFacts(system, relevant);
}

export async function summarizeTurns(turns: Turn[], ctx: ToolContext): Promise<string> {
  if (!turns.length) return "";

  const transcript = turns
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content ?? ""}`.trim())
    .join("\n");

  return runAgent({
    label: "summarizer",
    system:
      "És um resumidor de histórico do Jarvis. Condensa o diálogo em português de Portugal, focando factos duradouros, decisões, preferências, tarefas em aberto e restrições. Mantém o resumo curto, objetivo e reutilizável para contexto futuro.",
    model: config.fastModel,
    tools: [],
    messages: [
      {
        role: "user",
        content: `Resume o histórico abaixo para contexto futuro:\n\n${transcript}`,
      },
    ],
    ctx,
    maxSteps: 1,
  });
}

/** Run a single specialist on a delegated task. */
export async function runSpecialist(
  agentName: string,
  task: string,
  ctx: ToolContext,
): Promise<string> {
  const spec = SPECIALISTS[agentName] ?? SPECIALISTS.general;
  log("orchestrator", `delegando -> ${spec.name}: ${task.slice(0, 70)}`);
  const system = await withRelevantFacts(spec.system, task, ctx);
  return runAgent({
    label: spec.name,
    system,
    model: spec.model,
    tools: pickTools(spec.toolNames),
    messages: [{ role: "user", content: task }],
    ctx,
    maxSteps: 8,
  });
}

/** Layer 1 tool — lets the orchestrator delegate to a specialist. */
const delegateTool: Tool = {
  name: "delegate",
  description:
    "Delega uma sub-tarefa a um agente especialista. Usa quando a tarefa beneficia de foco: 'researcher' (web), 'coder' (programação), 'knowledge' (análise de repos), 'memory' (memória), 'general' (geral).",
  input_schema: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        enum: ["general", "researcher", "coder", "knowledge", "memory"],
        description: "Especialista a usar",
      },
      task: { type: "string", description: "Instrução completa e autónoma para o especialista" },
    },
    required: ["agent", "task"],
  },
  run: (input: { agent: string; task: string }, ctx) =>
    runSpecialist(input.agent, input.task, ctx),
};

const ORCHESTRATOR_SYSTEM = `És o Jarvis, o assistente pessoal do Lauro (português de Portugal, direto e competente).
És a camada de orquestração: analisas o pedido e decides como o resolver.
- Para tarefas simples, responde diretamente.
- Para tarefas que beneficiam de foco, usa a tool 'delegate' para um especialista (researcher/coder/knowledge/memory/general).
 - Usa tools diretas (datetime, calculator, web_search, read_file, list_dir, write_file, run_command, memory_save, memory_recall) quando fizer sentido.
- Guarda na memória factos duradouros sobre o Lauro quando os descobrires.
Sintetiza sempre uma resposta final clara para o utilizador. Nunca exponhas detalhes internos das tools a menos que ajudem.`;

/** Layer 0 — the orchestrator the gateway calls. */
export async function runOrchestrator(
  messages: { role: "user" | "assistant"; content: string }[],
  ctx: ToolContext,
): Promise<string> {
  const orchestratorTools: Tool[] = [
    delegateTool,
    ...pickTools([
      "datetime",
      "calculator",
      "web_search",
      "fetch_url",
      "read_file",
      "list_dir",
      "write_file",
      "run_command",
      "memory_save",
      "memory_recall",
    ]),
  ];
  const currentQuery = messages[messages.length - 1]?.content ?? "";
  const system = await withRelevantFacts(ORCHESTRATOR_SYSTEM, currentQuery, ctx);

  return runAgent({
    label: "orchestrator",
    system,
    model: config.model,
    tools: orchestratorTools,
    messages,
    ctx,
    maxSteps: 12,
  });
}

export function listAgents() {
  return Object.values(SPECIALISTS).map((s) => ({
    name: s.name,
    description: s.description,
    model: s.model,
    tools: s.toolNames,
  }));
}
