import { defineSkillTemplate, externalApps } from "./create-template";

export const crmContactEnricher = defineSkillTemplate({
  id: "crm-contact-enricher",
  title: "CRM Contact Enricher",
  summary: "Fill missing contact and company fields with attributed enrichment.",
  category: "Keep CRM Clean",
  outcome: "Finds incomplete records, enriches missing fields from native data and external CRM context, and writes confidence-scored updates.",
  userUseCase: "Use this when Dench CRM or HubSpot contacts are missing firmographic, role, company, source, owner, lifecycle, or relationship fields. The skill should run manually for a named list or on a schedule for incomplete records, enrich from Dench-native data first, and write only attributed, confidence-scored CRM updates.",
  personas: ["RevOps", "Sales"],
  requiredApps: [externalApps.hubspot],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Updates CRM",
  interviewQuestions: [
    {
      id: "record-scope",
      prompt: "Which CRM records should this enrich?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "all-incomplete-contacts", label: "All incomplete contacts" },
        { id: "owned-contacts", label: "Contacts I own" },
        { id: "recently-created", label: "Recently created" },
        { id: "target-accounts", label: "Target accounts" },
        { id: "named-list", label: "Named list" },
      ],
      freeformHint: "Name the Dench view, HubSpot list, owner, lifecycle stage, or saved segment.",
    },
    {
      id: "fields-to-enrich",
      prompt: "Which fields should be enriched or backfilled?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "person-fields", label: "Person fields", description: "title, seniority, location, profile URL, email confidence" },
        { id: "company-fields", label: "Company fields", description: "industry, size, website, HQ, funding, description" },
        { id: "routing-fields", label: "Routing fields", description: "owner, lifecycle, lead status, persona, territory" },
        { id: "relationship-context", label: "Relationship context", description: "last touch, source, warm intro, notes" },
      ],
    },
    {
      id: "confidence-policy",
      prompt: "What confidence threshold should be required before writing enriched fields?",
      required: true,
      options: [
        { id: "high-only", label: "High only", description: "Write only very high-confidence values" },
        { id: "medium-review", label: "Medium with review", description: "Write strong matches and queue uncertain values" },
        { id: "draft-only", label: "Draft only", description: "Never write automatically" },
      ],
    },
    {
      id: "overwrite-policy",
      prompt: "How should existing CRM values be handled?",
      required: true,
      options: [
        { id: "never-overwrite", label: "Never overwrite" },
        { id: "overwrite-stale-attributed", label: "Overwrite stale machine-sourced values" },
        { id: "ask-before-overwrite", label: "Ask before overwriting" },
      ],
    },
    {
      id: "run-cadence",
      prompt: "How should this enrichment skill run?",
      required: true,
      options: [
        { id: "manual-only", label: "Manual only" },
        { id: "daily-cron", label: "Daily scheduled scan" },
        { id: "weekly-cron", label: "Weekly cleanup" },
      ],
      freeformHint: "Include cron time, timezone, and where a completion summary should go.",
    },
  ],
  skillInstructions: [
    "Support only manual runs and cron/scheduled agent messages; do not assume contact-created webhooks or real-time CRM callbacks.",
    "Use Dench CRM as the system of record, with Dench-native enrichment first and HubSpot, Gmail, or Calendar context only when connected and relevant.",
    "For every proposed or written CRM value, store source attribution, observed date, confidence score, and a short evidence note.",
    "Never overwrite user-authored CRM fields unless the configured overwrite policy explicitly allows it; otherwise create a review queue of conflicts.",
    "Write enriched values only when they meet the configured confidence threshold; below-threshold findings should remain suggestions.",
    "Make scheduled runs idempotent by skipping records enriched successfully within the configured lookback window.",
    "End each run with records scanned, fields updated, conflicts skipped, low-confidence suggestions, and any HubSpot sync issues.",
  ],
});
