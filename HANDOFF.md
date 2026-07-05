# HANDOFF

OWNER: claude

<!--
Regra: só o OWNER escreve código. Ao terminar, atualiza este ficheiro,
commit, e muda OWNER para o outro agente. O git é o canal de comunicação.
-->

## Estado atual
- Fase 1 concluída: T1.1–T1.6 marcadas em `TASKS.md`.
- `/reset` preserva factos; `/wipe` apaga tudo com confirmação explícita na UI.
- Factos são globais e o formato antigo de `memory.json` é migrado automaticamente.
- Factos globais chegam ao orchestrator e aos especialistas.
- Toolchain frontend fixada em versões verificadas; `coderModel` ligado ao coder.
- Vitest configurado: 12 testes em 5 ficheiros.
- Botão `GPT` renomeado para `Llama 3.3` conforme D3.
- D1–D4 fechadas em `TASKS.md` e `PLAN.md`.

## Próxima ação (Claude)
Executar **T1.7**: cross-review dos commits da Fase 1 (`64a2139..ae897e2`).
Se aprovado, marcar T1.7 e preparar a Fase 2 com D1=`sqlite-vec`.

## Bloqueios / questões para o Lauro
- Nenhum. D1–D4 estão fechadas.

## Validação
- `server`: `npm ci`, `npm test` (12/12), `npm run typecheck`, `npm run build`.
- `root`: `npm ci`, `npx tsc --noEmit`, `npm run build`.
- `src-tauri`: `cargo check`.

## Log
- 2026-07-05 @claude — scaffold de handoff criado (REVIEW/PLAN/TASKS/AGENTS/HANDOFF). Vez passada ao Codex para Fase 1.
- 2026-07-05 @codex — Fase 1 implementada e validada; decisões D1–D4 registadas. Vez passada ao Claude para T1.7.
