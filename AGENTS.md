# T-0 — agent notes

Product UI name: **T-0**. GitHub repo: `t-0`. CLI/`mc` + state dir still `mission-control` paths (`~/.mission-control`).

This repo is **browser terminal only** (not a Next.js app).

## What matters

- **Product surface:** `http://127.0.0.1:4321` — full-page xterm + real local PTY
- **PTY broker:** `terminal/pty-server.mjs` on `127.0.0.1:4322` (must run under Node)
- **HTML server:** `terminal/server.ts` on `:4321` (Bun; re-reads `index.html` each request)
- **Process supervisor:** `terminal/start.mjs` (LaunchAgent entry)
- **T-0 TUI (`mc`):** `terminal/launcher-ratatui` → data-dir `bin/mc`

## Commands

```bash
bun install
bun run terminal              # dev / foreground
bun run terminal:install      # rebuild mc + reinstall LaunchAgent
```

## Config

- `MC_WORKSPACE_ROOT` — where `mc` scans for git repos
- `MC_DATA_DIR` — state/logs/bin (default `~/.mission-control`; legacy `~/.grok-mission-control` is auto-migrated)
- `MC_BIND_HOST` — default `127.0.0.1`

## Conventions

- Keep the browser page a **terminal surface** — no heavy web chrome over the PTY
- Workspace/app selection lives in the **Ratatui launcher**, not DOM overlays
- Prefer `MC_*` env vars over hardcoded personal paths
- LaunchAgent label: `com.mission-control.terminal`

## Do not reintroduce without intent

- Next.js dashboard / `app/` routes
- Orchestrator / ACP harness (agents launch as child CLIs via `mc`)
