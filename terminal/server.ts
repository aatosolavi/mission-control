/**
 * T-0 — HTML server for the browser terminal (Bun).
 *
 * Serves index.html on :4321. The real PTY lives in terminal/pty-server.mjs
 * under Node (node-pty is more reliable there than under Bun on macOS).
 *
 *   bun run terminal  →  http://127.0.0.1:4321
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { dataDir } from "./data-dir.mjs";

const PORT = Number(process.env.MC_HTML_PORT || process.env.PORT || 4321);
const HOST = process.env.MC_BIND_HOST || "127.0.0.1";
const MAX_ATTACHMENTS = Number(process.env.MC_MAX_ATTACHMENTS || 20);
const MAX_ATTACHMENT_BYTES = Number(process.env.MC_MAX_ATTACHMENT_BYTES || 25 * 1024 * 1024);
const currentDir = dirname(fileURLToPath(import.meta.url));

function resolveDataDir(): string {
  return dataDir();
}

// For fast iteration during testing we re-read the HTML on every request.
// (Cheap on localhost. We can cache later.)
function getHtml(): string {
  try {
    return readFileSync(resolve(currentDir, "index.html"), "utf8");
  } catch {
    return "<h1>T-0</h1><p>index.html not found next to server.ts</p>";
  }
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "attachment";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "attachment";
  }
  return cleaned.slice(0, 180);
}

function attachmentDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = crypto.randomUUID().slice(0, 8);
  const dir = join(resolveDataDir(), "attachments", `${stamp}-${random}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

if (HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") {
  if (process.env.MC_ALLOW_REMOTE_BIND !== "1") {
    console.error(
      `[T-0] Refusing bind host ${HOST}. Use 127.0.0.1 or set MC_ALLOW_REMOTE_BIND=1 (dangerous).`,
    );
    process.exit(78);
  }
  console.warn(`[T-0] WARNING: binding HTML server to ${HOST}`);
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,

  async fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname === "/attachments" && req.method === "POST") {
      const form = await req.formData();
      const files = form
        .getAll("files")
        .filter((item): item is File => item instanceof File);

      if (files.length === 0) {
        return Response.json({ error: "No files uploaded" }, { status: 400 });
      }
      if (files.length > MAX_ATTACHMENTS) {
        return Response.json(
          { error: `Too many files (max ${MAX_ATTACHMENTS})` },
          { status: 400 },
        );
      }

      const dir = attachmentDir();
      const paths: string[] = [];

      for (const file of files) {
        if (typeof file.size === "number" && file.size > MAX_ATTACHMENT_BYTES) {
          return Response.json(
            { error: `File too large (max ${MAX_ATTACHMENT_BYTES} bytes)` },
            { status: 400 },
          );
        }
        const safeName = sanitizeFileName(file.name);
        const path = resolve(join(dir, safeName));
        if (!path.startsWith(resolve(dir) + "/") && path !== resolve(dir)) {
          return Response.json({ error: "Invalid file name" }, { status: 400 });
        }
        await Bun.write(path, file);
        paths.push(path);
      }

      return Response.json({ paths });
    }

    // Everything else → the beautiful full-page terminal
    // Fresh read so you can edit index.html and just reload the tab during testing.
    return new Response(getHtml(), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  },

});

const openHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
console.log("");
console.log("T-0 HTML server ready (Bun)");
console.log(`    Open http://${openHost}:${PORT}`);
console.log("");
console.log("   The real PTY lives in a separate Node process (terminal/pty-server.mjs on :4322).");
console.log("   Run `bun run terminal` to start both pieces together.");
console.log("");

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down terminal server...");
  server.stop(true);
  process.exit(0);
});
