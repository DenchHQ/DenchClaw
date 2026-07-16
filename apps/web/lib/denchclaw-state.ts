/**
 * Per-workspace `.denchclaw/` persistence: onboarding state, Composio
 * connection metadata, sync cursors, and user-extended personal-email
 * blocklist. The DuckDB workspace remains authoritative for CRM rows; this
 * directory is the source of truth for everything *outside* the database
 * that needs to survive process restarts and browser refreshes.
 *
 * All writes are atomic (write to temp + rename) so a crash in the middle
 * of saving never leaves us with a half-written JSON file the wizard
 * can't read back.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolveDenchClawDir } from "./workspace";
import { SKILL_TEMPLATE_IDS, type SkillTemplateId } from "./skill-templates/types";

function isValidSkillTemplateId(value: unknown): value is SkillTemplateId {
  return (
    typeof value === "string" && (SKILL_TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

const ONBOARDING_FILENAME = "onboarding.json";
const CONNECTIONS_FILENAME = "connections.json";
const SYNC_CURSORS_FILENAME = "sync-cursors.json";
const PERSONAL_DOMAINS_FILENAME = "personal-domains.json";
const EMAIL_BODY_HYDRATION_FILENAME = "email-body-hydration-attempted.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OnboardingStep =
  | "welcome"
  | "identity"
  | "dench-cloud"
  | "connect-gmail"
  | "connect-calendar"
  | "backfill"
  | "skill-template"
  | "complete";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "welcome",
  "identity",
  "dench-cloud",
  "connect-gmail",
  "connect-calendar",
  "backfill",
  "skill-template",
  "complete",
];

export type OnboardingIdentity = {
  name: string;
  email: string;
  capturedAt: string;
};

export type OnboardingDenchCloud = {
  source: "cli" | "web";
  skipped: boolean;
  configuredAt: string;
};

export type ConnectionRecord = {
  connectionId: string;
  toolkitSlug: string;
  accountEmail?: string;
  accountLabel?: string;
  connectedAt: string;
};

export type BackfillProgress = {
  startedAt: string;
  completedAt?: string;
  pageToken?: string | null;
  messagesProcessed: number;
  peopleProcessed: number;
  companiesProcessed: number;
  threadsProcessed: number;
  /** Set when the initial page is being processed; cleared on first completion. */
  inProgress: boolean;
  /** Optional last error so the wizard can surface a retry button. */
  lastError?: string;
};

export type OnboardingSkillTemplate = {
  templateId?: SkillTemplateId;
  selectedAt?: string;
  promptConsumedAt?: string;
};

export type OnboardingState = {
  version: 1;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  identity?: OnboardingIdentity;
  denchCloud?: OnboardingDenchCloud;
  connections?: {
    gmail?: ConnectionRecord;
    calendar?: ConnectionRecord;
  };
  backfill?: {
    gmail?: BackfillProgress;
    calendar?: BackfillProgress;
  };
  skillTemplate?: OnboardingSkillTemplate;
  startedAt: string;
  updatedAt: string;
};

export type ConnectionsFile = {
  version: 1;
  gmail?: ConnectionRecord;
  calendar?: ConnectionRecord;
  updatedAt: string;
};

export type SyncCursors = {
  version: 1;
  gmail?: {
    historyId?: string;
    backfillPageToken?: string | null;
    messagesProcessed?: number;
    lastPolledAt?: string;
    lastBackfillCompletedAt?: string;
    /** ISO timestamp of the last Google profile-photo sync. Used by
     *  incremental polls to throttle the People API call (at most once
     *  per hour) so a fast polling interval doesn't hammer Composio. */
    lastPhotoSyncAt?: string;
  };
  calendar?: {
    syncToken?: string;
    backfillPageToken?: string | null;
    eventsProcessed?: number;
    lastPolledAt?: string;
    lastBackfillCompletedAt?: string;
  };
  /** Polling interval override in milliseconds; defaults to 5 minutes. */
  pollIntervalMs?: number;
  updatedAt: string;
};

