# PLAN — Jarvis 10x

_Camada de arquitetura (Claude). O Codex implementa a partir de TASKS.md._
_"10x" = memória semântica real + tools que tocam a máquina + contexto propagado + reflexão + streaming. Não é trocar de modelo._

---

## Princípios

1. **Local-first.** O Lauro tem RTX 5060 + WSL2 + Ollama. Embeddings e (opcionalmente) LLM correm localmente. Cloud é opt-in.
2. **Zero-dep continua a ser um valor**, mas cede onde traz 10x (vector store). Cada dep nova passa pelo `dependency-check`.
3. **Memória = ativo central.** Um agente pessoal vale o que a sua memória vale.
4. **Segurança nas tools perigosas.** Shell/filesystem com allowlist + confirmação, nunca execução cega.

---

## Estado atual (baseline)

```
UI (React) ──Tauri──> jarvis_agent ──HTTP──> server /chat
                                              └─ orchestrator (opus)
                                                 ├─ delegate → specialists (sonnet)
                                                 └─ tools: datetime, calculator, web_search, fetch_url, memory_save/recall
                                              memory.json (facts[] + history[], substring recall)
```

Limites: memória substring, factos por-sessão, delegados sem contexto, sem tools locais, sem streaming, sem reflexão.

---

## Fase 1 — Fixes + fundação (baixo risco, alto retorno)

Objetivo: parar de perder memória, parar de mentir, preparar terreno.

- **R1** `/reset` → `clearHistory` (mantém factos). Nova rota `/wipe` para apagar tudo, com confirmação na UI.
- **Factos globais.** Separar `facts` (global, sobre o Lauro) de `history` (por sessão). Store passa a `{ globalFacts: string[], sessions: {id: {history}} }`. `memory.facts()` deixa de receber sessionId.
- **R2** Propagar contexto aos delegados: `runSpecialist` recebe e injeta os factos globais + (Fase 2) top-K memórias no system do especialista.
- **R3** Decidir GPT real vs. renomear botão (D3).
- **R5/R6** Corrigir deps; ligar ou remover `coderModel`.
- **R13** Setup de testes (`vitest` ou `node:test`) + primeiros testes: `memory`, `calculator`, `normaliseHistory`, `toAnthropicMessages`. Contrato para o loop TDD.

## Fase 2 — Memória RAG (o coração do 10x)

Objetivo: o agente conhece-te semanticamente, cross-sessão, sem inflar o prompt.

- **Embeddings locais** via Ollama (`nomic-embed-text` ou `mxbai-embed-large`). Endpoint `/api/embeddings`.
- **Vector store** (decisão D1):
  - **Opção A — `sqlite-vec`** (recomendada): 1 ficheiro, zero serviço, embeds no processo Node. Local-first puro.
  - **Opção B — ChromaDB** via Docker: o Lauro já conhece; mais pesado (serviço à parte).
  - **Opção C — turbovec**: em exploração; avaliar maturidade antes.
- **Ingestão:** cada facto + cada par (user/assistant) relevante → embedding → store, com metadata (timestamp, sessão, tipo).
- **Recall semântico:** `memory_recall` passa a fazer kNN por embedding, devolve top-K com score. Injeção no system só do top-K relevante ao turno atual (resolve R7).
- **Compactação (R8):** ao exceder N turnos, resumir os antigos num "resumo de sessão" (chamada barata ao fast model) antes de descartar; guardar o resumo como memória.

## Fase 3 — Tools de agente (passa a *fazer*)

Objetivo: sair do chatbot. Tocar no mundo do Lauro.

- **web_search real (R4):** Tavily API (simples, feito para agentes) ou Brave Search API. Fallback: scraping DDG HTML. Decisão D2.
- **Filesystem tools:** `read_file`, `list_dir`, `write_file` — com **allowlist de diretórios** (ex: só dentro de um workspace configurado). Nunca fora.
- **Shell tool:** `run_command` com **allowlist de comandos** + timeout + confirmação explícita para comandos destrutivos. Correr em WSL2. Este é o mais poderoso e o mais perigoso — desenhar a segurança primeiro (ver AGENTS.md → regras de tools perigosas).
- **(Opcional) calendário/e-mail** via MCP ou API — fase posterior.

## Fase 4 — Reflexão (aprende sozinho)

Objetivo: ficar mais inteligente com o uso, sem o utilizador ter de pedir.

- Após cada resposta final, um passo barato (fast model) analisa o turno e extrai factos duradouros novos sobre o Lauro → grava na memória (com dedup semântico, não exato).
- Evitar ruído: só grava factos com sinal (preferências, decisões, projetos, restrições), não trivia.

## Fase 5 — Streaming + observabilidade

Objetivo: vivo e debugável.

- **SSE** server → UI: `/chat` passa a poder streamar tokens + eventos de tool. Frontend renderiza incremental.
- **Traces:** cada run gera um trace estruturado (que agente, que tools, tokens, latência). Tab "Logs" consome traces reais; tab "Memória" mostra os factos/embeddings guardados.

---

## Decisões pendentes (precisam do Lauro — ver TASKS D1–D3)

- **D1** Vector store: sqlite-vec (recomendado) vs ChromaDB vs turbovec.
- **D2** Search provider: Tavily vs Brave vs scraping DDG.
- **D3** GPT: ligar OpenAI real vs renomear o botão para o modelo verdadeiro.
- **D4** Shell tool: incluir já na Fase 3, ou adiar até o modelo de segurança estar validado?

## Ordem recomendada
Fase 1 → D1/D2 → Fase 2 → Fase 3 → Fase 4 → Fase 5.
Cada fase deve fechar com testes verdes e um resumo em HANDOFF.md antes de passar a vez.
