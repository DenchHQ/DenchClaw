import { defineSkillTemplate, externalApps } from "./create-template";

export const duplicateRecordCleaner = defineSkillTemplate({
  id: "duplicate-record-cleaner",
  title: "Duplicate Record Cleaner",
  summary: "Find likely duplicate people or companies and prepare safe merge guidance.",
  category: "Keep CRM Clean",
  outcome: "Detects duplicate records, ranks merge confidence, proposes canonical records, and queues safe cleanup actions.",
  userUseCase:
    "Use this when Dench CRM or HubSpot contains duplicate people, companies, or deals that break attribution, ownership, and reporting. The skill should identify duplicate clusters, recommend canonical records, preserve history, and only merge or update when confidence and overwrite rules are explicit.",
  personas: ["RevOps", "Sales"],
  requiredApps: [externalApps.hubspot],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Updates CRM",
  interviewQuestions: [
    {
      id: "duplicate-scope",
      prompt: "Which record types should be checked for duplicates?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "contacts", label: "Contacts" },
        { id: "companies", label: "Companies" },
        { id: "deals", label: "Deals" },
        { id: "all-crm-records", label: "All CRM records" },
      ],
    },
    {
      id: "matching-signals",
      prompt: "Which signals should count toward a duplicate match?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "exact-email-domain", label: "Exact email/domain" },
        { id: "name-company", label: "Name + company" },
        { id: "hubspot-ids", label: "HubSpot IDs" },
        { id: "gmail-calendar-history", label: "Activity history" },
        { id: "dench-enrichment", label: "Dench enrichment" },
      ],
    },
    {
      id: "canonical-policy",
      prompt: "How should the canonical record be chosen?",
      required: true,
      options: [
        { id: "most-complete", label: "Most complete" },
        { id: "oldest-attributed", label: "Oldest attributed" },
        { id: "active-owner", label: "Active owner/deal" },
        { id: "hubspot-primary", label: "HubSpot primary" },
      ],
    },
    {
      id: "merge-threshold",
      prompt: "What confidence is required before cleanup can happen?",
      required: true,
      options: [
        { id: "review-all", label: "Review all" },
        { id: "merge-95", label: "Auto-merge 95%+" },
        { id: "merge-90-simple", label: "Auto-merge simple 90%+" },
      ],
    },
    {
      id: "audit-destination",
      prompt: "Where should duplicate reports and audit logs go?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "dench-crm-note", label: "Dench CRM note" },
        { id: "hubspot-note", label: "HubSpot note" },
        { id: "notion-table", label: "Notion table" },
        { id: "digest-only", label: "Digest only" },
      ],
    },
  ],
  skillInstructions: [
    "Support only manual duplicate checks and cron/scheduled duplicate hygiene runs.",
    "Compare Dench CRM records with HubSpot records when connected, keeping Dench attribution and external IDs intact.",
    "Score each duplicate cluster with match reasons, conflicting fields, canonical recommendation, and merge confidence.",
    "Do not merge or overwrite records below the configured confidence threshold; route them to review with evidence.",
    "Preserve field provenance by carrying source attribution, original record IDs, timestamps, owners, and activity history into the canonical record or audit note.",
    "Never overwrite user-authored fields during automatic cleanup unless the canonical and overwrite policies explicitly permit it.",
    "Produce an audit summary with clusters reviewed, safe merges completed, conflicts blocked, and records requiring manual review.",
  ],
});
