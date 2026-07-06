# HANDOFF

OWNER: claude

<!--
Regra: só o OWNER escreve código. Ao terminar, atualiza este ficheiro,
commit, e muda OWNER para o outro agente. O git é o canal de comunicação.
-->

## Estado atual
- T3.1/T3.2 aprovadas pelo Claude: Tavily com fallback DDG e allowlist de filesystem revistas sem bloqueadores.
- Limitação não bloqueadora identificada: a allowlist de filesystem usa `resolve()`, não `realpath()`, e não bloqueia escape através de symlink.
- T3.3 implementa `run_command` no WSL2 sem shell intermédia, com executável allowlisted, argumentos estruturados, `cwd` sujeito à allowlist e timeout máximo de 60 segundos.
- Comandos destrutivos exigem token efémero, single-use, ligado à sessão/comando/args/cwd e confirmação exata do utilizador num novo pedido.
- Shells e interpretadores são bloqueados mesmo que apareçam em `JARVIS_ALLOWED_COMMANDS`; output e dimensões dos argumentos também têm limites.
- Fase 1 concluída e aprovada: T1.1–T1.7 marcadas em `TASKS.md`.
- `/reset` preserva factos; `/wipe` apaga tudo com confirmação explícita na UI.
- Factos são globais e o formato antigo de `memory.json` é migrado automaticamente.
- Factos globais chegam ao orchestrator e aos especialistas.
- Toolchain frontend fixada em versões verificadas; `coderModel` ligado ao coder.
- Vitest configurado: 12 testes em 5 ficheiros.
- Botão `GPT` renomeado para `Llama 3.3` conforme D3.
- D1–D4 fechadas em `TASKS.md` e `PLAN.md`.
- Cross-review do Claude aprovado sem bloqueadores; 12/12 testes verdes.
- Fase 2 iniciada: T2.1 adiciona cliente Ollama `/api/embeddings` com modelo e URL configuráveis.
- Cliente de embeddings trata timeout/rede/HTTP e rejeita vetores vazios, inválidos ou não finitos.
- T2.1 aprovada pelo Claude: fetch injetável, timeout e validação estrita revistos; 16/16 testes verdes, sem bloqueadores.
- T2.2 implementa store local num único ficheiro com `sqlite-vec` 0.1.9 fixado.
- `upsert` persiste texto/metadata e atualiza vetores; `query` devolve top-K por distância cosseno com score.
- A dimensão do embedding é inferida no primeiro uso, persistida e validada nas operações seguintes.

## Próxima ação (Claude)
Fazer o review de segurança T3.4 de `run_command`, com atenção especial à classificação de comandos destrutivos, ao gate de confirmação e à execução via WSL2.

## Bloqueios / questões para o Lauro
- Nenhum. D1–D4 estão fechadas.

## Validação
- `server`: `npm test` (34/34), `npm run typecheck`, `npm run build`.
- `root`: `npm ci`, `npx tsc --noEmit`, `npm run build`.
- `src-tauri`: `cargo check`.

## Log
- 2026-07-05 @claude — scaffold de handoff criado (REVIEW/PLAN/TASKS/AGENTS/HANDOFF). Vez passada ao Codex para Fase 1.
- 2026-07-05 @codex — Fase 1 implementada e validada; decisões D1–D4 registadas. Vez passada ao Claude para T1.7.
- 2026-07-06 @claude — T1.7 aprovada: código revisto (`memory.ts`, `index.ts`, `agents.ts`, `history.ts`, `App.tsx`), 12/12 testes verdes e sem bloqueadores. Vez passada ao Codex para T2.1.
- 2026-07-06 @codex — T2.1 implementada e validada: cliente de embeddings Ollama configurável, 16/16 testes verdes e builds completos. Vez passada ao Claude para review.
- 2026-07-06 @claude — T2.1 aprovada: cliente Ollama revisto, 16/16 testes verdes e sem bloqueadores. Vez passada ao Codex para T2.2.
- 2026-07-06 @codex — T2.2 implementada e validada: `sqlite-vec` persistente, 21/21 testes verdes e builds completos. Vez passada ao Claude para review.
- 2026-07-06 @claude — T2.2 aprovada: revisão feita, 21/21 testes verdes e sem bloqueadores. Vez passada ao Codex para T2.3.
- 2026-07-06 @codex — T2.3 concluída: `memory_save` grava em `memory.json` e `sqlite-vec`, `memory_recall` faz kNN com fallback substring, 25/25 testes verdes e builds completos. Vez passada ao Claude para review.
- 2026-07-06 @codex — T2.4 concluída: o system prompt agora injeta só factos semanticamente relevantes ao turno atual; 27/27 testes verdes e builds completos. Vez passada ao Claude para review.
- 2026-07-06 @codex — T2.5 concluída: histórico antigo passa por resumo deslizante, o resumo é guardado como memória e a janela recente é preservada; 27/27 testes verdes e builds completos. Vez passada ao Claude para review.
- 2026-07-06 @codex — T2.6 concluída: resumo de compactação também persiste no vector store para recall kNN; 27/27 testes verdes e builds completos. Vez passada ao Claude para review.
- 2026-07-06 @codex — T3.1/T3.2 concluídas: web_search usa Tavily com fallback DDG HTML e filesystem tools usam allowlist de diretórios; 30/30 testes verdes e builds completos. Vez passada ao Claude para review.
- 2026-07-06 @claude — T3.1/T3.2 aprovadas sem bloqueadores; registada limitação de symlinks na allowlist de filesystem. Vez passada ao Codex para T3.3.
- 2026-07-06 @codex — T3.3 concluída: gate D4 documentado; shell WSL2 com allowlist, timeout e confirmação explícita para destrutivos; 34/34 testes e builds completos verdes. Vez passada ao Claude para T3.4.
