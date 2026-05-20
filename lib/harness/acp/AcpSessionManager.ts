/**
 * AcpSessionManager
 *
 * High-level coordinator for ACP threads and sessions (the "session" side of the harness).
 * It owns:
 *  - Thread <-> ACP sessionId mappings and lifecycle
 *  - Permission request queuing + response round-trips
 *  - Event normalization surface for the UI layer
 *
 * Delegates raw process/connection management to AcpProcessManager.
 *
 * This + ProcessManager + HarnessAdapter give us the swappable boundary
 * described in the v0.2 ACP-first plan.
 */

import { acpProcessManager } from "./AcpProcessManager";
import type {
  CreateAcpThreadOptions,
  AcpThreadHandle,
  PendingPermissionInfo,
} from "./types";
import type * as acp from "@agentclientprotocol/sdk";
import type { Thread, ThreadEvent } from "../../types";

export class AcpSessionManager {
  private readonly pm = acpProcessManager;

  async createThread(
    options: CreateAcpThreadOptions,
  ): Promise<AcpThreadHandle> {
    return this.pm.createThread(options);
  }

  async sendPrompt(
    threadId: string,
    prompt: string | acp.ContentBlock[],
  ): Promise<acp.PromptResponse> {
    return this.pm.sendPrompt(threadId, prompt);
  }

  async cancel(threadId: string): Promise<void> {
    return this.pm.cancel(threadId);
  }

  async kill(threadId: string): Promise<void> {
    return this.pm.kill(threadId);
  }

  async respondToPermission(
    threadOrSessionId: string,
    response: acp.RequestPermissionResponse,
  ): Promise<void> {
    return this.pm.respondToPermission(threadOrSessionId, response);
  }

  getPendingPermission(threadId: string): PendingPermissionInfo | undefined {
    return this.pm.getPendingPermission(threadId);
  }

  // Registry queries (ACP threads only)
  getAllThreads(): Thread[] {
    return this.pm.getAllAcpThreads();
  }

  getThread(id: string): Thread | undefined {
    return this.pm.getAcpThread(id);
  }

  getEvents(threadId: string, limit?: number): ThreadEvent[] {
    return this.pm.getAcpEvents(threadId, limit);
  }

  getEventEmitter(threadId: string) {
    return this.pm.getAcpEventEmitter(threadId);
  }

  // Low-level escape hatch if needed
  getProcessManager() {
    return this.pm;
  }
}

export const acpSessionManager = new AcpSessionManager();
