/**
 * Dedicated Orchestrator Server (future home of the real implementation)
 *
 * For v0.1 we are running everything inside Next.js API routes + the
 * singleton agentManager for maximum speed of iteration.
 *
 * Once the core loop (create/watch/steer) feels excellent, we will
 * extract the heavy process management, SQLite persistence, and
 * ACP client into this Hono + Bun server.
 *
 * Run with: bun server/orchestrator.ts
 */

console.log(`
Mission Control — Orchestrator Server (placeholder)

This will become the authoritative owner of:
  - All agent child processes (grok, future claude, etc.)
  - SQLite persistence (~/.grok-mission-control/db.sqlite)
  - WebSocket + REST API for the Next.js frontend
  - Real ACP client implementation

For now, development happens via the in-app manager in lib/agent-manager.ts
and the /api/threads routes. This gives the fastest feedback loop.

When you're ready to extract, start here.
`);

export {};
