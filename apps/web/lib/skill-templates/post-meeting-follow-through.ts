import { defineSkillTemplate, externalApps } from "./create-template";

export const postMeetingFollowThrough = defineSkillTemplate({
  id: "post-meeting-follow-through",
  title: "Post-meeting Follow-through",
  summary: "Turn meeting notes into follow-ups, CRM updates, and owner-specific tasks.",
  category: "Prep Meetings",
  outcome: "Summarizes meeting outcomes, drafts or sends next-step emails, updates CRM, and creates scheduled reminders.",
  userUseCase:
    "Use this after meetings to turn Calendar events, Gmail threads, notes, Dench CRM records, HubSpot context, and Notion notes into follow-up drafts, CRM updates, tasks, and reminders. It should run manually after a selected meeting or on a cron schedule for recently completed meetings.",
  personas: ["Founder", "Sales", "Customer Success", "Recruiter"],
  requiredApps: [externalApps.googleCalendar, externalApps.gmail, externalApps.hubspot],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "meeting-scope",
      prompt: "Which completed meetings should trigger follow-through?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "sales-calls", label: "Sales calls" },
        { id: "customer-calls", label: "Customer calls" },
        { id: "investor-meetings", label: "Investor meetings" },
        { id: "recruiting-interviews", label: "Recruiting interviews" },
        { id: "all-external", label: "All external meetings" },
      ],
    },
    {
      id: "notes-source",
      prompt: "Where should meeting notes or outcomes come from?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "calendar-description", label: "Calendar description" },
        { id: "gmail-thread", label: "Gmail thread" },
        { id: "notion-notes", label: "Notion notes" },
        { id: "dench-chat", label: "Dench chat" },
        { id: "manual-summary", label: "Manual summary" },
      ],
    },
    {
      id: "followup-actions",
      prompt: "What should the skill create after meetings?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "gmail-draft", label: "Gmail follow-up draft" },
        { id: "crm-note", label: "CRM note" },
        { id: "crm-task", label: "CRM task" },
        { id: "hubspot-update", label: "HubSpot update" },
        { id: "notion-action-items", label: "Notion action items" },
      ],
    },
    {
      id: "write-confidence",
      prompt: "What confidence is required before writing CRM updates?",
      required: true,
      options: [
        { id: "draft-review", label: "Draft for review" },
        { id: "write-85", label: "Write 85%+ confidence" },
        { id: "write-95", label: "Write 95%+ confidence" },
      ],
    },
    {
      id: "timing-destination",
      prompt: "When and where should follow-through be delivered?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "immediately-after", label: "Immediately after" },
        { id: "end-of-day", label: "End of day" },
        { id: "next-morning", label: "Next morning" },
        { id: "manual-only", label: "Manual only" },
      ],
      freeformHint: "Include cron cadence, timezone, destination, and expected follow-up SLA.",
    },
  ],
  skillInstructions: [
    "Support manual post-meeting runs and cron/scheduled scans of recently completed Calendar events only.",
    "Use Calendar event details to identify attendees, then gather Gmail, Dench CRM, HubSpot, Notion, and manual notes as available.",
    "Create follow-up drafts, CRM notes, tasks, and Notion actions only according to the configured action policy.",
    "For CRM writes, use additive notes with source attribution, meeting date, attendees, confidence score, and linked source records.",
    "Never overwrite existing CRM fields, deal stages, owners, or next steps unless the user explicitly configures that overwrite policy.",
    "If meeting outcomes are ambiguous or below the confidence threshold, produce a review draft instead of writing updates automatically.",
    "Deliver follow-through at the configured timing and destination, and make scheduled runs idempotent by skipping meetings already processed.",
  ],
});
