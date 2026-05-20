import { NextRequest, NextResponse } from "next/server";
import { agentManager } from "@/lib/agent-manager"; // legacy fallback
import { CreateThreadInputSchema } from "@/lib/types";
import { z } from "zod";
import { grokAcpAdapter } from "@/lib/harness/GrokAcpAdapter";
import { acpSessionManager } from "@/lib/harness/acp/AcpSessionManager";

/**
 * GET /api/threads
 * Returns all threads (lightweight list for the dashboard)
 */
export async function GET() {
  // Merge ACP (primary) + legacy headless threads for the dashboard list.
  const acpThreads = acpSessionManager.getAllThreads();
  const legacyThreads = agentManager.getAllThreads();

  // De-dupe by id (ACP wins if somehow both)
  const byId = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any -- Thread union (ACP + legacy) for de-dupe
  for (const t of legacyThreads) byId.set(t.id, t);
  for (const t of acpThreads) byId.set(t.id, t);

  const threads = Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return NextResponse.json({ threads });
}

/**
 * POST /api/threads
 * Create a new agent thread using the ACP harness (preferred) with legacy fallback.
 *
 * Body: { goal, cwd, title?, model?, role?, isolationLevel? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = CreateThreadInputSchema.parse(body);

    // Prefer the real ACP path
    if (input.harness === "grok-build-acp" || !input.harness) {
      const handle = await grokAcpAdapter.createThread({
        goal: input.goal,
        cwd: input.cwd,
        title: input.title,
        model: input.model,
        role: input.role as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- schema input cast for ACP (evolving)
        isolationLevel: input.isolationLevel as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- schema input cast for ACP (evolving)
      });

      // For now return a minimal thread shape the old UI can render.
      // Later we will unify on a single Thread type persisted in SQLite.
      const thread = {
        id: handle.threadId,
        missionId: "default",
        title: input.title || input.goal.slice(0, 60),
        goal: input.goal,
        cwd: input.cwd,
        harness: "grok-build-acp",
        status: "working",
        pid: handle.processPid,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return NextResponse.json(
        { thread, acpSessionId: handle.acpSessionId },
        { status: 201 },
      );
    }

    // Legacy simple headless path (still useful for quick one-shots)
    const thread = await agentManager.createThread(input);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", issues: err.issues },
        { status: 400 },
      );
    }
    console.error("[API] Failed to create thread (ACP)", err);
    return NextResponse.json(
      { error: "Failed to create thread" },
      { status: 500 },
    );
  }
}
