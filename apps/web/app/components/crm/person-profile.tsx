"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { PersonAvatar } from "./person-avatar";
import { CompanyFavicon } from "./company-favicon";
import { ConnectionStrengthChip } from "./connection-strength-chip";
import { CrmEmptyState, CrmLoadingState } from "./crm-list-shell";
import { formatDayLabel, formatRelativeDate } from "./format-relative-date";
import { EnrichButton } from "./enrich-button";
import { ProfileThreadList } from "./inbox/profile-thread-list";
import { EventListItem } from "./event-list-item";
import { ActivityTimeline } from "./activity-timeline";
import { EditableTitleHeading } from "./editable-title-heading";

// ---------------------------------------------------------------------------
// API response shape (mirrors apps/web/app/api/crm/people/[id]/route.ts)
// ---------------------------------------------------------------------------

type PersonResponse = {
  person: {
    id: string;
    name: string | null;
    email: string | null;
    company_name: string | null;
    phone: string | null;
    status: string | null;
    source: string | null;
    strength_score: number | null;
    strength_label: string;
    strength_color: string;
    last_interaction_at: string | null;
    job_title: string | null;
    linkedin_url: string | null;
    avatar_url: string | null;
    notes: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
  company: {
    id: string;
    name: string | null;
    domain: string | null;
    website: string | null;
    industry: string | null;
    type: string | null;
    source: string | null;
    strength_score: number | null;
  } | null;
  derived_website: string | null;
  threads: Array<{
    id: string;
    subject: string | null;
    last_message_at: string | null;
    message_count: number | null;
    gmail_thread_id: string | null;
    snippet: string | null;
    primary_sender_type: string | null;
    primary_sender_id: string | null;
    primary_sender_name: string | null;
    primary_sender_email: string | null;
    primary_sender_avatar_url: string | null;
  }>;
  events: Array<{
    id: string;
    title: string | null;
    start_at: string | null;
    end_at: string | null;
    meeting_type: string | null;
    google_event_id: string | null;
  }>;
  interactions_summary: {
    email_count: number;
    meeting_count: number;
    total: number;
    last_outbound_at: string | null;
    last_inbound_at: string | null;
  };
};

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Tab = "overview" | "emails" | "calendar" | "activity" | "notes";

const TABS: ReadonlyArray<{ id: Tab; label: string; getCount?: (data: PersonResponse) => number | null }> = [
  { id: "overview", label: "Overview" },
  { id: "emails", label: "Emails", getCount: (d) => d.threads.length },
  { id: "calendar", label: "Meetings", getCount: (d) => d.events.length },
  { id: "activity", label: "Activity", getCount: (d) => d.interactions_summary.total },
  { id: "notes", label: "Notes" },
];

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export function PersonProfile({
  personId,
  onOpenPerson,
  onOpenCompany,
  onBackToList,
}: {
  personId: string;
  onOpenPerson?: (id: string) => void;
  onOpenCompany?: (id: string) => void;
  onBackToList?: () => void;
}) {
  const [data, setData] = useState<PersonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/people/${encodeURIComponent(personId)}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setError("Person not found.");
        setData(null);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const next = (await res.json()) as PersonResponse;
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load person.");
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Persist a new name when the heading was empty and the user filled it in.
  // We optimistically write the new value to local `data` so the heading,
  // avatar initials, and downstream subtitle copy update immediately —
  // calling `load()` would flicker the entire page through a skeleton state.
  const handleSaveName = useCallback(
    async (newName: string) => {
      const res = await fetch(
        `/api/workspace/objects/people/entries/${encodeURIComponent(personId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: { "Full Name": newName } }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData((prev) =>
        prev ? { ...prev, person: { ...prev.person, name: newName } } : prev,
      );
    },
    [personId],
  );

  if (loading && !data) {
    return (
      <div className="flex h-full flex-col" style={{ background: "var(--color-background)" }}>
        <CrmLoadingState label="Loading profile…" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex h-full flex-col" style={{ background: "var(--color-background)" }}>
        <CrmEmptyState
          title="Couldn't load this contact"
          description={error ?? "The record may have been deleted."}
          cta={
            onBackToList && (
              <Button variant="outline" size="sm" onClick={onBackToList}>
                Back to People
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ background: "var(--color-background)" }}
    >
      <PersonHeader
        data={data}
        tab={tab}
        onTabChange={setTab}
        onOpenCompany={onOpenCompany}
        onBackToList={onBackToList}
        onSaveName={handleSaveName}
      />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-6">
          {tab === "overview" && (
            <OverviewTab data={data} onOpenCompany={onOpenCompany} />
          )}
          {tab === "emails" && <EmailsTab data={data} onOpenPerson={onOpenPerson} />}
          {tab === "calendar" && (
            <CalendarTab
              data={data}
              onOpenPerson={onOpenPerson}
              onOpenCompany={onOpenCompany}
            />
          )}
          {tab === "activity" && (
            <ActivityTab
              data={data}
              onOpenPerson={onOpenPerson}
              onOpenCompany={onOpenCompany}
            />
          )}
          {tab === "notes" && <NotesTab data={data} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header (sticky)
// ---------------------------------------------------------------------------

function PersonHeader({
  data,
  tab,
  onTabChange,
  onOpenCompany,
  onBackToList,
  onSaveName,
}: {
  data: PersonResponse;
  tab: Tab;
  onTabChange: (t: Tab) => void;
  onOpenCompany?: (id: string) => void;
  onBackToList?: () => void;
  onSaveName: (newName: string) => Promise<void>;
}) {
  const { person, company, derived_website } = data;
  // Avatar still uses the email/Unknown fallback so an empty-name person
  // gets a recognizable monogram from their email rather than a "?" tile —
  // the heading itself swaps to the "Add a name" affordance independently.
  const displayName = person.name?.trim() || person.email || "Unknown contact";
  const website = company?.website || derived_website;

  return (
    <header
      className="shrink-0 px-6 pt-4 pb-0"
      style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-background)" }}
    >
      {/* Breadcrumb row */}
      <div className="mb-3 flex items-center gap-2 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
        {onBackToList && (
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="m15 18-6-6 6-6" />
            </svg>
            People
          </button>
        )}
      </div>

      {/* Hero row */}
      <div className="flex items-start gap-4">
        <PersonAvatar
          src={person.avatar_url}
          name={displayName}
          seed={person.email ?? person.id}
          size="xl"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <EditableTitleHeading name={person.name} saveName={onSaveName} />
            <ConnectionStrengthChip score={person.strength_score} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            {person.email && (
              <a
                href={`mailto:${person.email}`}
                className="hover:underline truncate"
                style={{ color: "var(--color-text-muted)" }}
              >
                {person.email}
              </a>
            )}
            {company && onOpenCompany && (
              <button
                type="button"
                onClick={() => onOpenCompany(company.id)}
                className="inline-flex items-center gap-1.5 hover:underline"
                style={{ color: "var(--color-text-muted)" }}
              >
                <CompanyFavicon domain={company.domain} name={company.name} size="sm" />
                <span>{company.name ?? company.domain}</span>
              </button>
            )}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
                style={{ color: "var(--color-text-muted)" }}
              >
                {website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          {(person.job_title || person.phone || person.linkedin_url) && (
            <div
              className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {person.job_title && <span>{person.job_title}</span>}
              {person.phone && <span>{person.phone}</span>}
              {person.linkedin_url && (
                <a href={person.linkedin_url} target="_blank" rel="noreferrer" className="hover:underline">
                  LinkedIn
                </a>
              )}
            </div>
          )}
        </div>

        {/* Action icons */}
        <div className="flex shrink-0 items-center gap-2">
          {person.email && (
            <a
              href={`mailto:${person.email}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                background: "var(--color-surface)",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
              title="Compose email"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </a>
          )}
          {person.email && (
            <a
              href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent("from:" + person.email + " OR to:" + person.email)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                background: "var(--color-surface)",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
              }}
              title="Open in Gmail"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
                <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </svg>
            </a>
          )}
          {/* <EnrichButton type="people" id={person.id} /> */}
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex items-center gap-4 -mb-px">
        {TABS.map((t) => {
          const count = t.getCount?.(data);
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className="relative flex items-center gap-1.5 px-1 py-2 text-[13px] font-medium transition-colors"
              style={{
                color: active ? "var(--color-text)" : "var(--color-text-muted)",
                borderBottom: active ? "2px solid var(--color-text)" : "2px solid transparent",
              }}
            >
              {t.label}
              {typeof count === "number" && count > 0 && (
                <span
                  className="rounded-full px-1.5 py-0 text-[10px]"
                  style={{
                    background: "var(--color-surface-hover)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Tabs — bodies
// ---------------------------------------------------------------------------

function OverviewTab({
  data,
  onOpenCompany,
}: {
  data: PersonResponse;
  onOpenCompany?: (id: string) => void;
}) {
  const { person, company, interactions_summary } = data;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-text-muted)" }}>
          At a glance
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Strength" value={person.strength_label} />
          <Stat
            label="Last contact"
            value={
              person.last_interaction_at
                ? formatRelativeDate(person.last_interaction_at)
                : "—"
            }
          />
          <Stat label="Emails" value={interactions_summary.email_count.toLocaleString()} />
          <Stat label="Meetings" value={interactions_summary.meeting_count.toLocaleString()} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-text-muted)" }}>
          Contact
        </h3>
        <div className="space-y-2.5 rounded-2xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <Field label="Email" value={person.email} link={person.email ? `mailto:${person.email}` : undefined} />
          <Field label="Phone" value={person.phone} link={person.phone ? `tel:${person.phone}` : undefined} />
          <Field label="LinkedIn" value={person.linkedin_url} link={person.linkedin_url ?? undefined} external />
          <Field label="Job title" value={person.job_title} />
          <Field label="Status" value={person.status} />
          <Field label="Source" value={person.source} />
        </div>
      </section>

      {company && (
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-text-muted)" }}>
            Company
          </h3>
          <button
            type="button"
            onClick={() => onOpenCompany?.(company.id)}
            disabled={!onOpenCompany}
            className="flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors disabled:cursor-default"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-surface)",
            }}
            onMouseEnter={(e) => {
              if (!onOpenCompany) {return;}
              (e.currentTarget as HTMLElement).style.borderColor = "var(--color-accent)";
            }}
            onMouseLeave={(e) => {
              if (!onOpenCompany) {return;}
              (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)";
            }}
          >
            <CompanyFavicon domain={company.domain} name={company.name} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                {company.name ?? company.domain ?? "Unknown company"}
              </p>
              {(company.domain || company.industry) && (
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                  {[company.domain, company.industry].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <ConnectionStrengthChip score={company.strength_score} />
          </button>
        </section>
      )}
    </div>
  );
}

function EmailsTab({
  data,
  onOpenPerson,
}: {
  data: PersonResponse;
  onOpenPerson?: (id: string) => void;
}) {
  if (data.threads.length === 0) {
    return (
      <CrmEmptyState
        title="No threads with this contact yet"
        description="Threads appear here as soon as Gmail is connected and the next sync tick runs."
      />
    );
  }
  // ProfileThreadList renders the same Inbox-style row treatment AND
  // expands the conversation reader inline on click — same MessageCard /
  // MessageBody / QuickReply chain the Inbox uses, no external Gmail
  // round-trip required.
  return <ProfileThreadList threads={data.threads} onOpenPerson={onOpenPerson} />;
}

function CalendarTab({
  data,
  onOpenPerson,
  onOpenCompany,
}: {
  data: PersonResponse;
  onOpenPerson?: (id: string) => void;
  onOpenCompany?: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (data.events.length === 0) {
    return (
      <CrmEmptyState
        title="No meetings with this contact"
        description="Once Calendar is connected and the next sync runs, meetings show up here."
      />
    );
  }
  // Group by day — preserves the API's start_at DESC ordering inside
  // each group, which is what the user expects (most recent on top).
  const groups = new Map<string, typeof data.events>();
  for (const event of data.events) {
    const day = event.start_at ? formatDayLabel(event.start_at) : "Unknown date";
    if (!groups.has(day)) {groups.set(day, []);}
    groups.get(day)!.push(event);
  }
  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([day, events]) => (
        <section key={day}>
          <h3
            className="sticky top-0 z-10 mb-2 px-1 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--color-text-muted)", background: "var(--color-background)" }}
          >
            {day}
          </h3>
          <ul className="space-y-2">
            {events.map((event) => (
              <EventListItem
                key={event.id}
                event={event}
                expanded={expandedId === event.id}
                onToggle={() =>
                  setExpandedId((prev) => (prev === event.id ? null : event.id))
                }
                onOpenPerson={onOpenPerson}
                onOpenCompany={onOpenCompany}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ActivityTab({
  data,
  onOpenPerson,
  onOpenCompany,
}: {
  data: PersonResponse;
  onOpenPerson?: (id: string) => void;
  onOpenCompany?: (id: string) => void;
}) {
  const summary = data.interactions_summary;
  if (summary.total === 0) {
    return (
      <CrmEmptyState
        title="No activity yet"
        description="Emails and meetings appear here once they're synced."
      />
    );
  }
  // The "Total" stat is the count of raw atomic interaction rows
  // (one per message-per-counterparty + one per attendee-per-meeting),
  // which is intentionally larger than the number of timeline rows
  // shown below — those are de-duplicated to one row per
  // message I exchanged with this person + one row per meeting we
  // both attended. The label below makes that distinction explicit so
  // users don't wonder why "500" doesn't match what they're scrolling.
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Interactions" value={summary.total.toLocaleString()} />
          <Stat label="Emails" value={summary.email_count.toLocaleString()} />
          <Stat label="Meetings" value={summary.meeting_count.toLocaleString()} />
          <Stat
            label="Last reply"
            value={summary.last_inbound_at ? formatRelativeDate(summary.last_inbound_at) : "—"}
          />
        </div>
        {summary.last_outbound_at && (
          <div
            className="rounded-2xl border px-4 py-3 text-[13px]"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p style={{ color: "var(--color-text-muted)" }}>
              You last reached out{" "}
              <strong style={{ color: "var(--color-text)" }}>
                {formatRelativeDate(summary.last_outbound_at)}
              </strong>
              .
            </p>
          </div>
        )}
      </section>

      <section>
        <h3
          className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "var(--color-text-muted)" }}
        >
          Timeline
        </h3>
        <ActivityTimeline
          personId={data.person.id}
          onOpenPerson={onOpenPerson}
          onOpenCompany={onOpenCompany}
        />
      </section>
    </div>
  );
}

function NotesTab({ data }: { data: PersonResponse }) {
  if (!data.person.notes?.trim()) {
    return (
      <CrmEmptyState
        title="No notes yet"
        description="Notes added in the People object detail panel will show up here."
      />
    );
  }
  return (
    <article className="prose prose-sm max-w-none" style={{ color: "var(--color-text)" }}>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{data.person.notes}</pre>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="rounded-2xl border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </dt>
      <dd className="mt-1 text-[14px] font-medium" style={{ color: "var(--color-text)" }}>
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  value,
  link,
  external,
}: {
  label: string;
  value: string | null;
  link?: string;
  external?: boolean;
}) {
  if (!value) {
    return (
      <div className="flex items-baseline gap-3 text-[13px]">
        <dt className="w-24 shrink-0" style={{ color: "var(--color-text-muted)" }}>
          {label}
        </dt>
        <dd style={{ color: "var(--color-text-muted)" }}>—</dd>
      </div>
    );
  }
  const inner = link ? (
    <a
      href={link}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="hover:underline truncate"
      style={{ color: "var(--color-text)" }}
    >
      {value}
    </a>
  ) : (
    <span className="truncate" style={{ color: "var(--color-text)" }}>
      {value}
    </span>
  );
  return (
    <div className="flex items-baseline gap-3 text-[13px] min-w-0">
      <dt className="w-24 shrink-0" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </dt>
      <dd className="min-w-0">{inner}</dd>
    </div>
  );
}

// Suppress unused variable warning when memoization is unused but kept for future use
void useMemo;
