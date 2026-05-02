import { defineSkillTemplate, externalApps } from "./create-template";

export const warmLeadNurture = defineSkillTemplate({
  id: "warm-lead-nurture",
  title: "Warm Lead Nurture",
  summary: "Keep promising but not-ready leads warm with useful, low-pressure touches.",
  category: "Follow Up",
  outcome: "Segments warm leads, chooses relevant touchpoints, drafts or sends helpful check-ins, and logs future timing.",
  userUseCase:
    "Use this when leads are interested but not ready to buy, meet, invest, partner, or hire yet, and you want DenchClaw to keep them warm with useful, low-pressure touches. The skill should segment leads, find timely reasons to reach out, and maintain nurture state from manual runs or scheduled checks without relying on webhooks.",
  personas: ["Founder", "Sales"],
  requiredApps: [externalApps.gmail, externalApps.hubspot],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "warm-lead-source",
      prompt: "Which warm leads should this nurture?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "crm-stage", label: "CRM stage" },
        { id: "hubspot-list", label: "HubSpot list" },
        { id: "uploaded-list", label: "Uploaded list" },
        { id: "manual-selection", label: "Manual selection" },
        { id: "saved-search", label: "Saved search" },
      ],
      freeformHint: "Name the list, stages, tags, owners, file, or saved segment.",
    },
    {
      id: "nurture-reason",
      prompt: "Why are these leads warm but not ready?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "bad-timing", label: "Bad timing" },
        { id: "budget-later", label: "Budget later" },
        { id: "needs-education", label: "Needs education" },
        { id: "not-priority", label: "Not priority yet" },
        { id: "relationship-building", label: "Relationship building" },
      ],
    },
    {
      id: "touchpoint-types",
      prompt: "What kinds of nurture touches should DenchClaw use?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "helpful-resource", label: "Helpful resource" },
        { id: "company-trigger", label: "Company trigger" },
        { id: "product-update", label: "Product update" },
        { id: "event-invite", label: "Event invite" },
        { id: "simple-check-in", label: "Simple check-in" },
      ],
    },
    {
      id: "cadence",
      prompt: "How often should each lead be touched?",
      required: true,
      options: [
        { id: "monthly", label: "Monthly" },
        { id: "quarterly", label: "Quarterly" },
        { id: "signal-based", label: "Signal-based" },
        { id: "custom", label: "Custom" },
      ],
      freeformHint: "Include quiet periods, max total touches, cooldowns, and when to pause.",
    },
    {
      id: "conversion-stop-rules",
      prompt: "What signals should convert, pause, or stop nurture?",
      required: true,
      freeformHint:
        "Include replies, booked meetings, CRM stage changes, negative intent, unsubscribes, quiet hours, send caps, and owner overrides.",
    },
  ],
  skillInstructions: [
    "Build the nurture queue from Dench CRM, enriched company/contact data, uploaded files, or connected HubSpot lists, then segment leads by persona, account fit, reason for delay, and last meaningful interaction.",
    "Use web search and enrichment to find timely but non-invasive context, such as company news, hiring, funding, product launches, role changes, or relevant content hooks.",
    "Select the lowest-pressure useful touch for each lead, prioritizing relevance over frequency and avoiding generic check-ins when a better trigger exists.",
    "Draft or send through the approved channel only under explicit send rules, including channel preference, daily caps, quiet hours, exclusions, and duplicate prevention.",
    "For scheduled nurture, maintain per-lead state so cron runs do not restart the sequence, repeat the same asset, or contact leads inside their cooldown window.",
    "Detect replies by checking connected inbox or CRM activity during each run; treat substantive replies, booked meetings, stage advancement, opt-outs, and owner pauses as stop or handoff conditions.",
    "Log each touch, rationale, source links, next eligible date, and confidence notes back to CRM without overwriting user-authored fields unless explicitly allowed.",
  ],
});
