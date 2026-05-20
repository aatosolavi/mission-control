import { z } from "zod";

/**
 * Core domain types for Mission Control.
 *
 * ACP-first architecture (as of v0.2):
 * - Primary harness = "grok-build-acp" using @agentclientprotocol/sdk + `grok agent stdio`
 * - The rich harness layer lives under lib/harness/
 * - These Zod schemas are the stable contract between backend and UI.
 */

// Thread status — intentionally coarse in v0.1
export const ThreadStatusSchema = z.enum([
  "spawning",
  "idle",
  "working",
  "awaiting_permission",
  "blocked",
  "done",
  "error",
  "killed",
]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

// Which harness / integration is driving this thread
export const HarnessTypeSchema = z.enum([
  "grok-build-acp", // Primary (full ACP via `grok agent stdio` + official SDK)
  "grok-build-headless", // Legacy / fallback (simple -p streaming-json)
  "claude-code",
  "codex",
  "custom",
]);
export type HarnessType = z.infer<typeof HarnessTypeSchema>;

// A single agent execution thread (one process / one session)
export const ThreadSchema = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  title: z.string().min(1),
  goal: z.string().min(1),
  cwd: z.string().min(1),
  harness: HarnessTypeSchema,
  status: ThreadStatusSchema,
  pid: z.number().optional(),
  model: z.string().optional(),
  lastSummary: z.string().optional(),
  summaryUpdatedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Thread = z.infer<typeof ThreadSchema>;

// Raw or structured events coming out of the agent process
export const ThreadEventTypeSchema = z.enum([
  "stdout",
  "stderr",
  "status",
  "tool_call",
  "file_edit",
  "permission_request",
  "reasoning",
  "message",           // user or agent high-level message
  "summary",
]);

export const ThreadEventSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  type: ThreadEventTypeSchema,
  timestamp: z.date(),
  // For v0.1 we keep payload flexible. Later we will strongly type per harness.
  payload: z.unknown(),
  // Original raw line for debugging / fallback rendering
  raw: z.string().optional(),
});
export type ThreadEvent = z.infer<typeof ThreadEventSchema>;

// High-level actions the human PM (or future LLM PM) takes
export const OrchestrationActionSchema = z.object({
  id: z.string().uuid(),
  missionId: z.string().uuid(),
  actor: z.enum(["user", "system", "pm-agent"]),
  action: z.string(), // e.g. "create_thread", "send_guidance", "request_summary", "kill_thread"
  targetThreadIds: z.array(z.string().uuid()).optional(),
  payload: z.unknown().optional(),
  timestamp: z.date(),
});
export type OrchestrationAction = z.infer<typeof OrchestrationActionSchema>;

// Minimal shape for creating a new thread from the UI
export const CreateThreadInputSchema = z.object({
  goal: z.string().min(3, "Goal must be at least 3 characters"),
  cwd: z.string().min(1, "Working directory is required"),
  title: z.string().optional(),
  harness: HarnessTypeSchema.optional().default("grok-build-acp"),
  model: z.string().optional(),
  role: z.enum(["orchestrator", "worker", "validator", "research"]).optional(),
  isolationLevel: z.enum(["shared-process", "dedicated-process"]).optional(),
});
export type CreateThreadInput = z.infer<typeof CreateThreadInputSchema>;

// Streaming JSON line format we expect from `grok --output-format streaming-json`
export const GrokStreamingJsonLineSchema = z.object({
  type: z.string().optional(),
  content: z.string().optional(),
  delta: z.string().optional(),
  event: z.string().optional(),
  // Grok Build may emit other useful fields (tool, file, status, etc.)
}).passthrough();
export type GrokStreamingJsonLine = z.infer<typeof GrokStreamingJsonLineSchema>;

/**
 * Legacy note:
 * The real swappable HarnessAdapter + ThreadHandle now live in:
 *   lib/harness/HarnessAdapter.ts
 *   lib/harness/acp/types.ts (AcpThreadHandle, etc.)
 *
 * These old interfaces are kept temporarily for any code still referencing them.
 */
export interface ThreadHandle {
  threadId: string;
  pid?: number;
  kill(): Promise<void>;
  sendMessage(message: string): Promise<void>;
}

export interface HarnessAdapter {
  readonly type: HarnessType;
  createThread(input: CreateThreadInput): Promise<ThreadHandle>;
  requestSummary?(threadId: string): Promise<string>;
  pause?(threadId: string): Promise<void>;
}
