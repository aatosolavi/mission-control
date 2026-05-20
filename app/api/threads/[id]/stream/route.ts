import { NextRequest } from "next/server";
import { agentManager } from "@/lib/agent-manager";
import { acpSessionManager } from "@/lib/harness/acp/AcpSessionManager";

/**
 * GET /api/threads/:id/stream
 *
 * Server-Sent Events endpoint for real-time thread events.
 * The frontend can listen with EventSource and get instant updates
 * whenever the agent emits new output, status changes, etc.
 *
 * This is the foundation for the "live feel" in the dashboard.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Support both ACP (primary) and legacy
  const isAcp = !!acpSessionManager.getThread(id);
  const thread = isAcp
    ? acpSessionManager.getThread(id)
    : agentManager.getThread(id);
  if (!thread) {
    return new Response("Thread not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "connected", threadId: id });

      // Subscribe to the correct emitter *first* (P2 Finding 8), before snapshotting history.
      // Any events emitted in the tiny window are delivered live; we de-duplicate the
      // initial history payload by event.id so the client never sees loss or dups.
      const emitter = isAcp
        ? acpSessionManager.getEventEmitter(id)
        : agentManager.getEventEmitter(id);

      const onEvent = (event: unknown) => {
        send({ type: "event", event });
      };

      if (emitter) {
        emitter.on("event", onEvent);
      }

      // History from the right source (full recent snapshot after listener attach to avoid
      // missed events). Any window deliveries are deduplicated on the client append side.
      const recent = isAcp
        ? acpSessionManager.getEvents(id, 50)
        : agentManager.getEvents(id, 50);
      send({
        type: "history",
        events: recent,
      });

      if (!emitter) {
        send({
          type: "event",
          event: {
            type: "status",
            payload: {
              status: (thread as any).status, // eslint-disable-line @typescript-eslint/no-explicit-any -- thread from union of ACP/legacy, pre-existing cast
              note: "Process already exited",
            },
          },
        });
      }

      // Heartbeat
      const heartbeat = setInterval(() => {
        try {
          send({ type: "heartbeat", t: Date.now() });
        } catch {
          // closed
        }
      }, 15000);

      // Cleanup on client disconnect / abort (prevents listener leak on ManagedProcess emitters; Finding 6)
      const cleanup = () => {
        if (emitter) emitter.off("event", onEvent);
        clearInterval(heartbeat);
      };
      if (req.signal) {
        req.signal.addEventListener("abort", cleanup, { once: true });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