export type PersonalDomainsFile = {
  version: 1;
  /** User-curated additions on top of the bundled blocklist. */
  add: string[];
  /** User-curated removals — domains the bundled list blocks but the user wants treated as company. */
  remove: string[];
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function defaultOnboardingState(): OnboardingState {
  const now = nowIso();
  return {
    version: 1,
    currentStep: "welcome",
    completedSteps: [],
    startedAt: now,
    updatedAt: now,
  };
}

function defaultConnections(): ConnectionsFile {
  return { version: 1, updatedAt: nowIso() };
}

function defaultSyncCursors(): SyncCursors {
  return { version: 1, updatedAt: nowIso() };
}

function defaultPersonalDomains(): PersonalDomainsFile {
  return { version: 1, add: [], remove: [], updatedAt: nowIso() };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function denchClawFilePath(filename: string, workspaceName?: string | null): string {
  return join(resolveDenchClawDir(workspaceName), filename);
}

// ---------------------------------------------------------------------------
// Atomic JSON IO
// ---------------------------------------------------------------------------

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) {
      return fallback;
    }
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFileAtomic(path: string, value: unknown): void {
  ensureDir(join(path, ".."));
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n", "utf-8");
    renameSync(tempPath, path);
  } catch (err) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // ignore cleanup failures
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Onboarding state
// ---------------------------------------------------------------------------

function isValidStep(step: unknown): step is OnboardingStep {
  return typeof step === "string" && (ONBOARDING_STEPS as string[]).includes(step);
}

function sanitizeSkillTemplate(input: unknown): OnboardingSkillTemplate | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const skillTemplate: OnboardingSkillTemplate = {};
  if (isValidSkillTemplateId(raw.templateId)) {
    skillTemplate.templateId = raw.templateId;
  }
  if (typeof raw.selectedAt === "string") {
    skillTemplate.selectedAt = raw.selectedAt;
  }
  if (typeof raw.promptConsumedAt === "string") {
    skillTemplate.promptConsumedAt = raw.promptConsumedAt;
  }
  return Object.keys(skillTemplate).length > 0 ? skillTemplate : undefined;
}

function sanitizeOnboardingState(input: unknown): OnboardingState {
  if (!input || typeof input !== "object") {
    return defaultOnboardingState();
  }
  const raw = input as Record<string, unknown>;
  const fallback = defaultOnboardingState();
  const completed = Array.isArray(raw.completedSteps)
    ? (raw.completedSteps as unknown[]).filter(isValidStep)
    : [];
  return {
    version: 1,
    currentStep: isValidStep(raw.currentStep) ? raw.currentStep : "welcome",
    completedSteps: completed,
    identity:
      raw.identity && typeof raw.identity === "object"
        ? (raw.identity as OnboardingIdentity)
        : undefined,
    denchCloud:
      raw.denchCloud && typeof raw.denchCloud === "object"
        ? (raw.denchCloud as OnboardingDenchCloud)
        : undefined,
    connections:
      raw.connections && typeof raw.connections === "object"
        ? (raw.connections as OnboardingState["connections"])
        : undefined,
    backfill:
      raw.backfill && typeof raw.backfill === "object"
        ? (raw.backfill as OnboardingState["backfill"])
        : undefined,
    skillTemplate: sanitizeSkillTemplate(raw.skillTemplate),
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : fallback.startedAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallback.updatedAt,
  };
}

export function readOnboardingState(workspaceName?: string | null): OnboardingState {
  const path = denchClawFilePath(ONBOARDING_FILENAME, workspaceName);
  const raw = readJsonFile<unknown>(path, null);
  if (!raw) {
    return defaultOnboardingState();
  }
  return sanitizeOnboardingState(raw);
}

export function writeOnboardingState(
  state: OnboardingState,
  workspaceName?: string | null,
): OnboardingState {
  const next: OnboardingState = {
    ...state,
    version: 1,
    updatedAt: nowIso(),
  };
  writeJsonFileAtomic(denchClawFilePath(ONBOARDING_FILENAME, workspaceName), next);
  return next;
}

/**
 * Mark a step as completed and advance to the next one in the canonical order.
 * Idempotent: re-completing the same step is a no-op for `completedSteps`.
 */
export function advanceOnboardingStep(
  step: OnboardingStep,
  next: OnboardingStep,
  patch: Partial<OnboardingState> = {},
  workspaceName?: string | null,
): OnboardingState {
  const current = readOnboardingState(workspaceName);
  const completed = new Set(current.completedSteps);
  completed.add(step);
  const merged: OnboardingState = {
    ...current,
    ...patch,
    completedSteps: Array.from(completed),
    currentStep: next,
  };
  return writeOnboardingState(merged, workspaceName);
}

