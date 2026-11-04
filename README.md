# enzovo_chat

An agentic customer-support chatbot for an e-commerce store. It answers product, order, wallet, refund and policy questions, and can place or cancel orders, with as few questions to the customer as possible. Runs fully on a Mac with a local LLM.

**Stack:** Node 22 · TypeScript · LangGraph.js (multi-agent) · MCP (tools) · RAG (BM25 + embeddings) · SQLite · Ollama `qwen2.5:14b` · React + Vite

```
React chat ──► Express API ──► LangGraph
 (Vite)        session         supervisor ──┬─► product agent ─┐
               middleware      (router)     ├─► order agent   ─┼─► MCP server ──► modules ──► SQLite
                                            ├─► payments agent ┤   (13 tools)     (rules)
                                            └─► policy agent  ─┘                   RAG over policies
               memory: checkpointer (thread) · graph state (working) · memories/episodes tables (long-term)
```

## Quick start (macOS)

```bash
# 1. Models
ollama pull qwen2.5:14b
ollama pull nomic-embed-text        # optional: hybrid RAG

# 2. Install + seed
npm run setup                       # installs backend + frontend, builds enzovo.db
cp backend/.env.example backend/.env
npm run rag:index --prefix backend  # optional: embeddings (needs nomic-embed-text)

# 3. Run
npm run dev                         # API :3000 + web :5173
```
Open http://localhost:5173, pick a customer, and try the suggestions.

## Try these (the seed data is set up for them)

| Customer | Ask | What happens |
|---|---|---|
| Aarav | "Where is my order?" | Tracks both open orders, no question asked |
| Aarav | "Cancel my charger order" | Confirmation card → cancelled (COD, nothing to refund) |
| Priya | "Where is my order?" | Delay at Kochi hub due to rain, new ETA 6 Nov |
| Priya | "Money got deducted but no order?" | ₹1,799 bank reversal by 9 Nov with RRN |
| Rohan | "Why did my refund go to my wallet?" | Card closed → auto-rerouted (refunds §6) |
| Rohan | "Buy OnePlus 13R from my wallet" | Quote → confirmation card → order placed |
| Rohan | "Can I return my iPhone?" | Window closed on 15 Sep |
| Anyone | "Trending phones rated 4+" | SQL filters, not RAG |

Full scenario list: [`backend/models/seed/README.md`](backend/models/seed/README.md).

## Repo layout
- `backend/`: API, agents, MCP server, business modules ([AGENTS.md](backend/AGENTS.md))
- `frontend/`: React chat UI ([AGENTS.md](frontend/AGENTS.md))
- `docs/LEARN.md`: the cheatsheet: every concept, design decision and likely interview question
- `.github/workflows`: CI (tests, typecheck, build) and CD (Docker image to GHCR)

## Use the MCP server from Claude Desktop or Cursor
```json
{ "mcpServers": { "enzovo": {
  "command": "npx", "args": ["tsx", "/ABSOLUTE/PATH/enzovo_chat/backend/mcp/enzovo.mcp.ts"],
  "env": { "ENZOVO_CUSTOMER_ID": "CUST-001", "DB_PATH": "/ABSOLUTE/PATH/enzovo_chat/backend/enzovo.db" } } } }
```

## Scripts
| Where | Command | Does |
|---|---|---|
| root | `npm run ci` | Same checks as GitHub Actions |
| backend | `npm test` | 20 tests, no LLM needed (scripted model) |
| backend | `npm run db:seed` | Reset the database to the seed state |
| backend | `npm run mcp` | Run the MCP server on stdio |
