import { NextRequest, NextResponse } from "next/server";
import { acpSessionManager } from "@/lib/harness/acp/AcpSessionManager";
import * as acp from "@agentclientprotocol/sdk";

/**
 * POST /api/threads/:id/permission-response
 *
 * The response side of the requestPermission round-trip.
 * The dashboard (or any client) calls this after the human reviews the
 * permission_request event and chooses an option.
 *
 * Body examples:
 *   { outcome: "cancelled" }
 *   { outcome: "approved", optionId: "..." }   // the optionId comes from the request's options[]
 *   { selectedOptionId: "..." }                // convenience alias
 *
 * This unblocks the agent (resolves the Promise inside the ACP Client impl).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const thread = acpSessionManager.getThread(id);
  if (!thread) {
    return NextResponse.json(
      {
        error:
          "ACP Thread not found (permissions only supported for ACP harness)",
      },
      { status: 404 },
    );
  }

  try {
    const body = await req.json();

    // Always look up the *current* pending request for validation (P1 Finding 5).
    // Reject stale/wrong optionIds (double-click, replay, malicious client) with 400.
    const pending = acpSessionManager.getPendingPermission(id);
    if (!pending) {
      return NextResponse.json(
        {
          error:
            "No pending permission request for this thread (stale or already resolved)",
        },
        { status: 400 },
      );
    }
    const reqAny: any = pending.request as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- evolving SDK RequestPermissionRequest shape (matches harness pattern)
    const validOptions: string[] = (reqAny?.options || [])
      .map((o: any) => o.optionId || o.id) // eslint-disable-line @typescript-eslint/no-explicit-any -- evolving SDK option shape
      .filter(Boolean);

    let response: acp.RequestPermissionResponse;

    if (body.outcome === "cancelled") {
      response = {
        outcome: { outcome: "cancelled" },
      } as acp.RequestPermissionResponse;
    } else if (body.selectedOptionId || body.optionId) {
      const optionId = body.selectedOptionId || body.optionId;
      if (validOptions.length > 0 && !validOptions.includes(optionId)) {
        return NextResponse.json(
          {
            error:
              "selectedOptionId is not one of the options in the current pending permission request",
          },
          { status: 400 },
        );
      }
      response = {
        outcome: { outcome: "selected", optionId },
      } as acp.RequestPermissionResponse;
    } else if (body.outcome === "approved" || body.approved === true) {
      // Fallback to first valid option (or cancel)
      const firstId = validOptions[0];
      if (firstId) {
        response = {
          outcome: { outcome: "selected", optionId: firstId },
        } as acp.RequestPermissionResponse;
      } else {
        console.warn(
          "[permission-response] approved without optionId; defaulting to cancel for safety",
        );
        response = {
          outcome: { outcome: "cancelled" },
        } as acp.RequestPermissionResponse;
      }
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid permission response body. Provide outcome or selectedOptionId.",
        },
        { status: 400 },
      );
    }

    await acpSessionManager.respondToPermission(id, response);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API] permission-response failed", err);
    return NextResponse.json(
      { error: "Failed to deliver permission response" },
      { status: 500 },
    );
  }
}
