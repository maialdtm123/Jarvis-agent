# Jarvis

Assistente pessoal do Lauro: **app desktop nativa** (Tauri + React) com um
**cérebro cloud multi-agente** (Node) por trás.

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│  Jarvis Desktop (Tauri)     │  HTTP  │  Jarvis Server (server/)         │
│  React UI + Rust backend    │ ─────▶ │  Orchestrator → especialistas    │
│  • chat 10x                 │        │  → tools → memória persistente   │
│  • multi-provider           │ ◀───── │  (claude-opus-4-8 / sonnet-4-6)  │
└─────────────────────────────┘        └──────────────────────────────────┘
```

A UI fala com **três cérebros** (botões no topo):
- **Jarvis Agent** — o servidor multi-agente (`server/`), com tools e memória.
- **Claude** — `claude-opus-4-8` direto.
- **Llama 3.3** — `meta-llama/llama-3.3-70b-instruct:free` via OpenRouter,
  com fallback para o modelo local configurado no Ollama.

## Setup

### 1. Chaves (NUNCA no código)
As chaves antigas que estavam hardcoded **foram removidas — revoga-as** em
[console.anthropic.com](https://console.anthropic.com) e
[platform.openai.com](https://platform.openai.com) e gera novas.

```bash
# Desktop (chamadas diretas a Claude/Llama)
cp src-tauri/.env.example src-tauri/.env   # cola as chaves novas

# Servidor (cérebro multi-agente)
cp server/.env.example server/.env         # cola a ANTHROPIC_API_KEY
```

### 2. Servidor (cérebro)
```bash
cd server
npm install
npm run dev          # http://localhost:8791
```

### 3. App desktop
```bash
npm install
npm run tauri dev    # arranca Vite + janela nativa
```

## Build de produção
```bash
npm run build              # frontend (tsc && vite build)
npm run tauri build        # instalador nativo (.msi/.exe)
cd server && npm run build # servidor → dist/
```

## Estrutura
```
src/                 UI React (App.tsx, api.ts, types.ts, App.css)
src-tauri/src/       Backend Rust (lib.rs) — bridge seguro, env-based
server/              Cérebro multi-agente Node (ver server/README.md)
```

## Segurança
- Zero secrets no código. Tudo via `.env` (gitignored).
- O backend Rust lê chaves do ambiente; nunca as expõe ao frontend.
- Ver `server/README.md` para detalhes da arquitetura de agentes e deploy.
