# Agent Instructions: enzovo_chat Backend

Baseline: the 42-services conventions (module / endpoint / middleware / vendor layout), ported from Deno to Node 20+ and TypeScript ESM.

## 1. Directory structure

```
backend/
├── api.ts                     # Entrypoint: Express API (like 42-services api.ts)
├── configs/                   # app.config.ts: env-driven config, no secrets in code
├── endpoints/<area>/          # HTTP handlers: <name>.endpoint.ts
├── middlewares/<name>/        # <name>.ts, e.g. session (customer identity)
├── models/                    # schema.sql, db.ts, seed.ts, seed/*.seed.json
├── modules/<Name>/            # Business logic: <Name>.module.ts + mod.ts barrel
│   ├── Catalog/  Orders/  Payments/  Knowledge/  Memory/
│   └── Agents/                # LangGraph supervisor + specialist agents
├── mcp/                       # enzovo.mcp.ts: modules exposed as MCP tools
├── vendors/<vendor>/          # 3rd-party clients (ollama/), same as 42-services vendors
├── knowledge/policies/        # Markdown policies indexed for RAG
├── utils/                     # dates, errors, types/
└── tests/                     # vitest, no LLM required
```

## 2. Layering rules
- `endpoints` → `modules/Agents` → MCP tools → `modules/*` → `models`. No layer reaches upward.
- Modules are pure business logic over SQLite: no HTTP, no LLM calls (except `Agents`).
- Every module function takes `Ctx { db, customerId }`. **`customerId` comes from the session middleware, never from LLM arguments.**
- Business-rule failures throw `DomainError(code, message)`. Tools return the message to the agent so it can explain it.

## 3. Money and writes
- Money is integer rupees. No floats.
- Multi-step writes (stock, wallet, order) run in one `db.transaction`.
- Write tools are idempotent (`quote_id` for orders, status check for cancels) and support `dry_run`.
- Write tools go through the graph's confirmation interrupt. Confirmation is enforced in code, not in the prompt.

## 4. Style (from 42-services deno.json)
- Tabs, single quotes, ~80-100 column lines.
- File names: `<Name>.module.ts`, `<name>.endpoint.ts`, `<name>.seed.json`, `mod.ts` barrels.
- Hard limit 800 lines per file; split by responsibility before that.
- No `any` in public signatures; internal row parsing may use it.

## 5. Testing
- `npm test` must pass without Ollama (CI has none). Use `openDb(':memory:')` + `seed(db)`.
- Each new business rule gets a test referencing the policy section it implements.

## 6. Commits
Conventional commits: `feat(scope)`, `fix`, `test`, `docs`, `ci`, `chore`. One concern per commit.
