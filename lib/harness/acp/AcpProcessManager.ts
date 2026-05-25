/**
 * AcpProcessManager
 *
 * Owns the lifecycle of `grok agent stdio` (ACP) processes and their
 * ClientSideConnection instances.
 *
 * Design goals:
 * - One process can drive many sessions (efficient default).
 * - Easy to opt into dedicated processes per worker for Factory-style isolation.
 * - Clean implementation of the `acp.Client` interface (especially requestPermission + sessionUpdate).
 * - Exposes high-level operations the rest of the app needs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ACP SDK shapes are still evolving; any bridges are isolated here for v0.2 */

import { spawn, ChildProcess } from "child_process";
import { Writable, Readable } from "stream";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import * as acp from "@agentclientprotocol/sdk";
import type {
  AcpNormalizedEvent,
  CreateAcpThreadOptions,
  AcpThreadHandle,
  PendingPermissionInfo,
} from "./types";
import type { Thread, ThreadEvent, ThreadStatus } from "../../types";

type ManagedProcess = {
  proc: ChildProcess;
  connection: acp.ClientSideConnection;
  emitter: EventEmitter; // for broadcasting session/update to interested parties
  sessionCount: number;
  createdAt: Date;
};

type ActiveSession = {
  sessionId: string;
  processKey: string; // which ManagedProcess
  threadId: string;
  cwd: string;
  pendingPermission?: acp.RequestPermissionRequest;
};

