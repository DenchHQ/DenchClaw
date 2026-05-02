export const SKILL_TEMPLATE_IDS = [
  "target-account-list-builder",
  "icp-outreach-builder",
  "lookalike-customer-finder",
  "funding-signal-prospector",
  "hiring-signal-prospector",
  "website-visitor-follow-up",
  "conference-lead-researcher",
  "linkedin-style-outreach",
  "stale-thread-follow-up-agent",
  "warm-lead-nurture",
  "proposal-chaser",
  "no-show-recovery",
  "crm-contact-enricher",
  "duplicate-record-cleaner",
  "relationship-strength-scorer",
  "pipeline-hygiene-digest",
  "meeting-prep-brief",
  "executive-daily-brief",
  "investor-meeting-prep",
  "post-meeting-follow-through",
  "company-deep-researcher",
  "competitor-monitor",
  "news-signal-digest",
  "customer-voice-miner",
  "market-map-builder",
  "candidate-research-brief",
  "interview-follow-up-agent",
  "talent-pipeline-hygiene",
  "hiring-manager-weekly-digest",
  "recruiting-outreach-builder",
  "lost-customer-winback",
  "account-health-monitor",
  "renewal-risk-digest",
  "weekly-founder-digest",
  "fundraising-target-builder",
  "board-meeting-prep",
  "partner-pipeline-builder",
  "investor-update-builder",
] as const;

export type SkillTemplateId = (typeof SKILL_TEMPLATE_IDS)[number];

export const SKILL_TEMPLATE_CATEGORIES = [
  "Find Leads",
  "Follow Up",
  "Keep CRM Clean",
  "Prep Meetings",
  "Research Anything",
  "Hire People",
  "Grow Customers",
  "Run Founder Ops",
] as const;

export type SkillTemplateCategory =
  (typeof SKILL_TEMPLATE_CATEGORIES)[number];

export type SkillTemplateTriggerMode = "manual" | "scheduled";

export type SkillTemplateAutonomy =
  | "Creates drafts"
  | "Updates CRM"
  | "Can automate";

export const SKILL_TEMPLATE_PERSONAS = [
  "Founder",
  "Sales",
  "RevOps",
  "Recruiter",
  "Customer Success",
  "Investor/BD",
  "Operator",
  "Knowledge Worker",
] as const;

export type SkillTemplatePersona =
  (typeof SKILL_TEMPLATE_PERSONAS)[number];

export type SkillTemplateApp = {
  slug: string;
  name: string;
};

export type SkillTemplateQuestionOption = {
  id: string;
  label: string;
  description?: string;
};

export type SkillTemplateInterviewQuestion = {
  id: string;
  prompt: string;
  required: boolean;
  allowMultiple?: boolean;
  options?: readonly SkillTemplateQuestionOption[];
  freeformHint?: string;
};

export type SkillTemplate = {
  id: SkillTemplateId;
  title: string;
  summary: string;
  category: SkillTemplateCategory;
  outcome: string;
  userUseCase: string;
  personas: readonly SkillTemplatePersona[];
  requiredApps: readonly SkillTemplateApp[];
  triggerModes: readonly SkillTemplateTriggerMode[];
  autonomy: SkillTemplateAutonomy;
  interviewQuestions: readonly SkillTemplateInterviewQuestion[];
  skillInstructions: readonly string[];
  buildPrompt: () => string;
};

export type SkillTemplateDefinition = Omit<SkillTemplate, "buildPrompt">;