export function isOnboardingComplete(workspaceName?: string | null): boolean {
  return readOnboardingState(workspaceName).currentStep === "complete";
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export function readConnections(workspaceName?: string | null): ConnectionsFile {
  return readJsonFile<ConnectionsFile>(
    denchClawFilePath(CONNECTIONS_FILENAME, workspaceName),
    defaultConnections(),
  );
}

export function writeConnection(
  toolkit: "gmail" | "calendar",
  record: ConnectionRecord,
  workspaceName?: string | null,
): ConnectionsFile {
  const current = readConnections(workspaceName);
  const next: ConnectionsFile = {
    ...current,
    version: 1,
    [toolkit]: record,
    updatedAt: nowIso(),
  };
  writeJsonFileAtomic(denchClawFilePath(CONNECTIONS_FILENAME, workspaceName), next);
  return next;
}

export function clearConnection(
  toolkit: "gmail" | "calendar",
  workspaceName?: string | null,
): ConnectionsFile {
  const current = readConnections(workspaceName);
  const next: ConnectionsFile = { ...current, version: 1, updatedAt: nowIso() };
  delete next[toolkit];
  writeJsonFileAtomic(denchClawFilePath(CONNECTIONS_FILENAME, workspaceName), next);
  return next;
}

// ---------------------------------------------------------------------------
// Sync cursors
// ---------------------------------------------------------------------------

export function readSyncCursors(workspaceName?: string | null): SyncCursors {
  return readJsonFile<SyncCursors>(
    denchClawFilePath(SYNC_CURSORS_FILENAME, workspaceName),
    defaultSyncCursors(),
  );
}

export function writeSyncCursors(
  patch: Partial<SyncCursors>,
  workspaceName?: string | null,
): SyncCursors {
  const current = readSyncCursors(workspaceName);
  const next: SyncCursors = {
    ...current,
    ...patch,
    gmail: patch.gmail ? { ...current.gmail, ...patch.gmail } : current.gmail,
    calendar: patch.calendar ? { ...current.calendar, ...patch.calendar } : current.calendar,
    version: 1,
    updatedAt: nowIso(),
  };
  writeJsonFileAtomic(denchClawFilePath(SYNC_CURSORS_FILENAME, workspaceName), next);
  return next;
}

// ---------------------------------------------------------------------------
// Personal-email domain overrides
// ---------------------------------------------------------------------------

function uniqueLowercase(values: unknown): string[] {
  if (!Array.isArray(values)) {return [];}
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      out.add(value.trim().toLowerCase());
    }
  }
  return Array.from(out);
}

export function readPersonalDomainsOverrides(
  workspaceName?: string | null,
): PersonalDomainsFile {
  const raw = readJsonFile<unknown>(
    denchClawFilePath(PERSONAL_DOMAINS_FILENAME, workspaceName),
    null,
  );
  if (!raw || typeof raw !== "object") {
    return defaultPersonalDomains();
  }
  const rec = raw as Record<string, unknown>;
  return {
    version: 1,
    add: uniqueLowercase(rec.add),
    remove: uniqueLowercase(rec.remove),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
  };
}

export function writePersonalDomainsOverrides(
  patch: { add?: string[]; remove?: string[] },
  workspaceName?: string | null,
): PersonalDomainsFile {
  const current = readPersonalDomainsOverrides(workspaceName);
  const next: PersonalDomainsFile = {
    version: 1,
    add: uniqueLowercase(patch.add ?? current.add),
    remove: uniqueLowercase(patch.remove ?? current.remove),
    updatedAt: nowIso(),
  };
  writeJsonFileAtomic(denchClawFilePath(PERSONAL_DOMAINS_FILENAME, workspaceName), next);
  return next;
}

// ---------------------------------------------------------------------------
// Email body HTML re-hydration tracking
//
// The Composio Gmail sync used to store plain-text bodies for every
// message because `extractFullBody` short-circuited on the normalized
// `messageText` field before walking the MIME tree for HTML. After that
// bug was fixed, the inbox detail route re-hydrates any stored body
// that doesn't *look* like HTML so existing data flips to the rich
// rendering on next open.
//
// To keep that re-hydration from hitting Composio every single time a
// thread is opened on a genuinely plain-text email (e.g. a coworker's
// reply), we persist the set of email_message entry IDs we've already
// attempted. Once an entry is in the set we never try again, regardless
// of whether the attempt successfully produced HTML.
//
// Manual recovery: delete this file to force a one-time retry across
// every plain-text message in the workspace.
// ---------------------------------------------------------------------------

export type EmailBodyHydrationAttemptedFile = {
  version: 1;
  /** Sorted list of email_message entry IDs we've already attempted. */
  attempted: string[];
  updatedAt: string;
};



export function readEmailBodyHydrationAttempted(
  workspaceName?: string | null,
): Set<string> {
  const raw = readJsonFile<unknown>(
    denchClawFilePath(EMAIL_BODY_HYDRATION_FILENAME, workspaceName),
    null,
  );
  if (!raw || typeof raw !== "object") {
    return new Set();
  }
  const list = (raw as Record<string, unknown>).attempted;
  if (!Array.isArray(list)) {
    return new Set();
  }
  return new Set(list.filter((v): v is string => typeof v === "string" && Boolean(v)));
}

/**
 * Mark a batch of email_message entry IDs as "we've already attempted
 * to hydrate their HTML body". Idempotent: re-marking is a no-op for
 * the on-disk set, but always bumps `updatedAt` for observability.
 */
export function markEmailBodyHydrationAttempted(
  entryIds: ReadonlyArray<string>,
  workspaceName?: string | null,
): EmailBodyHydrationAttemptedFile {
  const current = readEmailBodyHydrationAttempted(workspaceName);
  for (const id of entryIds) {
    if (typeof id === "string" && id) {
      current.add(id);
    }
  }
  const next: EmailBodyHydrationAttemptedFile = {
    version: 1,
    attempted: Array.from(current).toSorted(),
    updatedAt: nowIso(),
  };
  writeJsonFileAtomic(denchClawFilePath(EMAIL_BODY_HYDRATION_FILENAME, workspaceName), next);
  return next;
}
