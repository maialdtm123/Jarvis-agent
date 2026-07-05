# AGENTS.md — instruções para o Codex

Trabalhas no Jarvis Agent em conjunto com o Claude via handoff no repositório.
O **repo é o canal de comunicação**. O git é a sincronização. Não há ligação direta entre agentes.

## Regra do testemunho
- `HANDOFF.md` tem `OWNER: claude | codex`. **Só o OWNER escreve código.**
- Antes de começar: confirma que `OWNER: codex`. Se não for, para.
- Ao terminar um bloco de trabalho: atualiza `HANDOFF.md` (o que fizeste, o que falta, próxima ação), faz commit, muda `OWNER` para `claude`, passa a vez.

## O teu papel (divisão acordada)
- **Codex:** implementação, testes, code review de correctness.
- **Claude:** planeamento, arquitetura, análise de alternativas, review de arquitetura/segurança.
- Ambos: cross-review dos diffs um do outro.

## Fluxo por tarefa
1. Lê `TASKS.md`. Pega na próxima tarefa `@codex` da fase atual que não esteja bloqueada por uma decisão `@lauro` pendente.
2. Lê `REVIEW.md` (defeitos, com IDs R1..R13) e `PLAN.md` (arquitetura).
3. Implementa **só** essa tarefa. Não alargues scope. Não refatores código não relacionado.
4. Escreve/atualiza testes. `npm test`, `tsc --noEmit`, `npm run build`, `cargo check` (quando toca Rust) — tudo verde antes de commit.
5. Commit atómico com conventional commits, referenciando o ID: ex `fix(server): R1 /reset mantém factos`, `feat(memory): T2.3 recall semântico kNN`.
6. Marca a tarefa em `TASKS.md` (`[x]`), atualiza `HANDOFF.md`, passa a vez ao Claude para review.

## Convenções do repo
- **Node server** (`server/`): TypeScript ESM, zero deps de runtime **exceto** onde o PLAN autoriza (vector store). Erros tratados, sem `any` desnecessário.
- **Rust** (`src-tauri/`): sem secrets no código, tudo via env. `cargo check` limpo.
- **Frontend** (`src/`): React 19, sem `<form>` desnecessário, estados de loading/erro.
- **Secrets:** nunca commitar. `.env` é gitignored. Se descobrires uma key no código, para e reporta em HANDOFF.

## Tools perigosas (Fase 3) — desenhar segurança primeiro
- Filesystem: **allowlist de diretórios**, nunca fora do workspace configurado.
- Shell: **allowlist de comandos** + timeout + gate de confirmação para destrutivos. Nunca execução cega.
- Se em dúvida sobre segurança de uma tool, **não faças merge** — escreve a questão em HANDOFF para o Claude rever.

## Definição de "feito" por tarefa
- Testes novos verdes + build verde.
- Sem regressões (correr a suite toda).
- HANDOFF atualizado + vez passada.
