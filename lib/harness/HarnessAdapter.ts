/**
 * HarnessAdapter — the swappability boundary for Mission Control.
 *
 * Every supported coding agent (Grok Build ACP, future Claude Code ACP, Codex, custom)
 * must implement this interface.
 *
 * Higher layers (API routes, PM orchestrator, dashboard state) only talk to this.
 */

import type { CreateAcpThreadOptions, AcpThreadHandle } from "./acp/types";

export interface ThreadHandle extends AcpThreadHandle {
  // Common surface we want from any harness
  threadId: string;
  status: string; // or richer
}

export interface HarnessAdapter {
  readonly name: string;

  createThread(options: CreateAcpThreadOptions): Promise<ThreadHandle>;

  sendPrompt(threadId: string, prompt: string): Promise<void>;

  cancel(threadId: string): Promise<void>;

  kill(threadId: string): Promise<void>;

  // PM / Factory helpers (optional in v1)
  requestSummary?(threadId: string): Promise<string>;
}
