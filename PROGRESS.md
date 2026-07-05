# PROGRESS — Jarvis

_Atualizado: 2026-06-29_

## Estado
Base sólida e **verificada** (cargo check ✅ · tsc ✅ · vite build ✅ · servidor smoke test ✅).
Falta apenas colar as **API keys novas** para funcionar end-to-end com LLMs reais.

## O que foi feito
- 🔒 **Segurança:** removidas as 2 API keys hardcoded de `src-tauri/src/lib.rs`.
  Tudo agora via `.env` (gitignored). **REVOGA as chaves antigas** (Anthropic + OpenAI).
- 🦀 **Backend Rust** (`src-tauri/src/lib.rs`): comandos `ask_claude`, `ask_openai`,
  `jarvis_agent`, `jarvis_health`. Parsing real, tratamento de erros, modelos atuais.
- 🎨 **Frontend** (`src/`): UI de chat 10x (tema Jarvis), 3 cérebros selecionáveis,
  histórico persistente (localStorage), indicador de cloud online, estados de loading/erro.
- 🤖 **Servidor multi-agente** (`server/`): Gateway → Orchestrator (opus) → especialistas
  (general/researcher/coder/memory, sonnet) → tools (datetime, calculator, web_search,
  memory_save/recall) → memória persistente JSON. Zero deps de runtime. Docker incluído.
- 🔧 Config: `tauri.conf.json` completo, porta do servidor = **8791** (8787 estava ocupada).

## Ficheiros principais
- `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- `src/App.tsx`, `src/App.css`, `src/api.ts`, `src/types.ts`
- `server/src/{index,config,anthropic,agents,tools,memory,types}.ts`
- `server/{Dockerfile,README.md,package.json}`

## Como correr
```bash
# 1. chaves
cp src-tauri/.env.example src-tauri/.env   # cola chaves novas
cp server/.env.example server/.env         # cola ANTHROPIC_API_KEY
# 2. cérebro
cd server && npm install && npm run dev     # :8791
# 3. app
npm install && npm run tauri dev
```

## Próximos passos
- [ ] Colar API keys novas e testar /chat real (tool-use loop).
- [ ] Streaming de respostas (SSE) servidor → UI.
- [ ] Painel "Logs" a consumir logs reais dos agentes.
- [ ] Mais tools: ficheiros locais, calendário, e-mail.
- [ ] Deploy do servidor (Fly.io/Render) + volume para `data/`.
