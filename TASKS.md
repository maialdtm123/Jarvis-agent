# TASKS — Jarvis 10x

Fila de trabalho. Dono por tarefa: `@codex` implementa, `@claude` planeia/revê, `@lauro` decide.
Estado: `[ ]` pendente · `[~]` em curso · `[x]` feito · `[r]` em review.
Regra: só o OWNER atual (ver HANDOFF.md) escreve código. Ao fechar tarefa → atualiza HANDOFF, commit, passa a vez.

---

## Decisões (bloqueiam fases — @lauro responde)

- [ ] **D1** @lauro — Vector store: `sqlite-vec` (recomendado) / ChromaDB / turbovec?
- [ ] **D2** @lauro — Search provider: Tavily / Brave / scraping DDG?
- [ ] **D3** @lauro — GPT: ligar OpenAI real (dá custo) ou renomear o botão?
- [ ] **D4** @lauro — Shell tool na Fase 3 já, ou adiar?

---

## Fase 1 — Fixes + fundação

- [x] **T1.1** @codex — R1: `/reset` usa `clearHistory`. Nova rota `POST /wipe` (apaga tudo) + confirmação na UI. Teste: reset mantém factos, wipe não.
- [x] **T1.2** @codex — Factos globais: refactor do store para `{ globalFacts, sessions:{id:{history}} }`. `addFact/recall/facts` deixam de depender de sessionId. Migrar `memory.json` antigo se existir. Testes.
- [x] **T1.3** @codex — R2: `runSpecialist` injeta `globalFacts` no system do especialista. Assinatura passa a receber contexto. Teste: especialista vê os factos.
- [x] **T1.4** @codex — R5: `npm install` limpo, fixar TS/Vite/plugin-react em versões reais. Confirmar `npm run build` + `tsc --noEmit` verdes.
- [ ] **T1.5** @codex — R6: ligar `config.coderModel` ao especialista `coder` (ou remover se D-decisão for remover).
- [ ] **T1.6** @codex — R13: setup de testes (`vitest`). Testes iniciais: `memory`, `calculator`, `normaliseHistory`, `toAnthropicMessages`. `npm test` no CI local.
- [ ] **T1.7** @claude — cross-review dos diffs T1.1–T1.6 em REVIEW rolling; aprovar ou devolver.

## Fase 2 — Memória RAG (depende de D1)

- [ ] **T2.1** @codex — Cliente de embeddings (Ollama `/api/embeddings`, modelo configurável).
- [ ] **T2.2** @codex — Camada de vector store (conforme D1) com `upsert(text, meta)` e `query(text, k)`.
- [ ] **T2.3** @codex — `memory_recall` → kNN semântico top-K com score. `memory_save` → embed + upsert.
- [ ] **T2.4** @codex — Injeção no system: só top-K relevante ao turno (resolve R7).
- [ ] **T2.5** @codex — Compactação R8: resumo deslizante de histórico antigo via fast model, guardado como memória.
- [ ] **T2.6** @claude — cross-review + validar que o recall melhora vs. baseline (mini-eval).

## Fase 3 — Tools de agente (depende de D2, D4)

- [ ] **T3.1** @codex — web_search real (D2) + fallback. Substitui DDG Instant Answer.
- [ ] **T3.2** @codex — Filesystem tools (`read_file`/`list_dir`/`write_file`) com allowlist de diretórios.
- [ ] **T3.3** @codex — (se D4=sim) Shell tool com allowlist + timeout + gate de confirmação. Segurança primeiro.
- [ ] **T3.4** @claude — review de segurança das tools perigosas antes de merge.

## Fase 4 — Reflexão

- [ ] **T4.1** @codex — Passo de reflexão pós-resposta (fast model) que extrai factos novos com dedup semântico.
- [ ] **T4.2** @claude — review: garantir que só grava sinal, não ruído.

## Fase 5 — Streaming + observabilidade

- [ ] **T5.1** @codex — SSE `/chat` (tokens + eventos de tool) + render incremental na UI.
- [ ] **T5.2** @codex — Traces estruturados; tabs "Logs"/"Memória" consomem dados reais.
- [ ] **T5.3** @claude — review final + atualizar README/PROGRESS.

---

## Log de handoff (append-only, resumo por passagem)
- 2026-07-05 @claude — Review + PLAN + TASKS criados. Próximo: @lauro responde D1–D4; @codex arranca Fase 1 (T1.1–T1.6, não dependem de decisões).
