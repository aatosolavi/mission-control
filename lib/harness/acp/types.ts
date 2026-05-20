/**
 * ACP Harness Types
 *
 * Re-exports from the official @agentclientprotocol/sdk plus our own normalized
 * shapes that the rest of Mission Control (UI, API, PM layer) will consume.
 *
 * This file is the single place where we decide "how we talk about ACP events
 * inside our app".
 */

import * as acp from "@agentclientprotocol/sdk";

// Re-export the most important pieces so the rest of the codebase has a stable import path
export type {
  // Core connection classes
  ClientSideConnection,
  // Schema / protocol types we use heavily
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  PromptRequest,
  NewSessionRequest,
  NewSessionResponse,
  InitializeRequest,
  InitializeResponse,
  AuthenticateRequest,
  AuthenticateResponse,
  PromptResponse,
  PermissionOption,
} from "@agentclientprotocol/sdk";

export { ndJsonStream } from "@agentclientprotocol/sdk";

// The raw Client interface we must implement
export type { Client as AcpClientInterface } from "@agentclientprotocol/sdk";

// ============================================================================
// Our normalized / Mission-Control-friendly event shapes
// ============================================================================

/**
 * Normalized event that we push into ThreadEvent streams for the UI and PM layer.
 * We translate raw `session/update` + tool calls + permission requests into these.
 */
export type AcpNormalizedEvent =
  | { kind: "message_chunk"; role: "agent" | "thought" | "user"; text: string }
  | {
      kind: "tool_call";
      id: string;
      title: string;
      status: string;
      content?: unknown;
    }
  | { kind: "tool_call_update"; id: string; status: string; content?: unknown }
  | { kind: "plan"; plan: unknown }
  | { kind: "permission_request"; request: acp.RequestPermissionRequest }
  | { kind: "status"; text: string }
  | { kind: "error"; message: string }
  | { kind: "raw"; data: unknown }; // fallback for anything we don't yet map nicely

/**
 * Options when creating a new ACP-backed thread / session.
 */
export interface CreateAcpThreadOptions {
  goal: string;
  cwd: string;
  title?: string;
  model?: string;
  role?: "orchestrator" | "worker" | "validator" | "research";
  isolationLevel?: "shared-process" | "dedicated-process";
  mcpServers?: unknown[]; // passed through to session/new
  worktreePath?: string; // if we pre-created a git worktree
}

/**
 * Handle returned after successfully creating an ACP session.
 * This is what higher layers (GrokAcpAdapter, API routes) hold.
 */
export interface AcpThreadHandle {
  threadId: string;
  acpSessionId: string;
  processPid: number;
  // High-level control surface (per-session only; killProcess removed to prevent
  // collateral termination of shared-process siblings — P2 Finding 9).
  sendPrompt(prompt: string | acp.ContentBlock[]): Promise<acp.PromptResponse>;
  cancel(): Promise<void>;
  // kill() on the adapter/PM is the safe path (branches on dedicated vs shared).
}

/**
 * Shape exposed to the API/UI for a pending permission request so the
 * human PM can make an informed decision (shows tool title, options, etc).
 */
export interface PendingPermissionInfo {
  threadId: string;
  acpSessionId: string;
  request: acp.RequestPermissionRequest;
}
