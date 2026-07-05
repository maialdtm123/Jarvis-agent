# REVIEW — Jarvis Agent

_Autor: Claude (camada de arquitetura/review). Data: 2026-07-05._
_Codex: usa isto como lista de defeitos a corrigir. Referência por ID nos commits (ex: `fix: R1 reset apaga factos`)._

## Severidade: ALTA (corrigir na Fase 1)

**R1 — `/reset` apaga factos, não só o histórico.**
`server/src/index.ts` → `/reset` chama `memory.clearSession()`, que faz `delete this.store.sessions[id]` (histórico **e** factos). O frontend chama `/reset` no botão "Limpar". Resultado: limpar o chat apaga tudo o que o agente aprendeu.
→ Fix: `/reset` deve chamar `memory.clearHistory(sessionId)` (já existe, mantém factos). Adicionar rota/flag separada para wipe total explícito.

**R2 — Agentes delegados não recebem contexto nem factos.**
`server/src/agents.ts` → `runSpecialist()` arranca com `messages:[{role:"user", content: task}]`. Só o orchestrator injeta factos no system. O especialista não vê histórico da conversa nem a memória.
→ Fix: propagar factos relevantes (e, opcionalmente, um resumo do histórico) para o system do especialista. Ver PLAN Fase 1.

**R3 — Botão "GPT" não chama GPT.**
`src-tauri/src/lib.rs` → `ask_openai`: com key `sk-or` manda `meta-llama/llama-3.3-70b-instruct:free` e rotula "OpenRouter"; com `sk-ant` cai no Ollama. Nunca chama GPT real a menos que exista `OPENAI_API_KEY`. README diz "gpt-4o". A UI mente ao utilizador.
→ Fix: ou (a) usar `openai/gpt-4o` como default no ramo OpenRouter, ou (b) renomear o botão para o modelo real. Decidir com o Lauro (D3 em TASKS).

**R4 — `web_search` devolve quase sempre vazio.**
`server/src/tools.ts` → usa DuckDuckGo Instant Answer API, que só responde a temas com "Abstract" (tipo-Wikipédia). Para queries reais → nada. O agente "researcher" não pesquisa.
→ Fix: trocar por search real (Tavily/Brave API) ou scraping do DDG HTML. Decisão de provider = D2 em TASKS.

## Severidade: MÉDIA

**R5 — Versões inexistentes no `package.json` (root).**
`typescript: ~6.0.3` e `vite: ^8.0.16` não existem (últimas estáveis: TS 5.x, Vite 5/6). `@vitejs/plugin-react ^6` idem. Verificar se `npm install` resolve; provável falha ou resolução inesperada.
→ Fix: correr `npm install` limpo, fixar versões reais (TS ~5.7, Vite ^6, plugin-react ^4).

**R6 — `config.coderModel` morto.**
`server/src/config.ts` define `coderModel` mas `agents.ts` usa `config.model` no coder. Ou ligar o `coderModel` ao especialista `coder`, ou remover.

**R7 — Factos crescem sem limite e inflam o system prompt.**
`memory.addFact` só faz dedup exato. Todos os factos são injetados no system a cada turno. Com o tempo, custo↑ e ruído↑.
→ Fix (Fase 2): compactação/ranking semântico; injetar só top-K relevantes por embedding.

**R8 — Histórico cortado por slice cego.**
`MAX_HISTORY = 40`, `slice(-40)`. Contexto antigo desaparece sem resumo.
→ Fix (Fase 2): sumarização deslizante — resumir os turnos antigos num "resumo de sessão" antes de descartar.

**R9 — `ask_claude` nativo não lida com múltiplos blocos.**
`lib.rs` lê `body["content"][0]["text"]`. Se o 1º bloco não for texto (ex: tool_use), quebra. Aceitável em modo chat simples, mas frágil.

## Severidade: BAIXA

**R10 — CSP desativado.** `tauri.conf.json` → `security.csp: null`. Definir CSP real antes de distribuir.
**R11 — CORS `*`.** OK para localhost; rever se algum dia expuseres o server.
**R12 — `calculator` usa `Function()`.** Guardado por whitelist de chars (sem identificadores acessíveis), aceitável, mas preferir um mini-parser.
**R13 — Zero testes.** Nenhum. Bloqueia o loop TDD do handoff. Ver Fase 1.

## Nota de arquitetura
A base é boa. O salto "10x" não vem de trocar modelos — vem de **memória semântica real**, **tools que tocam a máquina** e **propagação de contexto**. Ver PLAN.md.
