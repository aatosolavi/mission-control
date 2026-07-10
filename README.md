# Mission Control

**A real local terminal in a browser tab** — plus a Finder-style launcher for workspaces and coding agents.

Open http://localhost:4321. You get a full PTY (`zsh` / your `$SHELL`), session resume across reloads, file drop attachments, and `mc`: pick a workspace, pick an agent (Grok, Codex, Claude, Amp, Devin, Droid, or Shell), go.

> **Canonical checkout:** `~/dev/mission-control`  
> **Data + logs:** `~/.grok-mission-control/`  
> **Surface:** browser terminal only (no Next.js dashboard)

## Quick start

```bash
cd ~/dev/mission-control
bun install
bun run terminal          # HTML :4321 + PTY broker :4322
# open http://localhost:4321
```

### Run at login (macOS)

```bash
bun run terminal:install  # builds `mc` launcher + installs LaunchAgent
```

- Label: `com.grok-mission-control.terminal`
- Working directory: this repo
- Logs: `~/.grok-mission-control/logs/terminal.{out,err}.log`

```bash
launchctl kickstart -k gui/$(id -u)/com.grok-mission-control.terminal
```

## What you get

| Piece | Role |
|---|---|
| `terminal/server.ts` (Bun) | Serves the HTML UI on **:4321**, attachment uploads |
| `terminal/pty-server.mjs` (Node) | Real PTY + WebSocket on **:4322** |
| `terminal/start.mjs` | Starts both |
| `terminal/launcher-ratatui` → `mc` | Workspace + agent picker inside the PTY |
| `extension/` | Helium/Chrome new-tab → localhost:4321 |

### Launcher (`mc`)

- Filter workspaces under `~/dev` (recents first)
- Apps: **1** Grok · **2** Codex · **3** Claude · **4** Amp · **5** Devin · **6** Droid · **7** Shell
- From any shell: run `mc` to reopen the picker

### Themes

Orange accent. Light / dark / system:

- `?theme=light` · `?theme=dark` · `?theme=system`
- **⌘/Ctrl+Shift+L** cycles (stored in `localStorage`)

### Sessions

Each browser tab has a session id. Reload reattaches and replays history. Idle sessions are retained for hours so laptop sleep does not kill work. Named paths: `http://localhost:4321/t/main`.

## Docs

- [docs/browser-terminal.md](./docs/browser-terminal.md) — rendering notes, LaunchAgent, launcher details
- [terminal/launcher-ratatui/README.md](./terminal/launcher-ratatui/README.md) — `mc` controls

## Stack

- **xterm.js** (CDN) + **@lydell/node-pty** + **ws**
- **Bun** for the tiny HTML server
- **Node** for the PTY broker (more reliable than Bun for native PTY on macOS)
- **Rust / Ratatui** for the in-terminal launcher

## Status

Terminal-first. The old Next.js orchestration dashboard was removed so this stays small and focused.
