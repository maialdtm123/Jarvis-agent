# TASKS — Jarvis 10x

Fila de trabalho. Dono por tarefa: `@codex` implementa, `@claude` planeia/revê, `@lauro` decide.
Estado: `[ ]` pendente · `[~]` em curso · `[x]` feito · `[r]` em review.
Regra: só o OWNER atual (ver HANDOFF.md) escreve código. Ao fechar tarefa → atualiza HANDOFF, commit, passa a vez.

---

## Decisões (bloqueiam fases — @lauro responde)

- [x] **D1** @lauro — `sqlite-vec`: local-first, um ficheiro, sem serviço adicional.
- [x] **D2** @lauro — Tavily como provider principal; scraping DDG como fallback zero-key.
- [x] **D3** @lauro — Renomear o botão para o modelo real (`Llama 3.3`); não ligar OpenAI pago.
- [x] **D4** @lauro — Adiar shell tool até o gate de segurança da Fase 3 estar desenhado.

---

## Fase 1 — Fixes + fundação

- [x] **T1.1** @codex — R1: `/reset` usa `clearHistory`. Nova rota `POST /wipe` (apaga tudo) + confirmação na UI. Teste: reset mantém factos, wipe não.
- [x] **T1.2** @codex — Factos globais: refactor do store para `{ globalFacts, sessions:{id:{history}} }`. `addFact/recall/facts` deixam de depender de sessionId. Migrar `memory.json` antigo se existir. Testes.
- [x] **T1.3** @codex — R2: `runSpecialist` injeta `globalFacts` no system do especialista. Assinatura passa a receber contexto. Teste: especialista vê os factos.
- [x] **T1.4** @codex — R5: `npm install` limpo, fixar TS/Vite/plugin-react em versões reais. Confirmar `npm run build` + `tsc --noEmit` verdes.
- [x] **T1.5** @codex — R6: ligar `config.coderModel` ao especialista `coder` (ou remover se D-decisão for remover).
- [x] **T1.6** @codex — R13: setup de testes (`vitest`). Testes iniciais: `memory`, `calculator`, `normaliseHistory`, `toAnthropicMessages`. `npm test` no CI local.
- [x] **T1.7** @claude — cross-review dos diffs T1.1–T1.6 em REVIEW rolling; aprovado sem bloqueadores (12/12 testes verdes).

## Fase 2 — Memória RAG (depende de D1)

- [x] **T2.1** @codex — Cliente de embeddings (Ollama `/api/embeddings`, modelo configurável).
- [x] **T2.2** @codex — Camada de vector store (conforme D1) com `upsert(text, meta)` e `query(text, k)`.
- [x] **T2.3** @codex — `memory_recall` → kNN semântico top-K com score. `memory_save` → embed + upsert.
- [x] **T2.4** @codex — Injeção no system: só top-K relevante ao turno (resolve R7).
- [x] **T2.5** @codex — Compactação R8: resumo deslizante de histórico antigo via fast model, guardado como memória.
- [x] **T2.6** @claude — cross-review + validar que o recall melhora vs. baseline (mini-eval).

## Fase 3 — Tools de agente (depende de D2, D4)

- [x] **T3.1** @codex — web_search real (D2) + fallback. Substitui DDG Instant Answer.
- [x] **T3.2** @codex — Filesystem tools (`read_file`/`list_dir`/`write_file`) com allowlist de diretórios.
- [x] **T3.3** @codex — Shell tool WSL2 com allowlist, argumentos estruturados, timeout e gate de confirmação explícita para destrutivos.
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
- 2026-07-05 @codex — Fase 1 concluída (T1.1–T1.6), D1–D4 registadas. Próximo: @claude faz T1.7.
- 2026-07-06 @claude — T1.7 aprovada: cross-review de `memory.ts`, `index.ts`, `agents.ts`, `history.ts` e `App.tsx`; 12/12 testes verdes, sem bloqueadores. Próximo: @codex inicia T2.1.
- 2026-07-06 @codex — T2.1 concluída: cliente Ollama `/api/embeddings`, modelo/URL configuráveis, timeout, validação e testes. Próximo: @claude revê T2.1.
- 2026-07-06 @claude — T2.1 aprovada sem bloqueadores; 16/16 testes verdes. Próximo: @codex implementa T2.2 com `sqlite-vec`.
- 2026-07-06 @codex — T2.2 concluída: store persistente `sqlite-vec` com upsert, kNN cosseno, metadata e dimensão protegida. Próximo: @claude revê T2.2.
- 2026-07-06 @codex — T3.3 concluída: shell tool WSL2 com allowlist, timeout e confirmação explícita em dois passos para destrutivos. Próximo: @claude faz o review de segurança T3.4.
