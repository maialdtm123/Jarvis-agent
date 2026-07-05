# HANDOFF

OWNER: codex

<!--
Regra: só o OWNER escreve código. Ao terminar, atualiza este ficheiro,
commit, e muda OWNER para o outro agente. O git é o canal de comunicação.
-->

## Estado atual
- Review completo feito pelo Claude → `REVIEW.md` (defeitos R1–R13).
- Arquitetura 10x definida → `PLAN.md` (5 fases).
- Fila de tarefas → `TASKS.md` (tags @codex/@claude/@lauro).
- Instruções de trabalho → `AGENTS.md`.

## Próxima ação (Codex)
Arranca a **Fase 1**. As tarefas T1.1–T1.6 **não** dependem das decisões D1–D4, portanto podes começar já:
1. T1.1 — `/reset` → `clearHistory` + rota `/wipe`.
2. T1.2 — factos globais (refactor do store).
3. T1.3 — propagar factos aos delegados.
4. T1.4 — corrigir versões de deps.
5. T1.5 — ligar/remover `coderModel`.
6. T1.6 — setup de testes + testes iniciais.

Faz uma tarefa de cada vez, testes verdes, commit atómico com o ID (ex: `fix(server): R1 ...`).
Quando fechares a Fase 1 (ou precisares de review/decisão), atualiza este ficheiro, muda `OWNER: claude`, e passa a vez.

## Bloqueios / questões para o Lauro
- D1–D4 em `TASKS.md` precisam de resposta antes das Fases 2–3.

## Log
- 2026-07-05 @claude — scaffold de handoff criado (REVIEW/PLAN/TASKS/AGENTS/HANDOFF). Vez passada ao Codex para Fase 1.
