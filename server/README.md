# Jarvis Server — cérebro multi-agente

Servidor leve (Node 24, **zero dependências de runtime**) que dá ao Jarvis um
cérebro multi-camada de agentes e tools.

## Arquitetura

```
Gateway HTTP (node:http)
        │  POST /chat
        ▼
Orchestrator (claude-opus-4-8)        ← Camada 0: decide e sintetiza
        │  tool: delegate(agent, task)
        ▼
Especialistas (Camada 1)
  • general     • researcher
  • coder       • memory
        │  tool-use loop
        ▼
Tools (Camada 2)
  datetime · calculator · web_search · memory_save · memory_recall
        │
        ▼
Memória persistente (data/memory.json) — histórico + factos por sessão
```

Cada agente corre um loop de *tool use* da API Anthropic até produzir resposta final.

## Correr

```bash
cd server
cp .env.example .env        # cola a tua ANTHROPIC_API_KEY
npm install                 # só devDeps (typescript, tsx, @types/node)
npm run dev                 # http://localhost:8791  (hot reload)
# ou produção:
npm run build && npm start
```

## Docker

```bash
docker build -t jarvis-server ./server
docker run -p 8791:8791 -e ANTHROPIC_API_KEY=sk-ant-... jarvis-server
```

## API

| Método | Rota      | Corpo                                  | Resposta                  |
|--------|-----------|----------------------------------------|---------------------------|
| GET    | `/health` | —                                      | `{ status, model }`       |
| GET    | `/agents` | —                                      | `{ agents: [...] }`       |
| POST   | `/chat`   | `{ "message": "...", "sessionId": "" }`| `{ reply, sessionId }`    |

## Deploy cloud

É um único processo Node sem estado externo (a memória é um ficheiro). Corre em
qualquer host de containers: Fly.io, Render, Railway, VPS. Define `ANTHROPIC_API_KEY`
e monta um volume em `/app/data` para persistir a memória.
