#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

const children = new Set();

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`[terminal] ${name} exited with ${signal || code}`);
      shutdown(code || 1);
    }
  });

  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Process already exited.
    }
  }

  setTimeout(() => process.exit(code), 150).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// PORT (e.g. from portless) is meant for the HTML server; the broker
// would otherwise fall back to it and collide. Use MC_PTY_PORT for the broker.
const { PORT: _port, ...brokerEnv } = process.env;
start("pty broker", process.execPath, ["terminal/pty-server.mjs"], brokerEnv);
start("html server", process.env.BUN_BIN || "bun", ["run", "terminal/server.ts"]);

console.log("[terminal] Open http://localhost:4321");
