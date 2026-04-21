/**
 * Sync orchestrator — drives Gmail + Calendar backfill once. The
 * incremental poll loop is no longer in-process: it's driven by the
 * `dench-ai-gateway` plugin running inside the OpenClaw gateway daemon,
 * which POSTs to `/api/sync/poll-tick` every ~5 minutes and we run
 * `tickPoller()` here. The plugin survives Next.js restarts, so the
 * cron stays alive across `denchclaw update`.
 *
 * The whole module is process-singleton: exactly one backfill or poll
 * runs at a time per Next.js process, no matter how many SSE clients
 * connect (or how many gateway-driven ticks land while one is in flight).
 *
 * Public surface:
 *
 *   startBackfill()   → kicks off the initial backfill (idempotent — calling
 *                       again while one is already in progress is a no-op
 *                       and just returns the in-flight handle).
 *   subscribeProgress(listener) → SSE-friendly progress event subscription.
 *   tickPoller()                → run a single incremental poll cycle. Called
 *                                 from the gateway-driven HTTP endpoint;
 *                                 mutex-gated so overlap with backfill or
 *                                 another tick is a no-op.
 *   armIncrementalPoller()      → DEPRECATED. No-op shim retained so external
 *                                 callers don't break; gateway plugin owns timing now.
 *   stopIncrementalPoller()      → tears down the (now-unused) in-process
 *                                  interval if a test or older code path armed it.
 */

import { Mutex } from "async-mutex";
import {
  readConnections,
  readSyncCursors,
  writeSyncCursors,
} from "./denchclaw-state";
import { runGmailBackfill, runGmailIncremental, type GmailSyncProgress } from "./gmail-sync";
import {
  runCalendarBackfill,
  runCalendarIncremental,
  type CalendarSyncProgress,
} from "./calendar-sync";
import { recomputeAllScores } from "./strength-score";
import { ComposioToolNoConnectionError } from "./composio-execute";
import { ensureLatestSchema } from "./workspace-schema-migrations";
import { ensureOnboardingObjectDirs, installDefaultViews } from "./onboarding-views";
import { mergeDuplicatePeople } from "./people-merge";

// ---------------------------------------------------------------------------
// Public progress event
// ---------------------------------------------------------------------------

export type SyncProgressEvent = {
  phase:
    | "starting"
    | "gmail"
    | "calendar"
    | "scoring"
    | "merging"
    | "complete"
    | "error"
    | "polling";
  message: string;
  messagesProcessed: number;
  peopleProcessed: number;
  companiesProcessed: number;
  threadsProcessed: number;
  eventsProcessed: number;
  error?: string;
};

type ProgressListener = (event: SyncProgressEvent) => void;

// ---------------------------------------------------------------------------
// Module-singleton state
// ---------------------------------------------------------------------------

const mutex = new Mutex();
const listeners = new Set<ProgressListener>();
let lastEvent: SyncProgressEvent | null = null;
let backfillRunning = false;
let backfillPromise: Promise<void> | null = null;
// pollerHandle is no longer set in steady state — the gateway plugin owns
// timing now. Kept as a defensive null so `stopIncrementalPoller()` can
// still clean up if a test or older code path armed an in-process timer.
let pollerHandle: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Progress emission
// ---------------------------------------------------------------------------

function emit(event: SyncProgressEvent): void {
  lastEvent = event;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Listener errors should never break the runner.
    }
  }
}

