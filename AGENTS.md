# Mission Control — agent notes

This repo is **browser terminal only** (not a Next.js app).

## What matters

- **Product surface:** `http://localhost:4321` — full-page xterm + real local PTY
- **PTY broker:** `terminal/pty-server.mjs` on `:4322` (must run under Node)
- **HTML server:** `terminal/server.ts` on `:4321` (Bun; re-reads `index.html` each request)
- **Process supervisor:** `terminal/start.mjs` (LaunchAgent entry)
- **Launcher TUI:** `terminal/launcher-ratatui` → installed as `~/.grok-mission-control/bin/mc`

## Commands

```bash
bun install
bun run terminal              # dev / foreground
bun run terminal:install      # rebuild mc + reinstall LaunchAgent
```

## Conventions

- Keep the browser page a **terminal surface** — no heavy web chrome over the PTY
- Workspace/app selection lives in the **Ratatui launcher**, not DOM overlays
- Data/logs under `~/.grok-mission-control/`
- Canonical checkout: `~/dev/mission-control` (LaunchAgent WorkingDirectory)

## Do not reintroduce without intent

- Next.js dashboard / `app/` routes
- Orchestrator / ACP harness under `lib/harness` (removed; agents launch as child CLIs via `mc`)
