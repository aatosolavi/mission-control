/**
 * Grok Terminal — Minimal Level-1 MVP
 *
 * A real local shell (zsh/bash) running inside a browser tab via xterm.js + PTY over WebSocket.
 *
 * Why this exists (per the Helium + mission-control vision):
 * - Open a tab in Helium (or any browser) that *is* your terminal.
 * - Cmd+T in Helium = instant new real shell.
 * - Zero friction, native mental model, perfect for agentic work later.
 *
 * Run:
 *   bun run terminal
 *
 * Then visit http://localhost:4321
 *
 * For Helium new-tab override:
 *   - Load the extension/ folder (or point chrome_url_overrides.newtab at a redirector)
 *   - Or simply use this URL as your new-tab page.
 *
 * This is the "first version" concrete experience while the richer ACP dashboard
 * lives on the main branch.
 */

import pty from "node-pty";
import type { IPty } from "node-pty";
import { readFileSync } from "fs";
import { resolve } from "path";

const PORT = Number(process.env.PORT || 4321);
const SHELL = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");

let htmlContent: string;
try {
  htmlContent = readFileSync(resolve(import.meta.dir, "index.html"), "utf8");
} catch {
  htmlContent = "<h1>Grok Terminal</h1><p>index.html not found next to server.ts</p>";
}

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

const server = Bun.serve({
  port: PORT,

  async fetch(req: Request, server: any) {
    const url = new URL(req.url);

    // WebSocket upgrade for the PTY
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: { createdAt: Date.now() },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Everything else → the beautiful full-page terminal
    // We could add cache headers etc., but for local dev this is perfect.
    return new Response(htmlContent, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  },

  websocket: {
    async open(ws: any) {
      // Spawn a real PTY shell for this connection
      const cols = 80;
      const rows = 24;

      const ptyProcess: IPty = pty.spawn(SHELL, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.env.HOME || process.cwd(),
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          // Make many CLIs behave nicely inside the web terminal
          FORCE_COLOR: "1",
        },
        // Important on macOS: use the user's login shell behavior
        useConpty: false,
      });

      // Store the pty on the websocket for later
      ws.pty = ptyProcess;
      ws.isAlive = true;

      // Stream PTY output → browser
      ptyProcess.onData((data: string) => {
        if (ws.readyState === 1) {
          ws.send(data);
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        if (ws.readyState === 1) {
          ws.send(`\r\n\r\n[process exited${signal ? ` (signal ${signal})` : ""} — code ${exitCode}]\r\n`);
          ws.close();
        }
      });

      // Friendly banner
      ws.send(`\r\n\x1b[38;5;10mGrok Terminal\x1b[0m — real local ${SHELL.split("/").pop()} PTY\r\n`);
      ws.send(`Connected at ${new Date().toLocaleTimeString()} • resize works automatically\r\n\r\n`);
    },

    message(ws: any, message: string | Buffer) {
      const ptyProcess: IPty | undefined = ws.pty;
      if (!ptyProcess) return;

      // Control messages (resize) are sent as JSON
      const text = message.toString();

      if (text.startsWith("{")) {
        try {
          const msg = JSON.parse(text) as ResizeMessage;
          if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
            ptyProcess.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
            return;
          }
        } catch {
          // fall through and treat as raw data (unlikely)
        }
      }

      // Normal user keystrokes / paste → real PTY
      ptyProcess.write(text);
    },

    close(ws: any) {
      const ptyProcess: IPty | undefined = ws.pty;
      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch {
          // already dead
        }
      }
    },
  },
});

console.log("");
console.log("🚀  Grok Terminal (Level-1 MVP) ready");
console.log(`    http://localhost:${PORT}`);
console.log("");
console.log("   • This browser tab is now a real local shell (zsh/bash + full PTY).");
console.log("   • Works great as a Helium new-tab page or any browser Cmd+T target.");
console.log("   • Later: embed the same xterm component inside the mission-control dashboard");
console.log("     (one pane per agent thread, or a “raw terminal” view of a GrokBuild session).");
console.log("");
console.log("   Press Ctrl+C inside the terminal as usual. The shell is real.");
console.log("");

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down terminal server...");
  server.stop(true);
  process.exit(0);
});
