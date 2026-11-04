# Agent Instructions: enzovo_chat Frontend

Baseline: TDU_FE `AGENTS.md`, adapted from Next.js 14 to React 19 + Vite (a single chat page needs no router).

## 1. Directory structure
```
src/
├── components/            # UI components, one folder per feature
│   ├── Chat/              # ChatWindow, ConfirmCard, Chat.module.css
│   ├── Inspector/         # Live trace + memory panel (learning aid)
│   └── UserSwitcher/      # Demo login
├── hooks/                 # useChat: all chat state and actions
├── services/api/          # chat.ts: the only place that calls fetch
├── types/                 # Shared TypeScript types (chat.ts)
├── styles/                # global.css: CSS variables / theme only
├── App.tsx  App.module.css  main.tsx
```

## 2. Rules carried over from TDU_FE
- **File size:** keep files under 800 lines; hard limit 1500. Split by feature first.
- **CSS Modules** per component (`Component.module.css`), camelCase class names. Globals only for theme variables.
- **No inline API calls:** components call hooks; hooks call `services/api`.
- **No `any` in props or API types.** Types live in `src/types`.
- **Business logic in hooks**, not in components. Components render.
- **Consistent error handling:** API errors surface as a `system` message in the chat.
- No direct DOM manipulation, no prop drilling beyond 3 levels, no magic numbers in components.

## 3. Project-specific
- The backend decides identity from the `x-customer-id` header (demo). Never put a customer id in a chat message body.
- A pending confirmation blocks the input: the user must answer the `ConfirmCard` first (the graph is paused server-side).
- Show the trace (agents, tools, latency) under each assistant message. It is part of the demo.

## 4. Commands
- `npm run dev`: Vite on :5173, proxies `/api` to :3000
- `npm run build`: typecheck + production build (CI runs this)
