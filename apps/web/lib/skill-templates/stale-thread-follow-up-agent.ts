import { defineSkillTemplate, externalApps } from "./create-template";

export const staleThreadFollowUpAgent = defineSkillTemplate({
  id: "stale-thread-follow-up-agent",
  title: "Stale Thread Follow-up Agent",
  summary: "Find valuable email threads that went quiet and revive them safely.",
  category: "Follow Up",
  outcome: "Scans stale conversations, ranks which deserve action, drafts or sends tasteful nudges, and updates CRM status.",
  userUseCase:
    "Use this when important conversations have gone quiet and you need DenchClaw to find the threads worth reviving, understand the last ask, draft a tasteful next step, and keep CRM state honest.",
  personas: ["Founder", "Sales", "Customer Success"],
  requiredApps: [externalApps.gmail, externalApps.hubspot],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "thread-sources",
      prompt: "Where should DenchClaw look for stale conversations?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "gmail", label: "Gmail threads" },
        { id: "crm-activities", label: "CRM activity" },
        { id: "hubspot-deals", label: "HubSpot deals" },
        { id: "uploaded-export", label: "Uploaded export" },
      ],
    },
    {
      id: "stale-definition",
      prompt: "When should a thread count as stale?",
      required: true,
      options: [
        { id: "3-days", label: "3 days" },
        { id: "7-days", label: "7 days" },
        { id: "14-days", label: "14 days" },
        { id: "custom", label: "Custom" },
      ],
      freeformHint: "Say whether the clock starts from your last message, their last message, a proposal sent, a meeting held, or a CRM stage change.",
    },
    {
      id: "valuable-thread-rules",
      prompt: "Which stale threads are worth following up on?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "open-opportunities", label: "Open opportunities" },
        { id: "recent-meetings", label: "Recent meetings" },
        { id: "exec-contacts", label: "Executive contacts" },
        { id: "customer-risk", label: "Customer risk" },
        { id: "manual-priority", label: "Manual priority" },
      ],
      freeformHint: "Include exclusions like closed-lost, support-only, vendor, personal, or do-not-contact threads.",
    },
    {
      id: "follow-up-tone",
      prompt: "What kind of nudge should the skill write?",
      required: true,
      options: [
        { id: "light-bump", label: "Light bump" },
        { id: "useful-context", label: "Add useful context" },
        { id: "deadline-check", label: "Deadline check" },
        { id: "breakup-note", label: "Breakup note" },
      ],
    },
    {
      id: "send-and-stop-rules",
      prompt: "What send, quiet-hour, reply-detection, and stop-condition rules should apply?",
      required: true,
      freeformHint: "Include draft vs send, max nudges per thread, quiet hours, reply detection, meeting booked, CRM stage changes, and do-not-contact handling.",
    },
  ],
  skillInstructions: [
    "Scan only the selected sources for stale conversations during manual or scheduled runs; do not rely on email webhooks or app callbacks.",
    "Rank threads by business value using CRM stage, deal amount, account importance, relationship strength, recent meeting context, and owner priority.",
    "Before drafting, summarize the thread history, last unanswered ask, likely next step, and CRM facts that change the recommendation.",
    "Draft follow-ups that reference the real prior conversation, avoid guilt or pressure, and choose the lightest useful CTA for the thread state.",
    "Send only when explicit rules allow it; otherwise create drafts or CRM tasks with the recommended send window.",
    "For scheduled runs, check Gmail, CRM, HubSpot, and prior Dench notes to avoid duplicate nudges and skip threads already handled by a teammate.",
    "Stop when a reply is detected, a meeting is booked, the CRM stage closes or disqualifies, the contact opts out, or the owner marks the thread done.",
  ],
});
