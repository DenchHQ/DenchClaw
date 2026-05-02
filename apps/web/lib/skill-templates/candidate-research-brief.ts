import { defineSkillTemplate, externalApps } from "./create-template";

export const candidateResearchBrief = defineSkillTemplate({
  id: "candidate-research-brief",
  title: "Candidate Research Brief",
  summary: "Research candidates before outreach, interviews, or hiring debriefs.",
  category: "Hire People",
  outcome: "Creates candidate briefs with background, evidence, fit hypotheses, risks, and interview questions.",
  userUseCase:
    "Use this when a recruiter or founder needs a fair, cited candidate brief for outreach, interview prep, or debriefs. The skill should evaluate role-relevant evidence from candidate records, resumes, portfolios, public professional sources, and connected apps while avoiding protected-class and privacy-sensitive analysis.",
  personas: ["Recruiter", "Founder"],
  requiredApps: [externalApps.linkedin, externalApps.github],
  triggerModes: ["manual"],
  autonomy: "Creates drafts",
  interviewQuestions: [
    {
      id: "candidate",
      prompt: "Which candidate should be researched?",
      required: true,
      freeformHint:
        "Provide candidate name, CRM record, LinkedIn URL, resume, portfolio, GitHub profile, or uploaded files.",
    },
    {
      id: "role",
      prompt: "What role, level, and hiring criteria should the brief evaluate against?",
      required: true,
      freeformHint:
        "Paste the job description, scorecard, must-haves, nice-to-haves, and interview stage.",
    },
    {
      id: "allowed-sources",
      prompt: "Which candidate sources may be used?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "crm", label: "Candidate record" },
        { id: "files", label: "Resume/files" },
        { id: "web", label: "Public web" },
        { id: "linkedin", label: "LinkedIn" },
        { id: "github", label: "GitHub/portfolio" },
      ],
    },
    {
      id: "brief-purpose",
      prompt: "What should the brief be used for?",
      required: true,
      options: [
        { id: "outreach", label: "Outreach" },
        { id: "interview-prep", label: "Interview prep" },
        { id: "debrief", label: "Debrief" },
        { id: "sourcing-fit", label: "Sourcing fit" },
      ],
    },
    {
      id: "output-format",
      prompt: "What output format should the candidate brief use?",
      required: true,
      options: [
        { id: "manual-brief", label: "Manual brief" },
        { id: "scorecard-prep", label: "Scorecard prep" },
        { id: "email-draft", label: "Outreach draft" },
        { id: "notion-note", label: "Notion note" },
      ],
      freeformHint: "Include destination, audience, and whether outreach hooks should be included.",
    },
  ],
  skillInstructions: [
    "Use only job-relevant, candidate-provided, public, or authorized internal information from Dench CRM, enrichment, files, and connected apps.",
    "Do not infer, mention, score, or use protected-class or sensitive attributes such as age, race, religion, health, family status, gender identity, national origin, disability, veteran status, or photos.",
    "Cite role-relevant claims with source references such as resume lines, portfolio pages, public work, CRM notes, or interview feedback.",
    "Separate evidence from hypotheses and phrase fit as role-related observations or questions to validate.",
    "Prefer primary candidate materials, work samples, public professional profiles, and authorized internal notes over low-quality web results.",
    "Format the output as Candidate Snapshot, Role-Relevant Evidence, Fit Hypotheses, Risks/Unknowns, Suggested Interview Questions, Outreach Hooks if requested, and Sources.",
  ],
});