export class AcpProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private sessions = new Map<string, ActiveSession>(); // acpSessionId -> ActiveSession
  private threadToSession = new Map<string, string>(); // our threadId -> acpSessionId

  // ACP registry for unified list/detail/stream with legacy paths (UI compat)
  private acpThreads = new Map<string, Thread>();
  private acpEvents = new Map<string, ThreadEvent[]>();

  // Permission resolvers so requestPermission can block until UI responds via API
  private pendingPermissionResolvers = new Map<
    string,
    {
      request: acp.RequestPermissionRequest;
      resolve: (resp: acp.RequestPermissionResponse) => void;
      reject?: (err: unknown) => void;
    }
  >();

  // In-flight process creation promises to eliminate TOCTOU spawn race for shared processKey (Finding 2)
  private inFlightProcessCreation = new Map<string, Promise<ManagedProcess>>();

  // Single ACP Client implementation (shared across all processes/connections).
  // The factory passed to ClientSideConnection just returns this.
  // All routing inside uses sessionId from the incoming params.
  private readonly clientImpl: acp.Client = {
    requestPermission: async (
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
      const acpSessionId = params.sessionId;
      const sess = this.sessions.get(acpSessionId);
      if (!sess) {
        console.warn(
          "[AcpProcessManager] requestPermission for unknown session",
          acpSessionId,
        );
        return {
          outcome: { outcome: "cancelled" },
        } as acp.RequestPermissionResponse;
      }
      const threadId = sess.threadId;

      // Emit normalized + legacy-shaped event so UI can react (permission modal, status)
      this.emitNormalizedEvent(threadId, {
        kind: "permission_request",
        request: params,
      });
      this.pushAcpEvent(threadId, {
        id: randomUUID(),
        threadId,
        type: "permission_request",
        timestamp: new Date(),
        payload: params,
      });

      // Update our registry status so list/detail shows awaiting_permission
      const t = this.acpThreads.get(threadId);
      if (t) {
        t.status = "awaiting_permission";
        t.updatedAt = new Date();
        this.acpThreads.set(threadId, t);
      }

      // Block the agent until the PM responds via respondToPermission
      console.log(
        `[AcpProcessManager] Permission requested for thread ${threadId} (session ${acpSessionId}) — blocking until response`,
      );

      return new Promise<acp.RequestPermissionResponse>((resolve, reject) => {
        // Guard against duplicate rapid requests on same session (overwrite would hang prior)
        const existing = this.pendingPermissionResolvers.get(acpSessionId);
        if (existing?.resolve) {
          existing.resolve({
            outcome: { outcome: "cancelled" },
          } as acp.RequestPermissionResponse);
        }
        this.pendingPermissionResolvers.set(acpSessionId, {
          request: params,
          resolve,
          reject,
        });
      });
    },

    sessionUpdate: async (params: acp.SessionNotification): Promise<void> => {
      const acpSessionId = params.sessionId;
      const sess = this.sessions.get(acpSessionId);
      if (!sess) return;
      const threadId = sess.threadId;

      const update = params.update;
      let normalized: AcpNormalizedEvent;

      // Match shapes from SDK examples + protocol for robustness
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
        case "user_message_chunk":
          {
            const content: any = (update as any).content;
            const text =
              content?.type === "text" ? content.text : content?.text || "";
            normalized = {
              kind: "message_chunk",
              role:
                update.sessionUpdate === "agent_message_chunk"
                  ? "agent"
                  : "user",
              text,
            };
          }
          break;
        case "agent_thought_chunk":
          {
            const content: any = (update as any).content;
            const text =
              content?.type === "text" ? content.text : content?.text || "";
            normalized = {
              kind: "message_chunk",
              role: "thought",
              text,
            };
          }
          break;
        case "tool_call":
          normalized = {
            kind: "tool_call",
            id: (update as any).toolCallId ?? (update as any).id ?? "unknown",
            title: (update as any).title ?? "Tool call",
            status: (update as any).status ?? "pending",
            content: update,
          };
          break;
        case "tool_call_update":
          normalized = {
            kind: "tool_call_update",
            id: (update as any).toolCallId ?? (update as any).id ?? "unknown",
            status: (update as any).status ?? "pending",
            content: update,
          };
          break;
        case "plan":
          normalized = { kind: "plan", plan: update };
          break;
        default:
          normalized = { kind: "raw", data: update };
      }

      this.emitNormalizedEvent(threadId, normalized);

      // Also materialize as ThreadEvent for UI stream/detail compatibility
      const ev = this.normalizedToThreadEvent(threadId, normalized);
      this.pushAcpEvent(threadId, ev);

      // Heuristic status updates from common events
      const t = this.acpThreads.get(threadId);
      if (t) {
        if (
          update.sessionUpdate === "tool_call" ||
          update.sessionUpdate === "tool_call_update"
        ) {
          t.status = "working";
        }
        t.updatedAt = new Date();
        this.acpThreads.set(threadId, t);
      }
    },

    // FS stubs (advertised disabled in initialize caps). Explicitly reject so a mis-flipped
    // capability or agent call cannot fabricate repo state (P2 Finding 10).
    async readTextFile(params: any) {
      const msg = `Filesystem access not implemented in this harness (read ${params?.path ?? ""}). Caps are false.`;
      console.warn("[AcpProcessManager]", msg);
      throw new Error(msg);
    },
    async writeTextFile(params: any) {
      const msg = `Filesystem access not implemented in this harness (write ${params?.path ?? ""}). Caps are false.`;
      console.warn("[AcpProcessManager]", msg);
      throw new Error(msg);
    },
  } as acp.Client;

  private emitNormalizedEvent(threadId: string, event: AcpNormalizedEvent) {
    // Find the process that owns this thread and emit on its emitter
    const acpSessionId = this.threadToSession.get(threadId);
    if (!acpSessionId) return;

    const sess = this.sessions.get(acpSessionId);
    if (!sess) return;

    const proc = this.processes.get(sess.processKey);
    if (proc) {
      proc.emitter.emit("acp-event", { threadId, acpSessionId, event });
      // "event" (legacy ThreadEvent) is emitted only from pushAcpEvent to avoid dupes (Finding 3).
      // "acp-event" is for future typed consumers.
    }
  }

  /**
   * Convert our internal normalized ACP event into the legacy ThreadEvent shape
   * that the existing UI + /api threads detail/stream already understand.
   */
  private normalizedToThreadEvent(
    threadId: string,
    norm: AcpNormalizedEvent,
  ): ThreadEvent {
    let type: ThreadEvent["type"] = "stdout";
    let payload: unknown = norm;

    switch (norm.kind) {
      case "message_chunk":
        type = "message";
        payload = { role: norm.role, text: norm.text };
        break;
      case "tool_call":
      case "tool_call_update":
        type = "tool_call";
        payload = {
          id: (norm as any).id,
          title: (norm as any).title,
          status: (norm as any).status,
          ...((norm as any).content || {}),
        };
        break;
      case "plan":
        type = "stdout"; // or we could add "plan" to schema later
        payload = { plan: norm.plan };
        break;
      case "permission_request":
        type = "permission_request";
        payload = norm.request;
        break;
      case "status":
        type = "status";
        payload = { text: norm.text };
        break;
      case "error":
        type = "stderr";
        payload = { message: norm.message };
        break;
      default:
        type = "stdout";
        payload = norm;
    }

    return {
      id: randomUUID(),
      threadId,
      type,
      timestamp: new Date(),
      payload,
    };
  }

  /**
   * Push a (legacy-shaped) event into the ACP per-thread history and notify emitters.
   */
  private pushAcpEvent(threadId: string, event: ThreadEvent) {
    const list = this.acpEvents.get(threadId) || [];
    list.push(event);
    this.acpEvents.set(threadId, list);

    // Notify any live SSE subscribers (they listen on the process emitter for "event")
    const acpSessionId = this.threadToSession.get(threadId);
    if (acpSessionId) {
      const sess = this.sessions.get(acpSessionId);
      if (sess) {
        const proc = this.processes.get(sess.processKey);
        proc?.emitter.emit("event", event);
      }
    }
  }

  /**
   * Spawn (or reuse) an ACP process and create a new session for a thread.
   */
  async createThread(
    options: CreateAcpThreadOptions,
  ): Promise<AcpThreadHandle> {
    const threadId = randomUUID();
    const processKey = this.chooseOrCreateProcessKey(options.isolationLevel);

    let managed = this.processes.get(processKey);

    if (!managed) {
      let promise = this.inFlightProcessCreation.get(processKey);
      if (!promise) {
        promise = this.spawnNewAcpProcess(processKey)
          .then((m) => {
            this.processes.set(processKey, m);
            this.inFlightProcessCreation.delete(processKey);
            return m;
          })
          .catch((e) => {
            this.inFlightProcessCreation.delete(processKey);
            throw e;
          });
        this.inFlightProcessCreation.set(processKey, promise);
      }
      managed = await promise;
    }

    // Create the actual ACP session
    const newSessionParams: acp.NewSessionRequest = {
      cwd: options.worktreePath || options.cwd,
      mcpServers: (options.mcpServers as any) || [],
    };

    const sessionRes = await managed.connection.newSession(newSessionParams);

    const acpSessionId = sessionRes.sessionId;

    this.sessions.set(acpSessionId, {
      sessionId: acpSessionId,
      processKey,
      threadId,
      cwd: options.cwd,
    });
    this.threadToSession.set(threadId, acpSessionId);

    managed.sessionCount++;

    // Register Thread + initial event in ACP registry so /api/threads, detail, and stream
    // surface ACP threads to the existing dashboard without touching legacy AgentManager.
    const now = new Date();
    const acpThread: Thread = {
      id: threadId,
      missionId: "default",
      title:
        options.title ||
        options.goal.slice(0, 60) + (options.goal.length > 60 ? "..." : ""),
      goal: options.goal,
      cwd: options.cwd,
      harness: "grok-build-acp",
      status: "working" as ThreadStatus,
      pid: managed.proc.pid ?? undefined,
      model: options.model,
      createdAt: now,
      updatedAt: now,
    };
    this.acpThreads.set(threadId, acpThread);
    if (!this.acpEvents.has(threadId)) this.acpEvents.set(threadId, []);

    this.pushAcpEvent(threadId, {
      id: randomUUID(),
      threadId,
      type: "status",
      timestamp: now,
      payload: { status: "working", via: "acp", pid: managed.proc.pid },
    });

    // Fire the initial goal prompt *in the background* (P1 fix for Finding 1).
    // Register + return the handle immediately so POST /api/threads returns fast (no
    // "Spawning..." hang, no hosted timeout, permission flows on first turn are observable
    // via the normal event stream + pendingPermission). Errors surface as status/error events.
    managed.connection
      .prompt({
        sessionId: acpSessionId,
        prompt: [{ type: "text", text: options.goal }],
      })
      .catch((err) => {
        console.error(
          `[AcpProcessManager] initial prompt failed for ${threadId}`,
          err,
        );
        const t = this.acpThreads.get(threadId);
        if (t) {
          t.status = "error" as ThreadStatus;
          t.updatedAt = new Date();
          this.acpThreads.set(threadId, t);
        }
        this.pushAcpEvent(threadId, {
          id: randomUUID(),
          threadId,
          type: "stderr",
          timestamp: new Date(),
          payload: { message: `Initial prompt error: ${err?.message || err}` },
        });
      });

    return {
      threadId,
      acpSessionId,
      processPid: managed.proc.pid!,
      sendPrompt: async (p) =>
        managed!.connection.prompt({
          sessionId: acpSessionId,
          prompt: typeof p === "string" ? [{ type: "text", text: p }] : p,
        }),
      cancel: async () =>
        managed!.connection.cancel({ sessionId: acpSessionId }),
      // No killProcess on public handle (P2 Finding 9): it was a direct processKey kill
      // that would nuke shared 'grok agent stdio' + all sibling sessions. Use the safe
      // kill(threadId) path (adapter -> PM.kill) which does closeSession for shared.
    };
  }

  private chooseOrCreateProcessKey(
    isolation?: "shared-process" | "dedicated-process",
  ): string {
    if (isolation === "dedicated-process") {
      return `dedicated-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    // Default: find a process with low sessionCount or create the first one
    for (const [key, p] of this.processes) {
      if (p.sessionCount < 8) return key; // simple load balancing
    }
    return "shared-primary";
  }

  private async spawnNewAcpProcess(key: string): Promise<ManagedProcess> {
    console.log(
      `[AcpProcessManager] Spawning new grok agent stdio process (key=${key})`,
    );

    const proc = spawn("grok", ["agent", "stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Attach error listener *immediately* after spawn (before any await on connection).
    // This consumes the async 'error' event (e.g. grok missing from PATH) so it never
    // becomes an unhandled exception that can crash the Next.js server process (P1 Finding 6).
    // Failures surface via rejection of initialize/newSession etc, causing createThread to
    // fail cleanly for the API caller.
    proc.on("error", (err) => {
      console.error(
        `[AcpProcessManager] Child process error for key=${key}`,
        err,
      );
    });

    if (!proc.stdin || !proc.stdout) {
      throw new Error("Failed to get stdio pipes for grok agent stdio");
    }

    const input = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(proc.stdout) as unknown as ReadableStream<Uint8Array>;

    const stream = acp.ndJsonStream(input, output);

    const connection = new acp.ClientSideConnection(
      () => this.clientImpl,
      stream,
    );

    // Register process lifecycle (emitter + managed + exit/error handlers) *immediately*
    // after spawn + connection setup, before any await initialize()/authenticate().
    // This closes the early-process leak (P1): on auth/init failure or early exit the
    // child is either killed explicitly or cleaned by the exit handler; no unmanaged stdio grok left.
    const emitter = new EventEmitter();

    const managed: ManagedProcess = {
      proc,
      connection,
      emitter,
      sessionCount: 0,
      createdAt: new Date(),
    };

    // Basic process hygiene + full cleanup for orphaned sessions on crash/death (Finding 1)
    // Attached before awaits so early failures (bad auth, protocol error) are always handled.
    proc.on("exit", (code) => {
      console.log(`[AcpProcessManager] Process ${key} exited (code ${code})`);
      // Enumerate and clean any sessions still tied to this processKey (handles shared + dedicated)
      for (const [acpSessionId, sess] of Array.from(this.sessions.entries())) {
        if (sess.processKey !== key) continue;
        const threadId = sess.threadId;
        // Settle pending permission Promise so it does not hang (Finding 5)
        const pending = this.pendingPermissionResolvers.get(acpSessionId);
        if (pending?.resolve) {
          pending.resolve({
            outcome: { outcome: "cancelled" },
          } as acp.RequestPermissionResponse);
          this.pendingPermissionResolvers.delete(acpSessionId);
        } else {
          this.pendingPermissionResolvers.delete(acpSessionId);
        }
        // Mark thread errored + record final event for observers
        const t = this.acpThreads.get(threadId);
        if (t) {
          t.status = "error" as ThreadStatus;
          t.updatedAt = new Date();
          this.acpThreads.set(threadId, t);
          this.pushAcpEvent(threadId, {
            id: randomUUID(),
            threadId,
            type: "status",
            timestamp: new Date(),
            payload: { status: "error", reason: "process exited", code },
          });
        }
        // Remove per-session mappings
        this.threadToSession.delete(threadId);
        this.sessions.delete(acpSessionId);
        // Keep *bounded* history for errored/crashed thread (P2 Finding 7): the events up to
        // the failure are the primary triage data. Truncate to last 100; full prune only on
        // explicit kill() or "forget". Active threads still grow until selected.
        const evs = this.acpEvents.get(threadId) || [];
        this.acpEvents.set(threadId, evs.slice(-100));
        // Keep the acpThreads entry (now error) so list shows the failure; history retained (bounded)
      }
      this.processes.delete(key);
    });

    proc.stderr?.on("data", (d) => {
      // Surface important stderr (auth errors, crashes, etc.)
      console.error(`[grok-agent ${key} stderr]`, d.toString().trim());
    });

    // Initialize + authenticate (following the official pattern).
    // Wrapped so that rejection (without exit) still terminates the child and rejects
    // the creation promise cleanly. The pre-attached exit handler guarantees cleanup.
    try {
      const initRes = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION || 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false }, // stubs only; real FS later (Finding 15)
        },
      });

      const authMethods = (initRes as any).authMethods || [];
      const methodId =
        process.env.XAI_API_KEY &&
        authMethods.some((m: any) => m.id === "xai.api_key")
          ? "xai.api_key"
          : authMethods.some((m: any) => m.id === "cached_token")
            ? "cached_token"
            : null;

      if (methodId) {
        await connection.authenticate({
          methodId,
          _meta: { headless: true },
        } as any);
      }
    } catch (err) {
      console.error(
        `[AcpProcessManager] Initialize/auth failed for key=${key}; killing child to prevent orphan process`,
        err,
      );
      try {
        proc.kill("SIGTERM");
      } catch {
        // best-effort; exit handler will still run if it dies
      }
      throw err;
    }

    return managed;
  }

  /**
   * Public helper so API routes / UI can subscribe to raw normalized events for a thread.
   */
  getEventEmitterForThread(threadId: string): EventEmitter | undefined {
    const acpSessionId = this.threadToSession.get(threadId);
    if (!acpSessionId) return undefined;
    const sess = this.sessions.get(acpSessionId);
    if (!sess) return undefined;
    return this.processes.get(sess.processKey)?.emitter;
  }

  async killProcess(processKey: string) {
    const p = this.processes.get(processKey);
    if (p) {
      p.proc.kill("SIGTERM");
      this.processes.delete(processKey);
    }
  }

  // =====================================================================
  // High-level per-thread control surface (used by GrokAcpAdapter + API routes)
  // These make sendPrompt / cancel / kill work after createThread returns.
  // =====================================================================

  async sendPrompt(
    threadId: string,
    prompt: string | acp.ContentBlock[],
  ): Promise<acp.PromptResponse> {
    const acpSessionId = this.threadToSession.get(threadId);
    if (!acpSessionId) throw new Error(`No ACP session for thread ${threadId}`);

    const sess = this.sessions.get(acpSessionId);
    if (!sess) throw new Error("Session gone");
    const proc = this.processes.get(sess.processKey);
    if (!proc) throw new Error("Process gone");

    const blocks: any[] =
      typeof prompt === "string"
        ? [{ type: "text", text: prompt }]
        : (prompt as any[]);

    // Record the outgoing user steering message
    this.pushAcpEvent(threadId, {
      id: randomUUID(),
      threadId,
      type: "message",
      timestamp: new Date(),
      payload: {
        role: "user",
        text: typeof prompt === "string" ? prompt : "[content blocks]",
      },
    });

    return proc.connection.prompt({
      sessionId: acpSessionId,
      prompt: blocks,
    });
  }

  async cancel(threadId: string): Promise<void> {
    const acpSessionId = this.threadToSession.get(threadId);
    if (!acpSessionId) return;

    // Settle any pending permission resolver with cancelled so that a /cancel (or
    // session/cancel) while blocked in requestPermission unblocks the agent promise
    // (P1 Finding 4). Matches the contract used in kill() + exit handler.
    const pending = this.pendingPermissionResolvers.get(acpSessionId);
    if (pending?.resolve) {
      pending.resolve({
        outcome: { outcome: "cancelled" },
      } as acp.RequestPermissionResponse);
      this.pendingPermissionResolvers.delete(acpSessionId);
    } else {
      this.pendingPermissionResolvers.delete(acpSessionId);
    }

    const sess = this.sessions.get(acpSessionId);
    const proc = sess ? this.processes.get(sess.processKey) : undefined;
    if (proc?.connection) {
      await proc.connection.cancel({ sessionId: acpSessionId });
    }
  }

  async kill(threadId: string): Promise<void> {
    const acpSessionId = this.threadToSession.get(threadId);
    if (!acpSessionId) return;
    const sess = this.sessions.get(acpSessionId);
    if (sess) {
      const processKey = sess.processKey;
      const managed = this.processes.get(processKey);
      const isDedicated = !!processKey && processKey.startsWith("dedicated-");
      // Settle any pending permission to unblock (Finding 5)
      const pending = this.pendingPermissionResolvers.get(acpSessionId);
      if (pending?.resolve) {
        pending.resolve({
          outcome: { outcome: "cancelled" },
        } as acp.RequestPermissionResponse);
        this.pendingPermissionResolvers.delete(acpSessionId);
      } else {
        this.pendingPermissionResolvers.delete(acpSessionId);
      }
      if (managed && !isDedicated) {
        // Shared: close only this session, keep process for siblings (Finding 4)
        try {
          await managed.connection.closeSession({ sessionId: acpSessionId });
        } catch (e) {
          console.warn(
            `[AcpProcessManager] closeSession for ${acpSessionId} failed (non-fatal)`,
            e,
          );
        }
        managed.sessionCount = Math.max(0, managed.sessionCount - 1);
      } else {
        // Dedicated or no managed: nuke whole process
        await this.killProcess(processKey);
      }
      this.sessions.delete(acpSessionId);
      this.threadToSession.delete(threadId);
    }
    const t = this.acpThreads.get(threadId);
    if (t) {
      t.status = "killed" as ThreadStatus;
      t.updatedAt = new Date();
      this.acpThreads.set(threadId, t);
      this.pushAcpEvent(threadId, {
        id: randomUUID(),
        threadId,
        type: "status",
        timestamp: new Date(),
        payload: { status: "killed" },
      });
    }
    this.acpThreads.delete(threadId);
    this.acpEvents.delete(threadId); // prune to bound memory (Finding 8)
  }

  /**
   * The critical v0.2 UX piece: unblock a waiting agent after the human chooses
   * an option (or cancels). Called by the permission-response API endpoint.
   */
  async respondToPermission(
    threadOrSessionId: string,
    response: acp.RequestPermissionResponse,
  ): Promise<void> {
    let acpSessionId = threadOrSessionId;
    const byThread = this.threadToSession.get(threadOrSessionId);
    if (byThread) acpSessionId = byThread;

    const pending = this.pendingPermissionResolvers.get(acpSessionId);
    if (pending?.resolve) {
      pending.resolve(response);
      this.pendingPermissionResolvers.delete(acpSessionId);

      // Restore status
      const sess = this.sessions.get(acpSessionId);
      const tId = sess?.threadId;
      if (tId) {
        const t = this.acpThreads.get(tId);
        if (t) {
          t.status = "working" as ThreadStatus;
          t.updatedAt = new Date();
          this.acpThreads.set(tId, t);
        }
      }
      console.log(
        `[AcpProcessManager] Permission response delivered for ${acpSessionId}`,
      );
    } else {
      console.warn(
        "[AcpProcessManager] respondToPermission called with no pending resolver",
        acpSessionId,
      );
    }
  }

  getPendingPermission(threadId: string): PendingPermissionInfo | undefined {
    const acpSessionId = this.threadToSession.get(threadId);
    if (!acpSessionId) return undefined;
    const pending = this.pendingPermissionResolvers.get(acpSessionId);
    if (!pending) return undefined;
    return {
      threadId,
      acpSessionId,
      request: pending.request,
    };
  }

  // === ACP registry query surface (used by API routes for list / detail / stream) ===

  getAllAcpThreads(): Thread[] {
    return Array.from(this.acpThreads.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  getAcpThread(id: string): Thread | undefined {
    return this.acpThreads.get(id);
  }

  getAcpEvents(threadId: string, limit = 200): ThreadEvent[] {
    const evts = this.acpEvents.get(threadId) || [];
    return evts.slice(-limit);
  }

  getAcpEventEmitter(threadId: string): EventEmitter | undefined {
    const acpSessionId = this.threadToSession.get(threadId);
    if (!acpSessionId) return undefined;
    const sess = this.sessions.get(acpSessionId);
    if (!sess) return undefined;
    return this.processes.get(sess.processKey)?.emitter;
  }
}

export const acpProcessManager = new AcpProcessManager();
