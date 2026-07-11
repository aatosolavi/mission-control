# T-0 — agent notes

Product UI name: **T-0**. GitHub repo: `t-0`. CLI: **`t0`** (legacy alias `mc`). State dir: `~/.t-0`.

This repo is **browser terminal only** (not a Next.js app).

**Installing T-0 for a user (not editing this repo):** follow [docs/for-coding-agents.md](./docs/for-coding-agents.md) or the skill [.agents/skills/install-t0/SKILL.md](./.agents/skills/install-t0/SKILL.md).

## What matters

- **Product surface:** `https://t0.localhost` (portless proxy; `http://127.0.0.1:4321` direct) — full-page xterm + real local PTY. Browser connects same-origin at `/pty`; server.ts proxies to the broker.
- **PTY broker:** `terminal/pty-server.mjs` on `127.0.0.1:4322` (must run under Node)
- **HTML server:** `terminal/server.ts` on `:4321` (Bun; re-reads `index.html` each request)
- **Process supervisor:** `terminal/start.mjs` (LaunchAgent entry)
- **T-0 TUI (`t0`):** `terminal/launcher-ratatui` → data-dir `bin/t0` (legacy `bin/mc` shim)

## Commands

```bash
bun install
bun run terminal              # dev / foreground
bun run terminal:install      # rebuild t0 + reinstall LaunchAgent
```

## Config

- `MC_WORKSPACE_ROOT` — where `t0` scans for git repos
- `MC_DATA_DIR` — state/logs/bin (default `~/.t-0`; legacy `~/.mission-control` / `~/.grok-mission-control` auto-migrated)
- `MC_BIND_HOST` — default `127.0.0.1`
- `MC_DEMO=1` / `MC_MOCK=1` — fake public-looking workspaces for marketing screenshots (`MC_DEMO=1 t0`); skips splash

## Conventions

- Keep the browser page a **terminal surface** — no heavy web chrome over the PTY
- Workspace/app selection lives in the **Ratatui launcher**, not DOM overlays
- Prefer `MC_*` env vars over hardcoded personal paths
- LaunchAgent label: `com.mission-control.terminal`

## Versioning (how agents should bump)

Use **semver** `MAJOR.MINOR.PATCH` on a **0.x** product line for now (public but still early).

### Preference (A-Logic / agent logic)

| Change size | Bump | Examples |
|-------------|------|----------|
| Fix, docs, small polish, dependency nits | **PATCH** (`0.2.0` → `0.2.1`) | color fix, README, skill path |
| New user-facing capability, path/URL/state changes | **MINOR** (`0.2.0` → `0.3.0`) | portless URL, new surface, migrate data dir |
| Breaking install/API/CLI rename with no compat | **MAJOR** (rare while `0.x`) | only if we drop `t0` / break LaunchAgent hard |

**Default when unsure:** prefer **PATCH**, not MINOR.  
Lesson: `0.2.0` was a bit aggressive for “still early public”; a `0.1.1`-style bump would have been fine for many of those commits. Don’t thrash tags after publish unless the user asks.

### Surfaces to keep in sync on a release

Update **all of these** in the same release commit (or immediately after, before tagging):

1. `package.json` → `"version"`
2. `terminal/launcher-ratatui/Cargo.toml` → `version` (then `cargo build --release` / `bun run terminal:launcher:install` so `Cargo.lock` matches; avoid `--locked` failure)
3. `extension/manifest.json` → `"version"` (can track app version; OK if it leads by a patch for extension-only fixes)
4. `CHANGELOG.md` → new `## [X.Y.Z] — YYYY-MM-DD` section with highlights
5. Git: commit → `git tag -a vX.Y.Z -m "…"` → `git push origin main --tags` (or push tag separately)
6. GitHub Release: `gh release create vX.Y.Z` with notes + optional `t0-darwin-arm64` asset from `~/.t-0/bin/t0`

Do **not** only bump `package.json` and forget Cargo/tag/release.

### Release checklist (agents)

```bash
# 1) set versions in package.json, Cargo.toml, extension/manifest.json
# 2) write CHANGELOG.md section
bun run terminal:launcher:install   # rebuild t0; fix Cargo.lock if needed
git add -A && git commit -m "chore: release vX.Y.Z"
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z — short summary"
git push origin vX.Y.Z
gh release create vX.Y.Z ~/.t-0/bin/t0#t0-darwin-arm64 \
  --title "T-0 vX.Y.Z" --notes-file -   # or --notes "…"
```

### Tag hygiene

- Tag the commit that contains the version bumps + changelog.
- Don’t delete/retag published versions unless the user explicitly wants a fix; prefer the next PATCH.
- Release notes: user-facing highlights + install one-liner + link to `CHANGELOG.md`.

## Do not reintroduce without intent

- Next.js dashboard / `app/` routes
- Orchestrator / ACP harness (agents launch as child CLIs via `t0`)
