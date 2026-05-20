import { NextRequest, NextResponse } from "next/server";
import { acpSessionManager } from "@/lib/harness/acp/AcpSessionManager";
import { agentManager } from "@/lib/agent-manager";
import { grokAcpAdapter } from "@/lib/harness/GrokAcpAdapter";

/**
 * POST /api/threads/:id/prompt
 *
 * Send a follow-up natural-language prompt / steering message to an existing
 * ACP session (or legacy thread). This is the primary "chat to the agent" contract.
 *
 * Body: { prompt: string }
 *
 * For ACP threads this becomes a real `session/prompt` round-trip with live updates.
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
    const prompt = typeof body.prompt === "string" ? body.prompt : "";

    if (!prompt.trim()) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 },
      );
    }

    const isAcp = !!acpSessionManager.getThread(id);
    if (isAcp) {
      await grokAcpAdapter.sendPrompt(id, prompt);
    } else {
      // Legacy fallback (limited)
      await agentManager.sendMessage(id, prompt);
    }

    return NextResponse.json({ ok: true, via: isAcp ? "acp" : "legacy" });
  } catch (err) {
    console.error("[API] /prompt failed", err);
    return NextResponse.json(
      { error: "Failed to send prompt" },
      { status: 500 },
    );
  }
}
