# Security

T-0 is a **local full shell** in the browser.

## Threat model

- Anyone who can open `http://127.0.0.1:4321` and talk to the PTY broker can run commands **as your user**.
- That is intentional for a personal terminal — treat the ports like an unlocked terminal window.

## Defaults

- HTML and PTY services bind to **127.0.0.1** only (not LAN). Override only via `MC_BIND_HOST` if you know what you are doing.
- Do **not** reverse-proxy these ports to the public internet without authentication and a clear threat model.
- Do **not** open firewall holes for 4321/4322.

## Quick self-check (maintainers / before release)

- [ ] Default bind is localhost (`terminal/server.ts`, `terminal/pty-server.mjs`, LaunchAgent)
- [ ] No API keys, tokens, or private absolute home paths in tracked source
- [ ] Attachment filenames are sanitized before write
- [ ] Logs stay under the data dir, not committed

## Reporting

If you find a vulnerability (for example remote bind regressions, path traversal in attachments, or session isolation bugs), open a private security advisory on the GitHub repo or contact the maintainer via GitHub.

## Attachments

Dropped files are written under the data directory (`~/.mission-control/attachments` or legacy `~/.grok-mission-control/attachments`). Paths are returned to the PTY for you to use; treat untrusted drops carefully.
