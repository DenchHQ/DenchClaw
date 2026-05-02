import { defineSkillTemplate, externalApps } from "./create-template";

export const noShowRecovery = defineSkillTemplate({
  id: "no-show-recovery",
  title: "No-show Recovery",
  summary: "Recover missed meetings with fast, polite rescheduling and CRM notes.",
  category: "Follow Up",
  outcome: "Identifies no-shows, sends rescheduling notes, updates CRM/calendar context, and stops when a new meeting is booked.",
  userUseCase:
    "Use this when a prospect, customer, candidate, partner, or investor misses a scheduled meeting and the owner needs a fast, polite recovery path. The skill reviews calendar and CRM context, drafts a no-blame reschedule message, updates the record, and stops once the person replies or books a new time.",
  personas: ["Founder", "Sales", "Customer Success", "Recruiter"],
  requiredApps: [externalApps.gmail, externalApps.googleCalendar],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "meeting-source",
      prompt: "How should DenchClaw identify no-shows?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "calendar-review", label: "Calendar review" },
        { id: "crm-meeting-outcomes", label: "CRM outcomes" },
        { id: "manual-trigger", label: "Manual trigger" },
        { id: "uploaded-log", label: "Uploaded log" },
      ],
      freeformHint: "Include calendar names, CRM outcome values, or how you will invoke it manually.",
    },
    {
      id: "meeting-types",
      prompt: "Which meeting types should this recover?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "sales-discovery", label: "Sales discovery" },
        { id: "demo", label: "Demo" },
        { id: "customer-success", label: "Customer success" },
        { id: "candidate-interview", label: "Candidate interview" },
        { id: "investor-bd", label: "Investor or BD" },
      ],
    },
    {
      id: "first-touch-timing",
      prompt: "When should the first no-show message be drafted or sent?",
      required: true,
      options: [
        { id: "15-minutes", label: "15 minutes" },
        { id: "1-hour", label: "1 hour" },
        { id: "same-day", label: "Same day" },
        { id: "next-business-day", label: "Next business day" },
      ],
      freeformHint: "Include quiet hours and whether timing differs by meeting type.",
    },
    {
      id: "reschedule-cta",
      prompt: "What rescheduling CTA should the recovery note use?",
      required: true,
      options: [
        { id: "booking-link", label: "Booking link" },
        { id: "offer-times", label: "Offer times" },
        { id: "ask-for-times", label: "Ask for times" },
        { id: "owner-review", label: "Owner review first" },
      ],
      freeformHint: "Provide booking links, calendar constraints, or preferred time windows.",
    },
    {
      id: "retry-stop-rules",
      prompt: "What retry limits, reply detection, and stop conditions should apply?",
      required: true,
      freeformHint: "Include max attempts, spacing, quiet hours, booked meeting detection, apology/reply handling, CRM outcome updates, and when to mark closed/no-response.",
    },
  ],
  skillInstructions: [
    "Identify likely no-shows from Calendar history, CRM meeting outcomes, uploaded logs, or manual input; verify attendance state during each manual or scheduled run instead of relying on webhooks.",
    "Use meeting title, attendees, CRM record, prior thread, and notes/files to understand context before writing a recovery message.",
    "Draft or send a fast, polite note that assumes positive intent, avoids blame, and offers the approved rescheduling path with minimal friction.",
    "Apply different wording for sales, customer, recruiting, founder, and investor/BD meetings so the note fits the relationship and stakes.",
    "Respect send guardrails including draft-vs-send mode, quiet hours, daily caps, booking-link rules, recipient exclusions, and duplicate prevention for the same missed meeting.",
    "For scheduled runs, check Calendar, Gmail, and CRM activity before each follow-up so the skill stops once a new meeting is booked, the person replies, the owner intervenes, or the record changes stage.",
    "Log the no-show, message sent or drafted, next retry date, and final outcome in CRM/calendar notes without overwriting existing user-authored context unless explicitly allowed.",
  ],
});
