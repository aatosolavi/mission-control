import { NextRequest, NextResponse } from "next/server";
import { agentManager } from "@/lib/agent-manager";
import { acpSessionManager } from "@/lib/harness/acp/AcpSessionManager";
import { grokAcpAdapter } from "@/lib/harness/GrokAcpAdapter";

/**
 * GET /api/threads/:id
 * Full thread + recent events (for the peek/detail view)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Prefer ACP (rich events), fallback to legacy
  const thread = acpSessionManager.getThread(id) || agentManager.getThread(id);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const events = acpSessionManager.getThread(id)
    ? acpSessionManager.getEvents(id, 300)
    : agentManager.getEvents(id, 300);

  // Also surface pending permission if any (for UI modals)
  const pending = acpSessionManager.getPendingPermission(id);
  const extra = pending ? { pendingPermission: pending } : {};

  return NextResponse.json({ thread, events, ...extra });
}

/**
 * POST /api/threads/:id/message
 * Send a steering message (high-level guidance) to the thread.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const thread = acpSessionManager.getThread(id) || agentManager.getThread(id);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const message = typeof body.message === "string" ? body.message : "";

    if (!message.trim()) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    // If this is an ACP thread, use the rich session/prompt path
    const isAcp = !!acpSessionManager.getThread(id);
    if (isAcp) {
      await grokAcpAdapter.sendPrompt(id, message);
    } else {
      await agentManager.sendMessage(id, message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API] sendMessage failed", err);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/threads/:id
 * Kill the thread (SIGTERM then SIGKILL)
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const thread = acpSessionManager.getThread(id) || agentManager.getThread(id);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const isAcp = !!acpSessionManager.getThread(id);
  if (isAcp) {
    await grokAcpAdapter.kill(id);
  } else {
    await agentManager.killThread(id);
  }

  return NextResponse.json({ ok: true });
}
