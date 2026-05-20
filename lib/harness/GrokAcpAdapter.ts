/**
 * GrokAcpAdapter
 *
 * Concrete implementation of HarnessAdapter backed by the real ACP manager
 * talking to `grok agent stdio`.
 *
 * Delegates to AcpSessionManager (which in turn uses AcpProcessManager).
 * This keeps the swappability boundary clean.
 */

import { acpSessionManager } from "./acp/AcpSessionManager";
import type { HarnessAdapter, ThreadHandle } from "./HarnessAdapter";
import type { CreateAcpThreadOptions } from "./acp/types";

export class GrokAcpAdapter implements HarnessAdapter {
  readonly name = "grok-build-acp";

  async createThread(options: CreateAcpThreadOptions): Promise<ThreadHandle> {
    const handle = await acpSessionManager.createThread(options);

    // Wrap the raw ACP handle into the common ThreadHandle shape
    // (the returned handle has sendPrompt/cancel; killProcess removed per Finding 9; we add status)
    return {
      ...handle,
      status: "working",
    } as ThreadHandle;
  }

  async sendPrompt(threadId: string, prompt: string): Promise<void> {
    await acpSessionManager.sendPrompt(threadId, prompt);
  }

  async cancel(threadId: string): Promise<void> {
    await acpSessionManager.cancel(threadId);
  }

  async kill(threadId: string): Promise<void> {
    await acpSessionManager.kill(threadId);
  }
}

export const grokAcpAdapter = new GrokAcpAdapter();
