"use client";

import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Square,
  MessageSquare,
  Plus,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Clock,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import type { Thread, ThreadEvent, ThreadStatus } from "@/lib/types";

// Very early but functional Mission Control UI
// Goal: make the core loop (create → live watch → steer) feel good immediately.

export default function MissionControl() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<ThreadEvent[]>([]);
  const [pendingPermission, setPendingPermission] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any -- pending ACP RequestPermissionRequest + metadata; SDK shapes evolving (matches harness)
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [goal, setGoal] = useState("");
  const [cwd, setCwd] = useState(
    process.cwd?.() || "/Users/aatosmononen/Documents",
  );
  const [title, setTitle] = useState("");

  const selectedThread = threads.find((t) => t.id === selectedId);
  const eventContainerRef = useRef<HTMLDivElement>(null);

  // Poll the thread list every 2s (good enough for v0.1)
  async function refreshThreads() {
    try {
      const res = await fetch("/api/threads");
      const data = await res.json();
      setThreads(data.threads || []);
    } catch (e) {
      console.error("Failed to fetch threads", e);
    }
  }

  // Load detailed events when a thread is selected
  async function loadThreadDetail(id: string) {
    try {
      const res = await fetch(`/api/threads/${id}`);
      const data = await res.json();
      if (data.events) setEvents(data.events);
      setPendingPermission(data.pendingPermission || null);
    } catch (e) {
      console.error("Failed to load thread detail", e);
    }
  }

  // SSE subscription for the selected thread (real-time updates)
  useEffect(() => {
    if (!selectedId) return;

    const es = new EventSource(`/api/threads/${selectedId}/stream`);

    es.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data);

        if (payload.type === "event" && payload.event) {
          const ev = payload.event;
          setEvents((prev) => {
            // Deduplicate by id for SSE snapshot + live window races (prevents re-introduced dups
            // after history replace when a late window event arrives post-history).
            if (ev && ev.id && prev.some((e: any) => e && e.id === ev.id)) { // eslint-disable-line @typescript-eslint/no-explicit-any -- event from SSE payload (ThreadEvent union)
              return prev;
            }
            return [...prev.slice(-180), ev];
          });
          if (payload.event.type === "permission_request") {
            // Live permission_request arrived — fetch detail to sync pendingPermission for the approval UI
            loadThreadDetail(selectedId).catch(() => {});
          }
        }
        if (payload.type === "history" && payload.events) {
          setEvents(payload.events);
        }
      } catch {
        // ignore malformed
      }
    };

    es.onerror = () => {
      // Silently let it reconnect; browsers do this automatically for SSE
    };

    // Also refresh the list so status pills update
    const interval = setInterval(refreshThreads, 1500);

    return () => {
      es.close();
      clearInterval(interval);
    };
  }, [selectedId]);

  // Auto-scroll the event log
  useEffect(() => {
    if (eventContainerRef.current) {
      eventContainerRef.current.scrollTop =
        eventContainerRef.current.scrollHeight;
    }
  }, [events]);

  // Initial load + periodic refresh of the list
  useEffect(() => {
    (async () => {
      await refreshThreads();
      setIsLoading(false);
    })();

    const interval = setInterval(refreshThreads, 3000);
    return () => clearInterval(interval);
  }, []);

  // When selection changes, load detail
  useEffect(() => {
    if (selectedId) {
      loadThreadDetail(selectedId); // eslint-disable-line react-hooks/set-state-in-effect -- external data load on selection; sets occur inside the async fetch promise (allowed per React guidance)
    } else {
      setEvents([]);
    }
  }, [selectedId]);

  async function createThread() {
    if (!goal.trim() || !cwd.trim()) {
      toast.error("Goal and working directory are required");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal.trim(),
          cwd: cwd.trim(),
          title: title.trim() || undefined,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      const { thread } = await res.json();

      toast.success(`Thread created: ${thread.title}`);

      // Reset form
      setGoal("");
      setTitle("");
      setShowCreate(false);

      // Select the new thread and refresh list
      await refreshThreads();
      setSelectedId(thread.id);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any -- fetch error shape
      toast.error(`Failed to create thread: ${err.message || err}`);
    } finally {
      setIsCreating(false);
    }
  }

  async function sendSteeringMessage(message: string) {
    if (!selectedId || !message.trim()) return;

    try {
      const res = await fetch(`/api/threads/${selectedId}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: message }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Uses the ACP /prompt (or legacy fallback) — real session/prompt for interactive control.
      toast.success("Steering sent");
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any -- fetch error shape
      toast.error(`Failed to send steering: ${e?.message || e}`);
    }
  }

  async function killThread(id: string) {
    try {
      const res = await fetch(`/api/threads/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Thread killed");
      if (selectedId === id) setSelectedId(null);
      await refreshThreads();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any -- fetch error shape
      toast.error(`Failed to kill thread: ${e?.message || e}`);
    }
  }

  // Minimal functional permission approval surface (P1 Finding 2). Uses the pending
  // loaded from detail + the validated /permission-response route. Supports cancel
  // or approve (first option or explicit). Triggered via status + permission_request events.
  async function respondToPermission(
    outcome: "cancelled" | "approved",
    optionId?: string,
  ) {
    if (!selectedId) return;
    try {
      const body: any = optionId // eslint-disable-line @typescript-eslint/no-explicit-any -- request body to /permission-response (flexible for selected vs approved)
        ? { selectedOptionId: optionId }
        : outcome === "cancelled"
          ? { outcome: "cancelled" }
          : { approved: true };
      const res = await fetch(
        `/api/threads/${selectedId}/permission-response`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      toast.success(
        outcome === "cancelled" ? "Permission denied" : "Permission approved",
      );
      setPendingPermission(null);
      await loadThreadDetail(selectedId);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any -- fetch error shape
      toast.error(`Permission response failed: ${e?.message || e}`);
    }
  }

  function getStatusIcon(status: ThreadStatus) {
    switch (status) {
      case "working":
        return <Play className="w-3.5 h-3.5 text-primary" />;
      case "done":
        return <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />;
      case "error":
      case "killed":
        return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
      case "awaiting_permission":
      case "blocked":
        return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  }

  function renderEvent(event: ThreadEvent, index: number) {
    const p = event.payload as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- ThreadEvent payload union (legacy + ACP normalized)

    // Special rendering for permission_request so the log is not a raw blob (addresses
    // the stringify complaint in Finding 2 while the primary control is the approval card).
    if (event.type === "permission_request") {
      const req = p as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- ACP permission request shape (evolving)
      const opts = (req?.options || [])
        .map((o: any) => o.name || o.optionId) // eslint-disable-line @typescript-eslint/no-explicit-any -- option shape from ACP request
        .join(" | ");
      const text = `permission: ${req?.title || req?.toolCallId || "tool call"} — options: ${opts || "(see card)"}`;
      return (
        <div
          key={event.id || index}
          className="text-xs font-mono leading-snug px-3 py-1.5 border-l-2 border-amber-500/60 text-amber-300 bg-amber-950/10"
        >
          <span className="text-[10px] text-muted-foreground mr-2 tabular-nums">
            {new Date(event.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <span className="text-[10px] uppercase tracking-[1px] mr-2 text-amber-500/70">
            permission_request
          </span>
          <span className="whitespace-pre-wrap break-words">{text}</span>
        </div>
      );
    }

    const text =
      p?.text ||
      p?.content ||
      p?.delta ||
      (typeof p === "string" ? p : JSON.stringify(p).slice(0, 200));

    const isError = event.type === "stderr";
    const isReasoning = event.type === "reasoning";
    const isStatus = event.type === "status";

    return (
      <div
        key={event.id || index}
        className={`text-xs font-mono leading-snug px-3 py-1.5 border-l-2 ${
          isError
            ? "border-red-500/60 text-red-400 bg-red-950/20"
            : isReasoning
              ? "border-amber-500/60 text-amber-300/80 bg-amber-950/10"
              : isStatus
                ? "border-sky-500/60 text-sky-300/80 bg-sky-950/10"
                : "border-border text-muted-foreground bg-background/40"
        }`}
      >
        <span className="text-[10px] text-muted-foreground mr-2 tabular-nums">
          {new Date(event.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
        <span className="text-[10px] uppercase tracking-[1px] mr-2 text-muted-foreground">
          {event.type}
        </span>
        <span className="whitespace-pre-wrap break-words">{text}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground font-sans overflow-hidden">
      {/* Top bar — dense mission control chrome */}
      <div className="h-12 border-b border-border bg-background/95 backdrop-blur flex items-center px-4 justify-between text-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-primary" />
            <div className="font-semibold tracking-[-0.3px]">
              Mission Control
            </div>
            <div className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              v0.1
            </div>
          </div>
          <div className="text-muted-foreground/80">|</div>
          <div className="text-muted-foreground text-xs">One PM. Many threads.</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Thread
          </button>
          <div className="text-[10px] text-muted-foreground px-2">
            {threads.length} thread{threads.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Thread list (left sidebar) */}
        <div className="w-80 border-r border-border flex flex-col bg-background">
          <div className="px-3 py-2 text-[10px] uppercase tracking-[1px] text-muted-foreground border-b border-border flex items-center justify-between">
            <span>Active Threads</span>
            <button onClick={refreshThreads} className="hover:text-foreground/70">
              ↻
            </button>
          </div>

          <div className="flex-1 overflow-auto p-2 space-y-1">
            {isLoading && (
              <div className="p-3 text-xs text-muted-foreground">Loading…</div>
            )}

            {threads.length === 0 && !isLoading && (
              <div className="p-4 text-xs text-muted-foreground">
                No threads yet. Create one to start an agent.
              </div>
            )}

            {threads.map((t) => {
              const isSelected = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all flex flex-col gap-1 ${
                    isSelected
                      ? "bg-muted border-border"
                      : "bg-card border-border/60 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between text-sm">
                    <div className="font-medium truncate pr-2">{t.title}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {getStatusIcon(t.status)}
                      <span className="tabular-nums">{t.status}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 truncate">
                    <FolderOpen className="w-3 h-3" />
                    <span className="truncate">{t.cwd}</span>
                  </div>
                  {t.lastSummary && (
                    <div className="text-[10px] text-primary/80 line-clamp-2">
                      {t.lastSummary}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="p-3 border-t border-border text-[10px] text-muted-foreground">
            Prototype • Real grok processes • Streaming JSON
          </div>
        </div>

        {/* Main area: Detail / Live log */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedId && (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <div className="text-2xl font-semibold tracking-tight mb-2">
                  Select or create a thread
                </div>
                <p className="text-muted-foreground max-w-sm">
                  The left sidebar shows all running agent threads. Click one to
                  watch live output and steer it.
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-6 inline-flex items-center gap-2 px-5 py-2 rounded-full bg-muted hover:bg-muted border border-border"
                >
                  <Plus className="w-4 h-4" /> Create your first thread
                </button>
              </div>
            </div>
          )}

          {selectedId && selectedThread && (
            <>
              {/* Thread header */}
              <div className="h-14 border-b border-border px-4 flex items-center justify-between bg-background/80">
                <div>
                  <div className="font-medium">{selectedThread.title}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{selectedThread.cwd}</span>
                    <span>·</span>
                    <span className="font-mono text-primary/70">
                      {selectedThread.harness}
                    </span>
                    {selectedThread.pid && (
                      <span>pid {selectedThread.pid}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {selectedThread.status}
                  </div>
                  <button
                    onClick={() => killThread(selectedId)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-red-900/60 hover:bg-red-950/40 text-red-400 text-xs"
                  >
                    <Square className="w-3.5 h-3.5" /> Kill
                  </button>
                </div>
              </div>

              {/* Permission approval surface (P1 Finding 2) — renders the real ACP options[]
                  from the pending request so the PM can choose the exact optionId the agent
                  presented (e.g. allow_once vs reject_once). Falls back to generic approve
                  only if no options array. Calls the validated /permission-response. */}
              {pendingPermission && (
                <div className="px-4 py-3 border-b border-amber-500/30 bg-amber-950/20 text-sm">
                  <div className="flex items-center gap-2 text-amber-400 font-medium mb-1">
                    <AlertCircle className="w-4 h-4" /> Permission requested by agent
                  </div>
                  <div className="text-[11px] text-amber-300/80 mb-2">
                    {/* eslint-disable @typescript-eslint/no-explicit-any -- ACP pending request shape (evolving SDK, isolated to permission card) */}
                    {((pendingPermission as any)?.request?.title as string) ||
                      ((pendingPermission as any)?.request?.toolCallId as string) ||
                      "Tool / action permission"}
                    {((pendingPermission as any)?.request?.options?.length && ` — choose one of ${((pendingPermission as any).request.options.length as number)} options`)}
                    {/* eslint-enable @typescript-eslint/no-explicit-any */}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* eslint-disable @typescript-eslint/no-explicit-any -- ACP options + option items (evolving) */}
                    {(((pendingPermission as any)?.request?.options as any[]) || []).map((opt: any, idx: number) => {
                      const oid = (opt?.optionId || opt?.id || opt?.name || `opt-${idx}`) as string;
                      const label = (opt?.name || opt?.title || oid) as string;
                      return (
                        <button
                          key={oid}
                          onClick={() => respondToPermission("approved", oid)}
                          className="px-3 py-1 rounded bg-primary hover:bg-primary/90 text-xs text-primary-foreground"
                        >
                          {label}
                        </button>
                      );
                    })}
                    {(((pendingPermission as any)?.request?.options as any[]) || []).length === 0 && (
                      <button
                        onClick={() => respondToPermission("approved")}
                        className="px-3 py-1 rounded bg-primary hover:bg-primary/90 text-xs text-primary-foreground"
                      >
                        Approve (default)
                      </button>
                    )}
                    {/* eslint-enable @typescript-eslint/no-explicit-any */}
                    <button
                      onClick={() => respondToPermission("cancelled")}
                      className="px-3 py-1 rounded border border-border hover:bg-muted text-xs"
                    >
                      Deny / Cancel
                    </button>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Selecting an option sends the exact optionId to the agent.
                  </div>
                </div>
              )}

              {/* Live event log */}
              <div
                ref={eventContainerRef}
                className="flex-1 overflow-auto bg-muted/40 font-mono text-[12px] leading-tight py-2 border-b border-border"
              >
                {events.length === 0 && (
                  <div className="px-4 py-8 text-muted-foreground/80 text-xs">
                    Waiting for output from the agent…
                  </div>
                )}
                {events.map((e, i) => renderEvent(e, i))}
              </div>

              {/* Steering input (the "PM" control surface) */}
              <div className="p-3 border-t border-border bg-background">
                <div className="text-[10px] uppercase tracking-[1px] text-muted-foreground mb-1.5 px-1">
                  Send guidance to this thread
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const input = form.elements.namedItem(
                      "msg",
                    ) as HTMLInputElement;
                    if (input.value.trim()) {
                      sendSteeringMessage(input.value.trim());
                      input.value = "";
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    name="msg"
                    type="text"
                    placeholder="Tell the agent what to focus on or unblock…"
                    className="flex-1 bg-card border border-border rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  />
                  <button
                    type="submit"
                    className="px-4 rounded-md bg-muted hover:bg-accent active:bg-accent border border-border flex items-center gap-2 text-sm"
                  >
                    <MessageSquare className="w-4 h-4" /> Send
                  </button>
                </form>
                <div className="text-[10px] text-muted-foreground/80 mt-1.5 px-1">
                  Steering + permission approvals use the live ACP
                  session/prompt path.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create Thread Modal */}
      <AnimatePresence>
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              className="w-full max-w-lg rounded-2xl border border-border bg-background p-6"
            >
              <div className="text-lg font-semibold mb-1">
                Create new agent thread
              </div>
              <div className="text-sm text-muted-foreground mb-5">
                This will spawn a real <span className="font-mono">grok</span>{" "}
                process using headless mode.
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">
                    Goal / Prompt
                  </label>
                  <textarea
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Implement rate limiting with Redis and add comprehensive tests"
                    className="w-full h-24 resize-y bg-card border border-border rounded-lg p-3 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">
                    Working Directory
                  </label>
                  <input
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">
                    Title (optional)
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Auto-generated from goal"
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={createThread}
                  disabled={isCreating || !goal.trim() || !cwd.trim()}
                  className="px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {isCreating ? "Spawning…" : "Launch Thread"}
                </button>
              </div>

              <div className="mt-4 text-[10px] text-muted-foreground/80">
                The agent will run with the same permissions as your current
                user. Use with care.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
