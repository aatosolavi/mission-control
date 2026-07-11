#!/usr/bin/env bash
set -euo pipefail

NEW_LABEL="com.mission-control.terminal"
LEGACY_LABEL="com.grok-mission-control.terminal"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$NEW_LABEL.plist"
LEGACY_PLIST="$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"

# Canonical data dir: ~/.mission-control (migrate legacy once).
MODERN_DATA_DIR="$HOME/.mission-control"
LEGACY_DATA_DIR="$HOME/.grok-mission-control"
if [[ ! -d "$MODERN_DATA_DIR" && -d "$LEGACY_DATA_DIR" ]]; then
  echo "Migrating data dir: $LEGACY_DATA_DIR → $MODERN_DATA_DIR"
  mv "$LEGACY_DATA_DIR" "$MODERN_DATA_DIR"
fi

# MC_DATA_DIR wins only when it is not the legacy path (LaunchAgent may still
# point there after migrate).
if [[ -n "${MC_DATA_DIR:-}" && "${MC_DATA_DIR}" != "$LEGACY_DATA_DIR" && "${MC_DATA_DIR}" != "$LEGACY_DATA_DIR/" ]]; then
  DATA_DIR="$MC_DATA_DIR"
else
  DATA_DIR="$MODERN_DATA_DIR"
fi

LOG_DIR="$DATA_DIR/logs"
LAUNCHER_BIN="$DATA_DIR/bin/mc"
BUN_BIN="$(command -v bun)"
NODE_BIN="$(command -v node)"
CODEX_BIN="$(command -v codex || true)"
GROK_BIN="$(command -v grok || true)"
PI_BIN="$(command -v pi || true)"
# Cursor Agent CLI is `agent` / `cursor-agent` (not the IDE shim named `cursor`)
CURSOR_BIN="$(command -v agent || command -v cursor-agent || true)"
CLAUDE_BIN="$(command -v claude || true)"
AMP_BIN="$(command -v amp || true)"
DEVIN_BIN="$(command -v devin || true)"
DROID_BIN="$(command -v droid || true)"
TERMINAL_PATH="$DATA_DIR/bin:$HOME/.npm-global/bin:$HOME/.grok/bin:$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Workspace root for launcher + default cwd (optional override).
if [[ -n "${MC_WORKSPACE_ROOT:-}" ]]; then
  WORKSPACE_ROOT="$MC_WORKSPACE_ROOT"
elif [[ -d "$HOME/dev" ]]; then
  WORKSPACE_ROOT="$HOME/dev"
else
  WORKSPACE_ROOT="$HOME"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$DATA_DIR/bin"

# Remove legacy agent if present so we don't double-spawn.
if [[ -f "$LEGACY_PLIST" ]]; then
  launchctl bootout "gui/$(id -u)" "$LEGACY_PLIST" >/dev/null 2>&1 || true
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$NEW_LABEL</string>

  <key>WorkingDirectory</key>
  <string>$ROOT</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT/terminal/start.mjs</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>BUN_BIN</key>
    <string>$BUN_BIN</string>

    <key>MC_DATA_DIR</key>
    <string>$DATA_DIR</string>

    <key>MC_WORKSPACE_ROOT</key>
    <string>$WORKSPACE_ROOT</string>

    <key>MC_BIND_HOST</key>
    <string>127.0.0.1</string>

    <key>MC_LAUNCHER</key>
    <string>$LAUNCHER_BIN</string>

    <key>GROK_TERMINAL_LAUNCHER</key>
    <string>$LAUNCHER_BIN</string>

    <key>GROK_TERMINAL_CODEX_COMMAND</key>
    <string>${CODEX_BIN:-codex}</string>

    <key>GROK_TERMINAL_GROK_COMMAND</key>
    <string>${GROK_BIN:-grok}</string>

    <key>GROK_TERMINAL_PI_COMMAND</key>
    <string>${PI_BIN:-pi}</string>

    <key>GROK_TERMINAL_CURSOR_COMMAND</key>
    <string>${CURSOR_BIN:-agent}</string>

    <key>GROK_TERMINAL_CLAUDE_COMMAND</key>
    <string>${CLAUDE_BIN:-claude}</string>

    <key>GROK_TERMINAL_AMP_COMMAND</key>
    <string>${AMP_BIN:-amp}</string>

    <key>GROK_TERMINAL_DEVIN_COMMAND</key>
    <string>${DEVIN_BIN:-devin}</string>

    <key>GROK_TERMINAL_DROID_COMMAND</key>
    <string>${DROID_BIN:-droid}</string>

    <key>PATH</key>
    <string>$TERMINAL_PATH</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/terminal.out.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/terminal.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$NEW_LABEL"

echo "Installed and started $NEW_LABEL"
echo "Data dir: $DATA_DIR"
echo "Workspace root: $WORKSPACE_ROOT"
echo "Terminal URL: http://127.0.0.1:4321"
echo "Logs:"
echo "  $LOG_DIR/terminal.out.log"
echo "  $LOG_DIR/terminal.err.log"
