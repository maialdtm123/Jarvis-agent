# Jarvis Server — cérebro multi-agente

Servidor leve (Node 24) que dá ao Jarvis um cérebro multi-camada de agentes e
tools. A única dependência de runtime é `sqlite-vec`, autorizada para a memória
vetorial local-first.

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
Memória persistente — JSON legado + SQLite/sqlite-vec local
```

Cada agente corre um loop de *tool use* da API Anthropic até produzir resposta final.

## Correr

```bash
cd server
cp .env.example .env        # cola a tua ANTHROPIC_API_KEY
npm install                 # toolchain + extensão sqlite-vec
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

É um único processo Node sem serviço de dados externo (a memória fica em ficheiros locais). Corre em
qualquer host de containers: Fly.io, Render, Railway, VPS. Define `ANTHROPIC_API_KEY`
e monta um volume em `/app/data` para persistir a memória.
