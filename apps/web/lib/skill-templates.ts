import { targetAccountListBuilder } from "./skill-templates/target-account-list-builder";
import { icpOutreachBuilder } from "./skill-templates/icp-outreach-builder";
import { lookalikeCustomerFinder } from "./skill-templates/lookalike-customer-finder";
import { fundingSignalProspector } from "./skill-templates/funding-signal-prospector";
import { hiringSignalProspector } from "./skill-templates/hiring-signal-prospector";
import { websiteVisitorFollowUp } from "./skill-templates/website-visitor-follow-up";
import { conferenceLeadResearcher } from "./skill-templates/conference-lead-researcher";
import { linkedinStyleOutreach } from "./skill-templates/linkedin-style-outreach";
import { staleThreadFollowUpAgent } from "./skill-templates/stale-thread-follow-up-agent";
import { warmLeadNurture } from "./skill-templates/warm-lead-nurture";
import { proposalChaser } from "./skill-templates/proposal-chaser";
import { noShowRecovery } from "./skill-templates/no-show-recovery";
import { crmContactEnricher } from "./skill-templates/crm-contact-enricher";
import { duplicateRecordCleaner } from "./skill-templates/duplicate-record-cleaner";
import { relationshipStrengthScorer } from "./skill-templates/relationship-strength-scorer";
import { pipelineHygieneDigest } from "./skill-templates/pipeline-hygiene-digest";
import { meetingPrepBrief } from "./skill-templates/meeting-prep-brief";
import { executiveDailyBrief } from "./skill-templates/executive-daily-brief";
import { investorMeetingPrep } from "./skill-templates/investor-meeting-prep";
import { postMeetingFollowThrough } from "./skill-templates/post-meeting-follow-through";
import { companyDeepResearcher } from "./skill-templates/company-deep-researcher";
import { competitorMonitor } from "./skill-templates/competitor-monitor";
import { newsSignalDigest } from "./skill-templates/news-signal-digest";
import { customerVoiceMiner } from "./skill-templates/customer-voice-miner";
import { marketMapBuilder } from "./skill-templates/market-map-builder";
import { candidateResearchBrief } from "./skill-templates/candidate-research-brief";
import { interviewFollowUpAgent } from "./skill-templates/interview-follow-up-agent";
import { talentPipelineHygiene } from "./skill-templates/talent-pipeline-hygiene";
import { hiringManagerWeeklyDigest } from "./skill-templates/hiring-manager-weekly-digest";
import { recruitingOutreachBuilder } from "./skill-templates/recruiting-outreach-builder";
import { lostCustomerWinback } from "./skill-templates/lost-customer-winback";
import { accountHealthMonitor } from "./skill-templates/account-health-monitor";
import { renewalRiskDigest } from "./skill-templates/renewal-risk-digest";
import { weeklyFounderDigest } from "./skill-templates/weekly-founder-digest";
import { fundraisingTargetBuilder } from "./skill-templates/fundraising-target-builder";
import { boardMeetingPrep } from "./skill-templates/board-meeting-prep";
import { partnerPipelineBuilder } from "./skill-templates/partner-pipeline-builder";
import { investorUpdateBuilder } from "./skill-templates/investor-update-builder";
import { buildSkillTemplatePromptText } from "./skill-templates/prompt";
import {
  SKILL_TEMPLATE_IDS,
  type SkillTemplate,
  type SkillTemplateDefinition,
  type SkillTemplateId,
} from "./skill-templates/types";

export {
  SKILL_TEMPLATE_CATEGORIES,
  SKILL_TEMPLATE_IDS,
  SKILL_TEMPLATE_PERSONAS,
  type SkillTemplate,
  type SkillTemplateApp,
  type SkillTemplateAutonomy,
  type SkillTemplateCategory,
  type SkillTemplateId,
  type SkillTemplateInterviewQuestion,
  type SkillTemplatePersona,
  type SkillTemplateQuestionOption,
  type SkillTemplateTriggerMode,
} from "./skill-templates/types";

const TEMPLATE_DEFINITIONS: readonly SkillTemplateDefinition[] = [
  targetAccountListBuilder,
  icpOutreachBuilder,
  lookalikeCustomerFinder,
  fundingSignalProspector,
  hiringSignalProspector,
  websiteVisitorFollowUp,
  conferenceLeadResearcher,
  linkedinStyleOutreach,
  staleThreadFollowUpAgent,
  warmLeadNurture,
  proposalChaser,
  noShowRecovery,
  crmContactEnricher,
  duplicateRecordCleaner,
  relationshipStrengthScorer,
  pipelineHygieneDigest,
  meetingPrepBrief,
  executiveDailyBrief,
  investorMeetingPrep,
  postMeetingFollowThrough,
  companyDeepResearcher,
  competitorMonitor,
  newsSignalDigest,
  customerVoiceMiner,
  marketMapBuilder,
  candidateResearchBrief,
  interviewFollowUpAgent,
  talentPipelineHygiene,
  hiringManagerWeeklyDigest,
  recruitingOutreachBuilder,
  lostCustomerWinback,
  accountHealthMonitor,
  renewalRiskDigest,
  weeklyFounderDigest,
  fundraisingTargetBuilder,
  boardMeetingPrep,
  partnerPipelineBuilder,
  investorUpdateBuilder,
];

export const SKILL_TEMPLATES: readonly SkillTemplate[] = TEMPLATE_DEFINITIONS.map(
  (template) => ({
    ...template,
    buildPrompt: () => buildSkillTemplatePromptText(template),
  }),
);

export function isSkillTemplateId(value: unknown): value is SkillTemplateId {
  return (
    typeof value === "string" &&
    (SKILL_TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

export function getSkillTemplate(id: SkillTemplateId): SkillTemplate {
  const template = SKILL_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) {
    throw new Error(`Unknown skill template: ${id}`);
  }
  return template;
}

export function buildSkillTemplatePrompt(id: SkillTemplateId): string {
  return getSkillTemplate(id).buildPrompt();
}
