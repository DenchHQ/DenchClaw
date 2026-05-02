import { defineSkillTemplate, externalApps } from "./create-template";

export const interviewFollowUpAgent = defineSkillTemplate({
  id: "interview-follow-up-agent",
  title: "Interview Follow-up Agent",
  summary: "Send timely candidate follow-ups and keep interview loops moving.",
  category: "Hire People",
  outcome: "Detects completed interviews, sends next-step messages, nudges interviewers, and updates candidate status.",
  userUseCase: "Use this after interviews to draft candidate updates, nudge interviewers for feedback, and keep hiring loops moving without exposing private notes or using protected-class information.",
  personas: ["Recruiter", "Founder"],
  requiredApps: [externalApps.gmail, externalApps.googleCalendar],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Creates drafts",
  interviewQuestions: [
    {
      id: "follow-up-type",
      prompt: "What kind of interview follow-up should be created?",
      required: true,
      options: [
        { id: "candidate-next-step", label: "Candidate next step" },
        { id: "feedback-reminder", label: "Feedback reminder" },
        { id: "debrief-summary", label: "Debrief summary" },
        { id: "rejection-draft", label: "Rejection draft" },
        { id: "offer-coordination", label: "Offer coordination" },
      ],
    },
    {
      id: "candidate-role-stage",
      prompt: "Which candidate, role, and interview stage does this concern?",
      required: true,
      freeformHint: "Reference the candidate record, role, interview date, participants, and stage.",
    },
    {
      id: "source-context",
      prompt: "Which sources should be checked before drafting?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "candidate-record", label: "Candidate record" },
        { id: "calendar", label: "Calendar event" },
        { id: "gmail", label: "Gmail thread" },
        { id: "scorecards", label: "Scorecards/files" },
        { id: "notion-slack", label: "Notion/Slack notes" },
      ],
    },
    {
      id: "message-policy",
      prompt: "What approval and tone rules should candidate-facing drafts follow?",
      required: true,
      freeformHint: "Include sender, signature, review requirement, timing SLA, and wording to avoid.",
    },
    {
      id: "status-policy",
      prompt: "What candidate status, task, or reminder updates may the skill create?",
      required: true,
      options: [
        { id: "draft-only", label: "Draft only" },
        { id: "create-tasks", label: "Create tasks" },
        { id: "add-notes", label: "Add notes" },
        { id: "suggest-status", label: "Suggest status" },
      ],
    },
  ],
  skillInstructions: [
    "Use Calendar events, Gmail threads, candidate records, scorecards, and authorized notes to understand interview context before drafting.",
    "Create drafts and reminders by default; do not send messages or change candidate status unless the user has explicitly configured that policy.",
    "Do not mention or rely on protected-class or sensitive personal information in candidate-facing drafts, reminders, or summaries.",
    "Keep rejection and feedback-adjacent language respectful, role-related, concise, and free of internal deliberation.",
    "For feedback reminders, include the specific interview, requested scorecard, due date, and hiring impact without shaming the interviewer.",
    "For scheduled runs, scan only the configured lookback window and skip interviews already followed up, replied to, or marked complete.",
    "Output context checked, recommended action, draft message or reminder, missing inputs, and any CRM/task updates created or proposed.",
  ],
});
