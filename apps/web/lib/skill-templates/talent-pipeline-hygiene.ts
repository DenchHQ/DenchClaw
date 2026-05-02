import { defineSkillTemplate, externalApps } from "./create-template";

export const talentPipelineHygiene = defineSkillTemplate({
  id: "talent-pipeline-hygiene",
  title: "Talent Pipeline Hygiene",
  summary: "Find stale candidates, missing feedback, and broken hiring handoffs.",
  category: "Hire People",
  outcome: "Audits candidate pipelines, surfaces stale or incomplete records, and produces owner-specific cleanup actions.",
  userUseCase:
    "Use this when recruiting or operations needs a clean view of candidate pipelines: stale stages, missing feedback, duplicate profiles, scheduling gaps, and process risks. The skill should use candidate CRM data, files, Calendar/Gmail context, and optional Slack/Notion notes while avoiding protected-class or privacy-sensitive analysis.",
  personas: ["Recruiter", "Operator"],
  requiredApps: [externalApps.notion, externalApps.slack],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Updates CRM",
  interviewQuestions: [
    {
      id: "pipeline-scope",
      prompt: "Which talent pipeline should be audited?",
      required: true,
      freeformHint: "Specify roles, departments, hiring stages, recruiters, date range, or saved Dench CRM views.",
    },
    {
      id: "hygiene-checks",
      prompt: "Which hygiene issues should be flagged?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "stale", label: "Stale candidates" },
        { id: "missing-data", label: "Missing data" },
        { id: "feedback", label: "Missing feedback" },
        { id: "duplicates", label: "Duplicates" },
        { id: "scheduling", label: "Scheduling gaps" },
        { id: "compliance", label: "Process risk" },
      ],
    },
    {
      id: "source-context",
      prompt: "Which systems should be checked?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "crm", label: "Dench CRM" },
        { id: "files", label: "Files" },
        { id: "gmail", label: "Gmail" },
        { id: "calendar", label: "Calendar" },
        { id: "slack-notion", label: "Slack/Notion" },
      ],
    },
    {
      id: "cadence",
      prompt: "When should the hygiene audit run?",
      required: true,
      options: [
        { id: "manual", label: "Manual audit" },
        { id: "daily-cron", label: "Daily cron" },
        { id: "weekly-cron", label: "Weekly cron" },
      ],
    },
    {
      id: "output-format",
      prompt: "How should issues and actions be reported?",
      required: true,
      options: [
        { id: "dench-tasks", label: "Dench tasks" },
        { id: "slack-digest", label: "Slack digest" },
        { id: "notion-table", label: "Notion table" },
        { id: "gmail-summary", label: "Gmail summary" },
      ],
      freeformHint: "Specify owners, severity levels, and whether to group by role or recruiter.",
    },
  ],
  skillInstructions: [
    "Audit only authorized candidate and hiring records available through Dench CRM and connected systems.",
    "Do not surface, infer, or act on protected-class or sensitive attributes; hygiene findings must be process-based and role-related.",
    "Flag missing or stale operational fields such as owner, stage, next step, last contact, feedback, scheduled interview, or duplicate record.",
    "Cite each issue with the relevant record, timestamp, Calendar event, Gmail thread, file, Slack thread, or Notion page when available.",
    "Prioritize issues by candidate impact, hiring urgency, process risk, and age of inactivity.",
    "For cron audits, report changes since the previous run and avoid repeatedly flagging acknowledged issues unless they become more urgent.",
  ],
});
