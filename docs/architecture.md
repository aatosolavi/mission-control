# Mission Control — Architecture & Design Notes (v0.1)

> One top-level orchestrator (human + lightweight automation) overseeing many parallel agent threads. Local-first, high information density, swappable harnesses. Starting with Grok Build.

## Core Principles (Non-Negotiable for v1)

- **Local-first & private** — Everything runs on the user's machine. No cloud by default. Data lives in `~/.grok-mission-control/` or a project-local `.mission-control/` directory.
- **Fast iteration over perfect abstraction** — We will build the thinnest possible layer that gives joy. Swappability (Grok Build → Claude Code → custom) is a goal, but we will not pay the full tax in MVP.
- **Information density + real-time feel** — Terminal-inspired aesthetic (dense, low-chrome, excellent typography, subtle motion). Status must feel alive.
- **Human as the real PM** — In v1 the user is the intelligent orchestrator. We surface state clearly and make steering frictionless. An LLM "PM agent" comes later (v2+).

## Technology Choices

### Frontend
- **Next.js 16 (App Router) + React 19**
- **Prompt Kit** (via shadcn registry) + shadcn/ui primitives — best-in-class AI interface components (`PromptInput`, `Reasoning`, `Sources`, chat containers).
- **Vercel AI SDK** — primarily on the *server* for any auxiliary LLM calls (summarization, light orchestration). The real agent intelligence lives in the harnessed CLIs.
- **Framer Motion** — tasteful transitions, status changes, card lifts, timeline scrubbing.
- **Zustand** — client state for threads, selections, filters.
- **Tailwind v4 + OKLCH** — for precise control over the dense dark theme.

