import { defineSkillTemplate, externalApps } from "./create-template";

export const recruitingOutreachBuilder = defineSkillTemplate({
  id: "recruiting-outreach-builder",
  title: "Recruiting Outreach Builder",
  summary: "Create personalized candidate outreach with role-specific proof and guardrails.",
  category: "Hire People",
  outcome: "Researches candidates, drafts or sends role-specific messages, handles follow-ups, and logs candidate status.",
  userUseCase: "Use Dench CRM, enrichment, web search, files, and optional LinkedIn/Gmail context to draft role-relevant recruiting outreach that feels researched without crossing privacy lines.",
  personas: ["Recruiter", "Founder"],
  requiredApps: [externalApps.gmail, externalApps.linkedin],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "candidate-or-segment",
      prompt: "Who should the outreach target?",
      required: true,
      freeformHint: "Provide candidate names, records, LinkedIn URLs, a saved segment, or search criteria.",
    },
    {
      id: "role-context",
      prompt: "What role and value proposition should the message communicate?",
      required: true,
      freeformHint: "Paste role description, team context, must-haves, company pitch, approved compensation notes, and CTA.",
    },
    {
      id: "personalization-sources",
      prompt: "Which sources may be used for personalization?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "crm", label: "CRM records" },
        { id: "enrichment", label: "Enrichment" },
        { id: "files", label: "Resume or files" },
        { id: "web", label: "Professional web" },
        { id: "linkedin", label: "LinkedIn" },
        { id: "gmail", label: "Prior Gmail" },
      ],
    },
    {
      id: "channel-style",
      prompt: "Which channel and style should be drafted?",
      required: true,
      options: [
        { id: "email", label: "Email draft" },
        { id: "linkedin", label: "LinkedIn-style message" },
        { id: "sequence", label: "Sequence" },
        { id: "referral", label: "Referral ask" },
      ],
      freeformHint: "Specify tone, length, sender, CTA, and number of variants.",
    },
    {
      id: "send-policy",
      prompt: "Should the skill only draft, or may scheduled runs send to approved candidates?",
      required: true,
      options: [
        { id: "draft-only", label: "Draft only" },
        { id: "review-required", label: "Review required" },
        { id: "approved-segment-send", label: "Approved segment send" },
      ],
      freeformHint: "Include daily caps, quiet hours, exclusions, and follow-up spacing.",
    },
  ],
  skillInstructions: [
    "Use only job-relevant, professional, public, candidate-provided, or authorized internal sources for personalization.",
    "Do not personalize using protected-class or sensitive attributes, photos, family details, private social media, or demographic clues.",
    "Draft concise outreach around concrete work evidence, role fit, team mission, and a clear CTA rather than generic flattery.",
    "Cite personalization inputs in internal notes, but keep candidate-facing copy natural and non-creepy.",
    "Send only under explicit approved-segment rules with caps, quiet hours, duplicate checks, and do-not-contact exclusions; otherwise create drafts.",
    "For scheduled runs, generate outreach only for approved candidate records and skip anyone contacted recently or missing enough evidence.",
    "Log draft/send status, evidence sources, next follow-up date, and stop conditions back to candidate records.",
  ],
});
