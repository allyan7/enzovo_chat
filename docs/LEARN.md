# enzovo_chat — Learning Cheatsheet

Read top to bottom once, then use the headings as a revision sheet. Every section points to the file that implements it.

---

## 1. The one-minute pitch
> "enzovo_chat is a support agent for an e-commerce store. A **supervisor** routes each message to one or more **specialist agents** (product, order, payments, policy) that run in parallel. Agents act only through an **MCP server** that wraps the business logic, so the same tools work from Claude Desktop too. Structured questions use **SQL**; policy questions use **RAG** with section citations. A **four-tier memory** keeps context without storing live state. Anything that moves money pauses for a **confirmation**, and the write is **idempotent** and **transactional**. It all runs locally on Qwen 2.5 14B through Ollama."

## 2. Request flow (follow this in the code)
1. `frontend/src/hooks/useChat.ts` → `POST /api/chat` with header `x-customer-id`.
2. `backend/middlewares/session/session.ts`: identity is decided **here**, before any LLM.
3. `backend/modules/Agents/Agents.module.ts → chat()`: invokes the graph with `thread_id = customer:thread`.
4. `graph.ts`: `load_context` (memory) → `supervisor` (route) → `Send` to specialists in parallel → `synthesize`.
5. Each specialist = `createReactAgent` (LLM ⇄ tools loop) with **only its tool group** (`tools.ts`).
6. Tools come from the **MCP server** over stdio (`mcp/enzovo.mcp.ts`), bound to one customer.
7. MCP tools call **modules** (`modules/Orders` etc.), which run SQL on SQLite.
8. A write tool calls `interrupt()` → API returns `confirmation` → UI shows `ConfirmCard` → user answers → `Command({ resume })` continues the graph.

## 3. Multi-agent
| Piece | What | File |
|---|---|---|
| Supervisor | JSON router (`{"agents": [...]}`) with keyword fallback | `Agents/router.ts` |
| Fan-out | `Send('specialist', …)` per routed agent, run in parallel | `graph.ts → fanOut` |
| Specialist | ReAct agent, own prompt, own tools | `graph.ts → specialist`, `prompts.ts` |
| Synthesis | 1 reply → pass through; 2+ → LLM merges | `graph.ts → synthesize` |