### Backend / Orchestration Layer (Thin Local Server)
- **Hono + Bun** (`server/`) running on `localhost:3456` (or configurable).
  - Owns long-lived agent processes.
  - Exposes REST + WebSocket for real-time streams.
  - SQLite (Bun's built-in or `better-sqlite3`) for persistence.
- Why not pure Next.js API routes? Long-running `child_process` + multiple concurrent agents is painful to manage inside Next.js dev server (HMR, route timeouts, connection draining). A dedicated lightweight server is cleaner and more reliable.

### Agent Harness Strategy (Critical)

**Primary path (recommended for v1):** Start with **simple headless** (`grok -p "..." --output-format streaming-json`), then graduate to **full ACP** (`grok agent stdio`).

#### Why this order?
- `streaming-json` gives us **live output in < 2 hours** of work. We get the core loop (create → watch → steer) immediately.
- **ACP** (`grok agent stdio`) is the correct long-term foundation:
  - Proper JSON-RPC 2.0 over stdio.
  - Structured events: `session/update`, tool calls, file edits, permission requests, diffs.
  - Designed exactly for IDEs/orchestrators/clients.
  - Future-proofs swappability (many agents are adding ACP support).
- We will implement a small reusable `packages/acp-client` once the simple path proves the product is worth the investment.

**Harness interface (future):**
```ts
interface HarnessAdapter {
  createThread(goal: string, cwd: string, opts): Promise<ThreadHandle>
  sendMessage(threadId: string, message: string): Promise<void>
  requestSummary(threadId: string): Promise<string>
  pause(threadId: string): Promise<void>
  kill(threadId: string): Promise<void>
  // events via EventEmitter or callback
}
```

Each adapter owns one (or more) child processes and translates to the protocol of choice.

**Strong recommendation on workspaces:** Every thread should (by default) run inside its own git worktree. This is the single best practice for safe parallel agent work. Grok Build handles this well.

### Data Model (v0.1 — deliberately simple)

```ts
// Core entities persisted in SQLite
type Thread = {
  id: string
  missionId: string
  title: string               // human or LLM-generated
  goal: string
  cwd: string
  harness: 'grok-build-headless' | 'grok-build-acp' | 'claude-code' | ...
  status: 'spawning' | 'idle' | 'working' | 'awaiting_permission' | 'blocked' | 'done' | 'error'
  pid?: number
  model?: string
  lastSummary?: string
  summaryUpdatedAt?: Date
  createdAt: Date
  updatedAt: Date
}

type ThreadEvent = {
  id: string
  threadId: string
  type: 'stdout' | 'stderr' | 'status' | 'tool_call' | 'file_edit' | 'permission' | 'reasoning' | 'message'
  timestamp: Date
  payload: unknown        // structured when possible, raw text fallback
}

// Orchestration layer (PM actions)
type OrchestrationLog = {
  id: string
  missionId: string
  actor: 'user' | 'system' | 'pm-agent'
  action: string
  targetThreadIds?: string[]
  payload?: unknown
  timestamp: Date
}
```

**Persistence location:** `~/.grok-mission-control/db.sqlite` (or `process.env.MC_DATA_DIR`).

### Real-time Streaming Strategy

- WebSocket endpoint: `ws://localhost:3456/threads/:id/stream`
- The orchestrator server forwards NDJSON lines (or ACP `session/update` events) as they arrive from the child process.
- Frontend subscribes per-thread when the user "peeks" or selects it.
- For the global dashboard, we also broadcast lightweight status heartbeats.

### MVP Scope (The Smallest Valuable Slice)

**Goal:** In 3–5 focused days of work, a developer can:
1. Create a new thread with a goal + target directory.
2. See a live list of threads with status + last activity.
3. Open a thread detail view ("peek") and watch streaming output in near real-time.
4. Send a follow-up message / steering instruction to a running thread.
5. Kill / pause a thread cleanly.
6. Have basic persistence (threads survive app restart).

**Explicitly out of v0.1:**
- Real ACP client (we use simple streaming-json first)
- LLM-powered PM agent
- Validation contracts / milestones (manual only)
- Browser extension / Helium new-tab
- Multi-harness support beyond one Grok path
- Sophisticated diff viewers or file tree sync

This slice is valuable because it proves the **control plane feels good**. Everything else can be layered on a working foundation.

### PM / Orchestrator Layer in v1

**The user is the PM.** The UI makes the following trivial:

- Global command bar / "Ask the mission" input that understands:
  - "Show me status of all threads"
  - "Summarize progress on the auth thread"
  - "Create a new thread for 'add rate limiting' in the current mission"
  - "Pause everything that is working"
- Per-thread "Send guidance" that injects high-level instructions into the agent without breaking its flow.
- Prominent surface for blocked/awaiting_permission states.

Only after this loop is delightful do we add a background "PM agent" thread that periodically asks strong models for summaries and suggested next actions.

This mirrors the Factory.ai Missions philosophy: the orchestrator (human at first) decomposes, delegates to fresh workers, validates, and unblocks.

### Risks & Things We Are Likely Underestimating

1. **Process management is a nightmare** (top risk)
   - Spawning, stdio buffering, signal handling, graceful shutdown, crash detection, and recovery across multiple agents on macOS is full of sharp edges.
   - Next.js HMR + long-lived children = pain. (Hence the dedicated `server/` process.)
   - Solution: Very defensive wrapper with heartbeats, automatic restart policy, and clear "thread is unhealthy" states in the UI.

2. **ACP implementation effort**
   - Even with good docs, writing a robust, reconnecting, streaming JSON-RPC client that handles all the permission + capability flows is 2–4 days of careful work. Do not underestimate.

3. **Filesystem conflicts & worktree hygiene**
   - Two agents touching the same files in parallel is the fastest way to get corrupted state. Worktrees + explicit PM coordination is mandatory for anything beyond toy use.

4. **"Real-time" vs agent reality**
   - Users will expect sub-second updates. Real agents often think 8–40 seconds between meaningful events. The UI must communicate "thinking" states beautifully (progressive summaries, last-seen reasoning, etc.).

5. **Permission UX is make-or-break**
   - If the user has to alt-tab to the terminal to approve a tool call, the whole value prop collapses. The dashboard **must** surface permission requests inline and forward the decision back to the agent instantly.

6. **Cost & context degradation**
   - Frequent "give me a summary for the PM" calls across 6–8 long-running threads will add up. We need smart caching + incremental summaries.

7. **Swappability leakage**
   - Even with ACP, Grok Build has parallel sub-agents and specific planning workflows that other harnesses may not expose the same way. The abstraction will be leaky by nature.

8. **Helium / extension path later**
   - New tab overrides + content script context extraction has subtle permission and CSP issues. Do this *after* the web app is loved.

### Next Steps (Immediate)

1. Finish the absolute minimal runnable prototype using the simple headless path (this week).
2. Add a beautiful dense dark UI with Prompt Kit components + live streaming.
3. Once 3–4 people (or the author) have used it for real work for a few days, decide whether to invest in the real ACP client.
4. Only then expand the data model toward explicit milestones, validation contracts, and an actual LLM PM.

---

*Document status: Living. Update after every major slice.*
