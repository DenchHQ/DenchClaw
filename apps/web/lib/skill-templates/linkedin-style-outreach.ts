import { defineSkillTemplate, externalApps } from "./create-template";

export const linkedinStyleOutreach = defineSkillTemplate({
  id: "linkedin-style-outreach",
  title: "LinkedIn-style Outreach",
  summary: "Create concise social-style outreach and follow-ups with strict automation rules.",
  category: "Follow Up",
  outcome: "Researches prospects, writes short LinkedIn-style messages, manages follow-up sequencing, and logs outreach state.",
  userUseCase: "Use this when a founder, seller, recruiter, or BD owner has people or accounts to contact and wants concise LinkedIn-style outreach that feels researched without being creepy. The skill should turn CRM lists, uploaded files, saved searches, or manual names into short messages, follow-up plans, and logged outreach state.",
  personas: ["Founder", "Sales", "Recruiter"],
  requiredApps: [externalApps.linkedin],
  triggerModes: ["manual", "scheduled"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "audience-source",
      prompt: "Where should the outreach audience come from?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "crm-list", label: "CRM list" },
        { id: "uploaded-file", label: "Uploaded file" },
        { id: "manual-names", label: "Manual names" },
        { id: "search-criteria", label: "Search criteria" },
      ],
      freeformHint: "Include list names, filters, file names, or exact prospect criteria.",
    },
    {
      id: "outreach-goal",
      prompt: "What should the message try to accomplish?",
      required: true,
      options: [
        { id: "book-meeting", label: "Book a meeting" },
        { id: "start-conversation", label: "Start a conversation" },
        { id: "recruit-candidate", label: "Recruit candidate" },
        { id: "partner-intro", label: "Partner intro" },
        { id: "investor-bd", label: "Investor or BD" },
      ],
    },
    {
      id: "message-style",
      prompt: "What style should the outreach use?",
      required: true,
      options: [
        { id: "very-short", label: "Very short" },
        { id: "warm-specific", label: "Warm and specific" },
        { id: "direct-business", label: "Direct business" },
        { id: "curious-peer", label: "Curious peer" },
      ],
      freeformHint: "Mention phrases to use or avoid.",
    },
    {
      id: "send-policy",
      prompt: "Should DenchClaw draft messages only, or send when rules are met?",
      required: true,
      options: [
        { id: "draft-only", label: "Draft only" },
        { id: "send-after-review", label: "Send after review" },
        { id: "auto-send-allowlist", label: "Auto-send allowlist" },
      ],
      freeformHint: "If auto-sending is allowed, specify allowed lists, daily caps, quiet hours, and exclusions.",
    },
    {
      id: "follow-up-guardrails",
      prompt: "What follow-up limits and stop conditions should apply?",
      required: true,
      freeformHint: "Include max follow-ups, spacing, reply or connection-accepted detection, CRM stage changes, and do-not-contact rules.",
    },
  ],
  skillInstructions: [
    "Accept prospects from Dench CRM records, enrichment results, uploaded files, pasted names, or manual search criteria; use LinkedIn only when connected and useful for profile context.",
    "For each prospect, research lightweight public and CRM context that supports a specific opening line: role, company, recent change, mutual context, hiring/funding/news signal, or stated interest.",
    "Write concise LinkedIn-style messages with one clear CTA, no fabricated familiarity, no over-personalized claims, and no sensitive personal data unless the user explicitly provided it.",
    "Respect the selected send policy: draft by default; send only when the prospect matches explicit allowlists, daily caps, duplicate checks, quiet hours, and channel constraints.",
    "For scheduled runs, use idempotency checks against CRM notes, prior Dench runs, and connected app history so the same prospect is not messaged twice for the same campaign.",
    "Stop outreach when a reply, accepted connection plus response, meeting booked, disqualifying CRM stage, do-not-contact flag, blocked signal, or owner override is detected.",
  ],
});
