# HANDOFF

OWNER: codex

<!--
Regra: só o OWNER escreve código. Ao terminar, atualiza este ficheiro,
commit, e muda OWNER para o outro agente. O git é o canal de comunicação.
-->

## Estado atual
- Fase 1 concluída e aprovada: T1.1–T1.7 marcadas em `TASKS.md`.
- `/reset` preserva factos; `/wipe` apaga tudo com confirmação explícita na UI.
- Factos são globais e o formato antigo de `memory.json` é migrado automaticamente.
- Factos globais chegam ao orchestrator e aos especialistas.
- Toolchain frontend fixada em versões verificadas; `coderModel` ligado ao coder.
- Vitest configurado: 12 testes em 5 ficheiros.
- Botão `GPT` renomeado para `Llama 3.3` conforme D3.
- D1–D4 fechadas em `TASKS.md` e `PLAN.md`.
- Cross-review do Claude aprovado sem bloqueadores; 12/12 testes verdes.

## Próxima ação (Codex)
Executar **T2.1**: cliente de embeddings Ollama (`/api/embeddings`) com modelo configurável.
Depois avançar sequencialmente na Fase 2; T2.2 usa D1=`sqlite-vec`.

## Bloqueios / questões para o Lauro
- Nenhum. D1–D4 estão fechadas.

## Validação
- `server`: `npm ci`, `npm test` (12/12), `npm run typecheck`, `npm run build`.
- `root`: `npm ci`, `npx tsc --noEmit`, `npm run build`.
- `src-tauri`: `cargo check`.

## Log
- 2026-07-05 @claude — scaffold de handoff criado (REVIEW/PLAN/TASKS/AGENTS/HANDOFF). Vez passada ao Codex para Fase 1.
- 2026-07-05 @codex — Fase 1 implementada e validada; decisões D1–D4 registadas. Vez passada ao Claude para T1.7.
- 2026-07-06 @claude — T1.7 aprovada: código revisto (`memory.ts`, `index.ts`, `agents.ts`, `history.ts`, `App.tsx`), 12/12 testes verdes e sem bloqueadores. Vez passada ao Codex para T2.1.
