/**
 * Agent Manager (v0.1 prototype)
 *
 * Owns the lifecycle of agent processes.
 * Current implementation: spawns `grok -p "..." --output-format streaming-json`
 * and streams NDJSON lines as events.
 *
 * This is deliberately the simplest possible thing that can give us
 * real, live Grok Build threads inside the dashboard.
 *
 * Later this moves into the dedicated Hono orchestrator server,
 * and we will add a proper ACP client + ThreadHandle abstraction.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type {
  Thread,
  ThreadEvent,
  CreateThreadInput,
  GrokStreamingJsonLine,
  ThreadStatus,
} from "./types";

type ThreadProcess = {
  thread: Thread;
  proc: ChildProcess;
  emitter: EventEmitter; // per-thread event bus for SSE / WS later
};

class AgentManager {
  private threads = new Map<string, Thread>();
  private processes = new Map<string, ThreadProcess>();
  private db: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any -- will be wired to better-sqlite3 in next pass

  // In-memory event history per thread (simple for v0.1)
  private events = new Map<string, ThreadEvent[]>();

  constructor() {
    console.log("[AgentManager] Initialized (in-memory prototype)");
  }

  /**
   * Create a new thread by spawning a real grok process.
   * Uses the headless streaming-json path for immediate feedback.
   */
  async createThread(input: CreateThreadInput): Promise<Thread> {
    const id = randomUUID();
    const now = new Date();

    const title =
      input.title ||
      input.goal.slice(0, 60) + (input.goal.length > 60 ? "..." : "");

    const thread: Thread = {
      id,
      missionId: randomUUID(), // single mission for v0.1
      title,
      goal: input.goal,
      cwd: input.cwd,
      harness: input.harness || "grok-build-headless",
      status: "spawning",
      model: input.model,
      createdAt: now,
      updatedAt: now,
    };

    this.threads.set(id, thread);
    this.events.set(id, []);

    // Emit an initial event
    this.pushEvent(id, {
      id: randomUUID(),
      threadId: id,
      type: "status",
      timestamp: now,
      payload: { status: "spawning", message: "Starting Grok Build process..." },
    });

    // === The actual spawn ===
    // We use -p for the prompt and streaming-json so we get line-delimited events.
    // --always-approve is dangerous in production but very useful while prototyping.
    // You can remove it once we have proper permission UI.
    const args = [
      "-p",
      input.goal,
      "--output-format",
      "streaming-json",
      "--cwd",
      input.cwd,
    ];

    // If user passed a specific model, forward it
    if (input.model) {
      args.push("--model", input.model);
    }

    console.log(`[AgentManager] Spawning: grok ${args.join(" ")}`);

    let proc: ChildProcess;
    try {
      proc = spawn("grok", args, {
        cwd: input.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Ensure grok can find its config even when launched from GUI
          PATH: process.env.PATH,
        },
      });
    } catch (err) {
      thread.status = "error";
      this.pushEvent(id, {
        id: randomUUID(),
        threadId: id,
        type: "stderr",
        timestamp: new Date(),
        payload: { error: String(err) },
      });
      this.threads.set(id, thread);
      return thread;
    }

    // Store the running process
    const emitter = new EventEmitter();
    this.processes.set(id, { thread, proc, emitter });

    // Update status
    thread.status = "working";
    thread.pid = proc.pid;
    this.threads.set(id, thread);

    this.pushEvent(id, {
      id: randomUUID(),
      threadId: id,
      type: "status",
      timestamp: new Date(),
      payload: { status: "working", pid: proc.pid },
    });

    // === Streaming handlers ===
    let buffer = "";

    const handleLine = (line: string) => {
      if (!line.trim()) return;

      let parsed: GrokStreamingJsonLine;
      try {
        const raw = JSON.parse(line);
        parsed = raw as GrokStreamingJsonLine;
      } catch {
        // Not JSON — treat as plain text
        this.pushEvent(id, {
          id: randomUUID(),
          threadId: id,
          type: "stdout",
          timestamp: new Date(),
          payload: { text: line },
          raw: line,
        });
        return;
      }

      // Classify the event from Grok's streaming-json format.
      // The exact shape is still evolving — we are defensive here.
      const eventType = this.classifyGrokEvent(parsed);

      this.pushEvent(id, {
        id: randomUUID(),
        threadId: id,
        type: eventType,
        timestamp: new Date(),
        payload: parsed,
        raw: line,
      });

      // Heuristic status updates
      if (parsed.event === "done" || parsed.type === "final") {
        thread.status = "done";
        this.threads.set(id, thread);
        this.pushEvent(id, {
          id: randomUUID(),
          threadId: id,
          type: "status",
          timestamp: new Date(),
          payload: { status: "done" },
        });
      }
    };

    // stdout (primary channel for streaming-json)
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        handleLine(line);
      }
    });

    // stderr (important for errors, auth prompts, etc.)
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;

      this.pushEvent(id, {
        id: randomUUID(),
        threadId: id,
        type: "stderr",
        timestamp: new Date(),
        payload: { text },
        raw: text,
      });
    });

    proc.on("close", (code) => {
      console.log(`[AgentManager] Process ${proc.pid} exited with code ${code}`);

      const current = this.threads.get(id);
      if (current && current.status !== "done" && current.status !== "killed") {
        current.status = code === 0 ? "done" : "error";
        current.updatedAt = new Date();
        this.threads.set(id, current);

        this.pushEvent(id, {
          id: randomUUID(),
          threadId: id,
          type: "status",
          timestamp: new Date(),
          payload: { status: current.status, exitCode: code },
        });
      }

      this.processes.delete(id);
    });

    proc.on("error", (err) => {
      console.error("[AgentManager] Process error", err);
      const current = this.threads.get(id);
      if (current) {
        current.status = "error";
        this.threads.set(id, current);
      }
      this.pushEvent(id, {
        id: randomUUID(),
        threadId: id,
        type: "stderr",
        timestamp: new Date(),
        payload: { error: err.message },
      });
    });

    return thread;
  }

  /**
   * Send a follow-up / steering message to a running thread.
   * In the simple headless path this is a bit of a hack (we can't truly
   * interrupt a one-shot `-p` run easily). For v0.1 we just log it.
   *
   * Real power comes when we move to ACP (`session/prompt` on an existing session).
   */
  async sendMessage(threadId: string, message: string): Promise<void> {
    const procInfo = this.processes.get(threadId);
    const thread = this.threads.get(threadId);

    if (!thread) throw new Error("Thread not found");

    // Record the user's steering message
    this.pushEvent(threadId, {
      id: randomUUID(),
      threadId,
      type: "message",
      timestamp: new Date(),
      payload: { role: "user", text: message },
    });

    if (!procInfo) {
      // Thread is not currently running — in a real system we would resume it.
      console.warn("[AgentManager] sendMessage on non-running thread", threadId);
      return;
    }

    // For the current simple headless path we cannot easily inject.
    // We mark it visibly so the user understands the limitation.
    this.pushEvent(threadId, {
      id: randomUUID(),
      threadId,
      type: "stderr",
      timestamp: new Date(),
      payload: {
        text: "[Mission Control] Steering messages are limited in headless mode. Full interactive control requires ACP (coming soon).",
      },
    });
  }

  /**
   * Kill a running thread.
   */
  async killThread(threadId: string): Promise<void> {
    const procInfo = this.processes.get(threadId);
    const thread = this.threads.get(threadId);

    if (!thread) return;

    if (procInfo?.proc) {
      procInfo.proc.kill("SIGTERM");
      // Give it a moment, then SIGKILL if needed
      setTimeout(() => {
        if (procInfo.proc && !procInfo.proc.killed) {
          procInfo.proc.kill("SIGKILL");
        }
      }, 2000);
    }

    thread.status = "killed";
    thread.updatedAt = new Date();
    this.threads.set(threadId, thread);

    this.pushEvent(threadId, {
      id: randomUUID(),
      threadId,
      type: "status",
      timestamp: new Date(),
      payload: { status: "killed" },
    });

    this.processes.delete(threadId);
  }

  // === Query helpers ===

  getAllThreads(): Thread[] {
    return Array.from(this.threads.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  getThread(id: string): Thread | undefined {
    return this.threads.get(id);
  }

  getEvents(threadId: string, limit = 200): ThreadEvent[] {
    const evts = this.events.get(threadId) || [];
    return evts.slice(-limit);
  }

  /**
   * Returns an EventEmitter that fires 'event' whenever a new ThreadEvent
   * is recorded for this thread. Useful for SSE / WebSocket in the future.
   */
  getEventEmitter(threadId: string): EventEmitter | undefined {
    return this.processes.get(threadId)?.emitter;
  }

  // === Internal ===

  private pushEvent(threadId: string, event: ThreadEvent) {
    const list = this.events.get(threadId) || [];
    list.push(event);
    this.events.set(threadId, list);

    // Also notify any live subscribers (for future SSE)
    const procInfo = this.processes.get(threadId);
    procInfo?.emitter.emit("event", event);

    // Update the thread's last activity timestamp
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.updatedAt = new Date();
      this.threads.set(threadId, thread);
    }
  }

  /**
   * Very defensive classification of Grok's streaming-json output.
   * The format is still stabilizing — we treat unknown shapes gracefully.
   */
  private classifyGrokEvent(line: GrokStreamingJsonLine): ThreadEvent["type"] {
    if (line.type === "reasoning" || line.event === "reasoning") return "reasoning";
    if (line.type === "tool_call" || line.event?.includes("tool")) return "tool_call";
    if (line.type === "file_edit" || line.event?.includes("edit")) return "file_edit";
    if (line.type === "permission" || line.event?.includes("permission")) return "permission_request";
    if (line.type === "message" || line.role) return "message";
    if (line.type === "summary") return "summary";

    // Default to stdout for normal assistant text
    return "stdout";
  }
}

// Singleton for the prototype phase.
// In the real architecture this will live in the dedicated server process.
export const agentManager = new AgentManager();