**Why multi-agent?** Least privilege (product agent can't touch the wallet), smaller prompts and tool lists (a 14B model picks tools more reliably from 3–6 than from 13), parallel answers for multi-intent questions, independent ownership by teams.
**Honest trade-off:** one agent with 13 tools would work too; multi-agent costs an extra routing call. It pays off as tools and teams grow.
**Supervisor vs swarm/handoff:** supervisor is easiest to reason about and trace; handoffs (agent passes control to another) suit long flows. We chose supervisor.

## 4. MCP (Model Context Protocol)
- **What:** an open protocol so any AI client can discover and call tools. Server lists tools with JSON schemas; client calls them.
- **Our server:** 13 tools, zod-validated inputs, errors returned as `CODE: message` so the agent can explain them.
- **Identity binding:** `ENZOVO_CUSTOMER_ID` is set when the MCP process starts. **No tool has a `customer_id` argument**, so prompt injection can't fetch another user's orders (tested in `tests/mcp.test.ts`). Same idea as Swiggy's MCP using OAuth on the connection.
- **Least privilege:** `TOOL_GROUPS` decides which agent sees which tool.
- **Why MCP over plain function calls?** Write once, reuse from any client (our agents, Claude Desktop, Cursor); clean boundary between AI and business logic. Cost: one more process and protocol hop.
- **Transports:** stdio (local, ours), Streamable HTTP (remote services).

## 5. RAG (policies only)
- **Chunking:** one chunk per `## n.` section → cite ids like `returns-and-refunds §6` (`Knowledge.module.ts`).
- **Retrieval:** BM25 keyword score, blended 50/50 with cosine similarity when embeddings exist (**hybrid search**). Embeddings: `nomic-embed-text` via Ollama, stored as JSON in SQLite.
- **Fallback:** no Ollama → BM25 only. That is why CI needs no model.
- **Grounding:** the policy agent must answer only from returned text and cite the section.
- **Why not RAG for products?** "Rated 4+ under ₹25k" needs exact filters and sorting. SQL is correct; vector search would only be "similar".
- **Production upgrades:** pgvector / OpenSearch, re-ranker (cross-encoder), chunk overlap, eval set for retrieval recall.

## 6. Memory layer (the interview favourite)
| Tier | Holds | Where | Lifetime |
|---|---|---|---|
| Thread (short-term) | messages of this chat | LangGraph `SqliteSaver` checkpointer, key `customer:thread` | one chat |
| Working | `activeOrderId` → "cancel it" works | graph state (`graph.ts`) | one chat |
| Long-term | stable facts: preferred_payment, owns_phone, closed_card | `memories` table, upsert by key | until changed/forgotten |
| Episodic | one-line summary per turn/session | `episodes` table, last 2 injected | rolling |

- **Read:** `load_context` builds a ~100-token "Known about this customer" block (`Memory.module.ts → memoryBlock`).
- **Write:** after the reply is sent, a JSON-mode LLM call extracts facts + summary (`Agents.module.ts → rememberTurn`). Users never wait for it.
- **Never stored:** live state (order/refund status, balances: always fetched fresh), card numbers, OTPs. Enforced by `upsertFact` filters.
- **Privacy:** scoped by session customer id; `DELETE /api/memory` ("Forget me" in the UI) supports DPDP/GDPR deletion.
- **Contradictions:** new value overwrites old (upsert), `updated_at` kept.
- **Production:** Redis/Postgres checkpointer, LangGraph Store or Mem0 for long-term, TTLs, embeddings over episodes.

## 7. Safety when money moves
- **Reads never ask, writes ask exactly once.**
- `quote_order` (no side effects) → `place_order(quote_id)`. The **quote id is the idempotency key**: a retry or graph replay returns the same order (`tests/modules.test.ts`).
- One **SQLite transaction**: stock decrement + wallet debit + ledger row + order insert, or nothing.
- **Confirmation is enforced in code, not the prompt:** `withConfirmation` in `tools.ts` forces `dry_run=true`, interrupts with the preview, and only then runs `dry_run=false`.
- Business rules from policies: 10% promo cap, closed cards never offered, COD limits, cancellation only before dispatch or after 7-day delay.

## 8. Other layers
- **Guardrails:** identity from session; ownership in SQL (other customer's order = "not found"); off-topic → `none` route; prompt rule to ignore discount/jailbreak requests; zod validation on every input; qty limit 3.
- **Local LLM:** Ollama `qwen2.5:14b`, temperature 0, JSON mode for routing, short prompts, small tool lists, keyword fallback when JSON fails. Swap model via `LLM_MODEL` in `.env`.
- **Observability:** each reply returns `trace {agents, tools}` and latency, shown in the UI. Production: Langfuse/LangSmith tracing.
- **Testing:** 20 tests, no LLM: business rules, MCP protocol, stdio tool groups, and the **full graph with a scripted model** including interrupt/resume (`tests/graph.test.ts`).
- **CI/CD:** `ci.yml` (seed validation, typecheck, tests, frontend build) on every push/PR; `cd.yml` builds a Docker image (API + UI) and pushes to GHCR after CI passes on main.

## 9. Likely interview questions
1. **Why not one big agent?** See §3: least privilege, reliability with small models, parallelism. Admit it's a trade-off.
2. **How do you stop the LLM ordering things by itself?** Write tools are wrapped; dry-run + interrupt + explicit approval; idempotency key.
3. **How do you stop data leaks between users?** Identity bound at the MCP connection and session; no customer_id arguments; SQL ownership filter; thread ids namespaced.
4. **What if the model returns bad JSON?** `parseJson` extracts the first `{…}`; zod validates; keyword router fallback.
5. **How would you scale this?** Stateless API pods, Postgres + pgvector, Redis checkpointer, MCP server over HTTP behind auth, a hosted model for routing, queue for memory extraction.
6. **How do you evaluate it?** Scenario suite (`backend/models/seed/README.md`) scored on right agent, right tool, correct facts, number of turns; pass^k for consistency (τ-bench idea).
7. **Latency?** Single-agent replies skip synthesis; router is one short call; memory extraction is async; production would use a smaller router model and streaming.
8. **Why SQLite?** Zero setup on a laptop, real transactions, WAL for multi-process. Swap for Postgres in production.

## 10. Production next steps (say these, don't build them)
Real JWT auth · REST/gRPC services behind MCP · Postgres + pgvector · Langfuse traces · eval suite in CI with a hosted model · streaming responses · returns/exchange write tools · rate limiting · PII redaction in logs.