export function subscribeProgress(listener: ProgressListener): () => void {
  listeners.add(listener);
  if (lastEvent) {
    try {
      listener(lastEvent);
    } catch {
      // ignore
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getLastProgressEvent(): SyncProgressEvent | null {
  return lastEvent;
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

export type StartBackfillOptions = {
  signal?: AbortSignal;
};

export type StartBackfillResult = {
  started: boolean;
  alreadyRunning: boolean;
  reason?: string;
};

/**
 * Kick off the full backfill. Returns immediately; subscribe to progress
 * via `subscribeProgress`. If a backfill is already in flight, returns
 * `{ started: false, alreadyRunning: true }`.
 */
export function startBackfill(options: StartBackfillOptions = {}): StartBackfillResult {
  if (backfillRunning) {
    return { started: false, alreadyRunning: true };
  }
  const connections = readConnections();
  if (!connections.gmail) {
    return {
      started: false,
      alreadyRunning: false,
      reason: "No Gmail connection. Connect Gmail before starting the sync.",
    };
  }
  backfillRunning = true;
  backfillPromise = runBackfillInner(options).finally(() => {
    backfillRunning = false;
    backfillPromise = null;
  });
  return { started: true, alreadyRunning: false };
}

export function isBackfillRunning(): boolean {
  return backfillRunning;
}

export function awaitBackfillCompletion(): Promise<void> {
  return backfillPromise ?? Promise.resolve();
}

async function runBackfillInner(options: StartBackfillOptions): Promise<void> {
  const release = await mutex.acquire();
  try {
    emit({
      phase: "starting",
      message: "Preparing workspace…",
      messagesProcessed: 0,
      peopleProcessed: 0,
      companiesProcessed: 0,
      threadsProcessed: 0,
      eventsProcessed: 0,
    });

    // Make sure the schema additions and per-object directories exist
    // before we start writing rows — safer to run unconditionally than to
    // assume the workspace init route already did it for this workspace.
    try {
      await ensureLatestSchema();
    } catch {
      // Non-fatal — most rows still write fine; surfaced via per-tool errors.
    }
    try {
      ensureOnboardingObjectDirs();
    } catch {
      // ignore
    }

    const connections = readConnections();
    let totalMessages = 0;
    let totalPeople = 0;
    let totalCompanies = 0;
    let totalThreads = 0;
    let totalEvents = 0;
    let selfEmail: string | null = null;

    // ----- Gmail -----
    if (connections.gmail) {
      try {
        const summary = await runGmailBackfill({
          connectionId: connections.gmail.connectionId,
          signal: options.signal,
          onProgress: (event: GmailSyncProgress) => {
            emit({
              phase: event.phase === "starting" ? "starting" : "gmail",
              message: event.message,
              messagesProcessed: event.messagesProcessed,
              peopleProcessed: event.peopleProcessed,
              companiesProcessed: event.companiesProcessed,
              threadsProcessed: event.threadsProcessed,
              eventsProcessed: totalEvents,
              ...(event.error ? { error: event.error } : {}),
            });
          },
        });
        totalMessages = summary.messagesProcessed;
        totalPeople = summary.peopleProcessed;
        totalCompanies = summary.companiesProcessed;
        totalThreads = summary.threadsProcessed;
        selfEmail = summary.selfEmail ?? null;
      } catch (err) {
        // Surface the full stack to stderr so dev-mode terminal shows
        // exactly where the failure happened — the SSE only carries the
        // message, which is often not enough to tell e.g. "the field map
        // came back empty" from "the Composio call returned a 4xx".
        console.error("[sync-runner] Gmail backfill failed:", err);
        emit({
          phase: "error",
          message: `Gmail sync failed: ${(err as Error).message}`,
          messagesProcessed: totalMessages,
          peopleProcessed: totalPeople,
          companiesProcessed: totalCompanies,
          threadsProcessed: totalThreads,
          eventsProcessed: totalEvents,
          error: (err as Error).message,
        });
        if (err instanceof ComposioToolNoConnectionError) {
          // Don't proceed to calendar if Gmail is broken — likely both
          // need a re-OAuth and the user gets a clearer error this way.
          return;
        }
      }
    }

    // ----- Calendar -----
    if (connections.calendar) {
      try {
        const summary = await runCalendarBackfill({
          connectionId: connections.calendar.connectionId,
          selfEmail,
          signal: options.signal,
          onProgress: (event: CalendarSyncProgress) => {
            emit({
              phase: event.phase === "starting" ? "starting" : "calendar",
              message: event.message,
              messagesProcessed: totalMessages,
              peopleProcessed: totalPeople,
              companiesProcessed: totalCompanies,
              threadsProcessed: totalThreads,
              eventsProcessed: event.eventsProcessed,
            });
          },
        });
        totalEvents = summary.eventsProcessed;
        totalPeople += summary.peopleProcessed;
      } catch (err) {
        console.error("[sync-runner] Calendar backfill failed:", err);
        emit({
          phase: "error",
          message: `Calendar sync failed: ${(err as Error).message}`,
          messagesProcessed: totalMessages,
          peopleProcessed: totalPeople,
          companiesProcessed: totalCompanies,
          threadsProcessed: totalThreads,
          eventsProcessed: totalEvents,
          error: (err as Error).message,
        });
        // Calendar failure is non-fatal — keep going to scoring + poller.
      }
    }

    // ----- Auto-merge duplicate people (by normalized email/phone) -----
    // Runs *before* scoring so the score recompute reflects the
    // consolidated people rows (interactions on losers are remapped onto
    // the canonical winner before we sum up Strength Score).
    emit({
      phase: "merging",
      message: "Merging duplicate contacts…",
      messagesProcessed: totalMessages,
      peopleProcessed: totalPeople,
      companiesProcessed: totalCompanies,
      threadsProcessed: totalThreads,
      eventsProcessed: totalEvents,
    });
    try {
      const mergeReport = await mergeDuplicatePeople();
      if (mergeReport.rowsMerged > 0) {
        // The People count we surfaced earlier counted post-sync rows
        // *before* dedupe; subtract the merged-away losers so the
        // onboarding "X people" headline reflects what the user will
        // actually see in the workspace.
        totalPeople = Math.max(0, totalPeople - mergeReport.rowsMerged);
      }
    } catch (err) {
      console.error("[sync-runner] people merge failed:", err);
      // Non-fatal: a failed merge leaves duplicates in place but the
      // rest of the workspace is fine. Next poll tick will retry.
    }

    // ----- Score recompute -----
    emit({
      phase: "scoring",
      message: "Computing Strongest Connection scores…",
      messagesProcessed: totalMessages,
      peopleProcessed: totalPeople,
      companiesProcessed: totalCompanies,
      threadsProcessed: totalThreads,
      eventsProcessed: totalEvents,
    });
    try {
      await recomputeAllScores();
    } catch {
      // Non-fatal: scoring is recoverable on next poll tick.
    }

    // Install the Strongest / Going Cold / By Strength / Recent threads views.
    try {
      installDefaultViews();
    } catch {
      // Non-fatal: views are user-curatable; failure here just leaves the
      // workspace with the user's pre-existing views.
    }

    emit({
      phase: "complete",
      message: "All set — opening your workspace.",
      messagesProcessed: totalMessages,
      peopleProcessed: totalPeople,
      companiesProcessed: totalCompanies,
      threadsProcessed: totalThreads,
      eventsProcessed: totalEvents,
    });

    // No need to arm an in-process poller: the OpenClaw gateway's
    // `dench-ai-gateway` plugin already posts to `/api/sync/poll-tick`
    // on its own schedule. First gateway tick will catch up anything
    // that landed between the backfill commit and now.
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Incremental poller
// ---------------------------------------------------------------------------

/**
 * @deprecated The incremental poll loop is now driven by the
 * `dench-ai-gateway` OpenClaw plugin (which posts to `/api/sync/poll-tick`
 * from inside the long-lived gateway daemon). This function is retained as
 * a no-op shim so older callers don't break; new callers should use
 * `tickPoller()` directly if they need a one-shot run, or rely on the
 * gateway-driven cron for ongoing polling. The `intervalMs` parameter is
 * ignored.
 */
export function armIncrementalPoller(_intervalMs?: number): void {
  // No-op: the gateway plugin owns timing now.
}

export function stopIncrementalPoller(): void {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
  }
}

/**
 * Run a single incremental Gmail/Calendar poll cycle. Safe to call
 * concurrently — the module mutex makes overlapping invocations no-ops.
 *
 * Called from `apps/web/app/api/sync/poll-tick/route.ts`, which is
 * triggered by the gateway-side `dench-ai-gateway` plugin every ~5 min.
 */
export async function tickPoller(): Promise<void> {
  if (mutex.isLocked()) {return;}
  const release = await mutex.acquire();
  try {
    const connections = readConnections();
    const cursors = readSyncCursors();
    let didWork = false;

    if (connections.gmail && cursors.gmail?.historyId) {
      try {
        const summary = await runGmailIncremental({
          connectionId: connections.gmail.connectionId,
          startHistoryId: cursors.gmail.historyId,
        });
        if (summary.messagesProcessed > 0) {
          didWork = true;
          emit({
            phase: "polling",
            message: `Synced ${summary.messagesProcessed} new email${
              summary.messagesProcessed === 1 ? "" : "s"
            }.`,
            messagesProcessed: summary.messagesProcessed,
            peopleProcessed: summary.peopleProcessed,
            companiesProcessed: summary.companiesProcessed,
            threadsProcessed: summary.threadsProcessed,
            eventsProcessed: 0,
          });
        }
      } catch (err) {
        if (err instanceof ComposioToolNoConnectionError) {
          // Surface the error but don't break the poller; user fixes by reconnecting.
          emit({
            phase: "error",
            message: "Gmail connection expired. Reconnect from Integrations.",
            messagesProcessed: 0,
            peopleProcessed: 0,
            companiesProcessed: 0,
            threadsProcessed: 0,
            eventsProcessed: 0,
            error: err.message,
          });
        }
      }
    }

    if (connections.calendar && cursors.calendar?.syncToken) {
      try {
        const summary = await runCalendarIncremental({
          connectionId: connections.calendar.connectionId,
          syncToken: cursors.calendar.syncToken,
          selfEmail: connections.gmail?.accountEmail ?? null,
        });
        if (summary.eventsProcessed > 0) {
          didWork = true;
          emit({
            phase: "polling",
            message: `Synced ${summary.eventsProcessed} new event${
              summary.eventsProcessed === 1 ? "" : "s"
            }.`,
            messagesProcessed: 0,
            peopleProcessed: summary.peopleProcessed,
            companiesProcessed: 0,
            threadsProcessed: 0,
            eventsProcessed: summary.eventsProcessed,
          });
        }
      } catch (err) {
        if (err instanceof ComposioToolNoConnectionError) {
          emit({
            phase: "error",
            message: "Calendar connection expired. Reconnect from Integrations.",
            messagesProcessed: 0,
            peopleProcessed: 0,
            companiesProcessed: 0,
            threadsProcessed: 0,
            eventsProcessed: 0,
            error: err.message,
          });
        }
      }
    }

    if (didWork) {
      // Auto-merge any duplicate people that the incremental sync may
      // have introduced (e.g. an attendee surfaced via Calendar that the
      // Gmail-side cache hadn't yet seen). Order matters: merge first so
      // the rescore aggregates over the canonical-only set of people.
      try {
        await mergeDuplicatePeople();
      } catch (err) {
        console.error("[sync-runner] people merge failed during poll:", err);
      }
      // Lightweight rescore — runs in foreground so the next render has it.
      try {
        await recomputeAllScores();
      } catch {
        // ignore
      }
    }

    writeSyncCursors({}); // touch updatedAt
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Test-only resets
// ---------------------------------------------------------------------------

export function _resetSyncRunnerForTests(): void {
  stopIncrementalPoller();
  listeners.clear();
  lastEvent = null;
  backfillRunning = false;
  backfillPromise = null;
}
