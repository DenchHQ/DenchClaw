import { defineSkillTemplate, externalApps } from "./create-template";

export const competitorMonitor = defineSkillTemplate({
  id: "competitor-monitor",
  title: "Competitor Monitor",
  summary: "Monitor competitor launches, pricing changes, messaging, and market moves.",
  category: "Research Anything",
  outcome: "Tracks named competitors, summarizes meaningful changes, and posts implications with suggested responses.",
  userUseCase:
    "Use this when a founder, GTM team, CS lead, or operator needs a repeatable monitor for named competitors, adjacent categories, or strategic threats. The skill should watch for product, pricing, customer, hiring, funding, and messaging changes, then separate verified facts from implications so the team can decide whether to respond.",
  personas: ["Founder", "Sales", "Customer Success"],
  requiredApps: [externalApps.slack],
  triggerModes: ["scheduled", "manual"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "competitors",
      prompt: "Which competitors, categories, or strategic threats should be monitored?",
      required: true,
      freeformHint: "List company names, websites, CRM accounts, or category keywords.",
    },
    {
      id: "signals",
      prompt: "Which competitor signals matter most?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "product", label: "Product launches" },
        { id: "pricing", label: "Pricing changes" },
        { id: "customers", label: "Customer wins" },
        { id: "funding", label: "Funding or M&A" },
        { id: "hiring", label: "Hiring patterns" },
        { id: "messaging", label: "Messaging shifts" },
      ],
    },
    {
      id: "source-scope",
      prompt: "Which sources should the monitor check?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "web", label: "Web and news" },
        { id: "company-sites", label: "Company sites" },
        { id: "crm", label: "Dench CRM" },
        { id: "files", label: "Battlecards/files" },
        { id: "slack-notion", label: "Slack/Notion" },
      ],
    },
    {
      id: "cadence",
      prompt: "How should competitor monitoring run?",
      required: true,
      options: [
        { id: "manual", label: "Manual research" },
        { id: "daily-cron", label: "Daily digest" },
        { id: "weekly-cron", label: "Weekly digest" },
      ],
    },
    {
      id: "output",
      prompt: "Where should the monitor publish results and what action guidance should it include?",
      required: true,
      options: [
        { id: "dench-note", label: "Dench note" },
        { id: "slack-digest", label: "Slack digest" },
        { id: "notion", label: "Notion page" },
        { id: "gmail-draft", label: "Gmail draft" },
      ],
      freeformHint: "Include audience, max length, and whether to include sales/CS response recommendations.",
    },
  ],
  skillInstructions: [
    "Monitor only the requested competitors, categories, and signal types unless the user explicitly expands scope.",
    "Use primary sources, company sites, reputable news, CRM context, and supplied files before lower-quality commentary.",
    "Cite each signal with source title, URL or file reference, publisher, and observed date.",
    "Deduplicate repeated coverage of the same event and suppress unchanged signals in scheduled digests.",
    "Separate verified changes from interpretation, and label confidence for each implication or recommended response.",
    "Format output with top changes, why they matter, recommended response, watchlist, and sources.",
    "For scheduled runs, publish only net-new or materially changed findings since the prior run.",
  ],
});
