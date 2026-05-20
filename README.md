# Mission Control

**Mission control & orchestration for agentic coding CLIs** — starting with Grok Build.

One top-level "Product Manager" (you + light automation) oversees many parallel agent threads. Create, monitor, peek, steer, and validate from a dense, real-time, local-first interface designed to feel native in privacy-first browsers like Helium.

> **Current branch (`minimal-terminal-mvp`)**: The concrete “real terminal as a browser tab” first version.  
> Run `bun run terminal` → open http://localhost:4321 (or Cmd+T in Helium). A full local zsh lives in the tab via xterm.js + PTY.  
> The rich ACP mission-control dashboard + agent orchestration lives on the `main` branch and will later incorporate this terminal view.

## Vision (TL;DR)

- Hierarchical orchestration inspired by Factory.ai Missions: strong orchestrator (human first) + fresh worker contexts + explicit validation.
- Swappable harnesses via clean adapters (Grok Build ACP first, then Claude Code, Codex, custom).
- Primary interface: Next.js web app (Prompt Kit + Vercel AI SDK + Framer Motion) that later becomes a Chrome extension / new-tab page.
- Terminal density + web superpowers (cards, timelines, modals, live streaming).

See [docs/architecture.md](./docs/architecture.md) for the full thinking, data model, risks, and recommended implementation order.

## Current Status (MVP in Progress)

We are in the **earliest prototype phase**.

**Immediate goal (next 3–5 days):** A working control plane where you can:
- Create a thread with a goal
- Watch live streaming output from real `grok` processes
- Send steering messages
- See status at a glance
- Persist across restarts

We are deliberately starting with the simplest reliable Grok Build integration (`grok -p ... --output-format streaming-json`) before investing in a full ACP client. This gets us real usage data fast.

## Quick Start — Terminal Tab (this branch)

This branch (`minimal-terminal-mvp`) is the **fast, shippable first version**:

```bash
bun install
bun run terminal     # starts real PTY server on :4321
# open http://localhost:4321  (or let the extension/newtab.html redirect you)
```

- A full local `zsh` (or your `$SHELL`) runs inside the browser tab.
- Resize, colors, vim, tmux, Ctrl+C — everything works because it is a real PTY.
- Perfect as a Helium new-tab page (`Cmd+T` = new shell).

The heavier Next.js dashboard + ACP agent orchestration is on `main` and will later embed this same terminal experience for “raw view per thread”.

You do **not** need the `grok` CLI for the pure terminal MVP.

## Key Architecture Decisions

- **Dedicated thin orchestrator server** (`server/`) owns all agent processes and SQLite. UI talks to it over HTTP + WebSocket.
- **Harness abstraction** lives in `lib/harness/`. We will implement `GrokBuildHeadlessAdapter` first, then a real `GrokBuildACPAdapter`.
- **Human as PM** in v1. Global command bar + per-thread steering. LLM PM agent is v2.
- **Git worktrees by default** for safe parallelism (future threads will get `--worktree` or equivalent).
- **Local SQLite** at `~/.grok-mission-control/db.sqlite`.

Full rationale and trade-offs are in `docs/architecture.md`.

## Technology

- Next.js 16 + React 19 + Tailwind v4
- Prompt Kit (shadcn AI components) + Vercel AI SDK
- Hono + Bun for the local orchestration server
- Framer Motion, Zustand, Zod, Sonner
- better-sqlite3 for durable local state

## Contributing / Development Notes

This is a personal research + product project. Fast iteration is the priority.

When adding new UI components, prefer Prompt Kit + shadcn primitives for AI-specific patterns (especially `PromptInput`, `Reasoning`, streaming message containers).

When touching agent integration, keep the harness interface in mind even if the first implementation is a simple child_process wrapper.

## Long-term Roadmap (Rough)

1. v0.1 — Working control plane with one harness (live list + peek + steer)
2. v0.2 — Real ACP client, permission surfacing, basic summaries, worktree support
3. v0.3 — Explicit milestone / validation UI, simple LLM PM agent
4. v1.0 — Multi-harness (Claude Code + others via ACP), Helium extension (new tab + page context), voice
5. Future — Browser skills as first-class tools, background orchestration, team sharing of missions

## References & Inspiration

- Factory.ai Missions (orchestrator + fresh workers + validation contracts)
- Agent Client Protocol (agentclientprotocol.com)
- Prompt Kit + Vercel AI Elements
- Grok Build headless + ACP docs (docs.x.ai)
- Helium browser philosophy (local, private, extensible)

---

**Status:** Actively building the first runnable slice. Everything is subject to violent iteration based on real usage.
