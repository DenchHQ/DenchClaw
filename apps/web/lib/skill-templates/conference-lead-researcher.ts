import { defineSkillTemplate, externalApps } from "./create-template";

export const conferenceLeadResearcher = defineSkillTemplate({
  id: "conference-lead-researcher",
  title: "Conference Lead Researcher",
  summary: "Research attendees, speakers, or sponsors before an event and build a hit list.",
  category: "Find Leads",
  outcome: "Turns an event or attendee list into a prioritized meeting and outreach plan with CRM-ready context.",
  userUseCase:
    "Use this before or after an event when a founder, seller, or BD owner has a conference page, attendee file, sponsor list, or speaker lineup and wants a prioritized lead plan. The skill should connect event participation to CRM context, warm paths, and concrete meeting or follow-up actions.",
  personas: ["Founder", "Sales", "Investor/BD"],
  requiredApps: [externalApps.gmail, externalApps.googleCalendar],
  triggerModes: ["manual"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "conference-source",
      prompt: "Which event should be researched, and what source should I use?",
      required: true,
      freeformHint:
        "Share the event name, website, sponsor page, attendee list, exhibitor list, speaker page, or uploaded file.",
    },
    {
      id: "participant-types",
      prompt: "Which participant types should become leads?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "sponsors", label: "Sponsors" },
        { id: "exhibitors", label: "Exhibitors" },
        { id: "speakers", label: "Speakers" },
        { id: "attendees", label: "Attendees" },
        { id: "partners", label: "Partners" },
      ],
    },
    {
      id: "lead-fit",
      prompt: "What makes an event participant worth prioritizing?",
      required: true,
      freeformHint:
        "Describe target persona, company profile, buying trigger, partnership fit, or investor relevance.",
    },
    {
      id: "event-goal",
      prompt: "What should the skill optimize the event list for?",
      required: true,
      options: [
        { id: "book-before-event", label: "Book meetings before" },
        { id: "prioritize-booth-visits", label: "Prioritize booth visits" },
        { id: "post-event-follow-up", label: "Post-event follow-up" },
        { id: "partnership-targets", label: "Partnership targets" },
      ],
    },
    {
      id: "crm-context-policy",
      prompt: "How should existing CRM relationships affect prioritization?",
      required: false,
      options: [
        { id: "prioritize-warm", label: "Prioritize warm accounts" },
        { id: "exclude-customers", label: "Exclude customers" },
        { id: "include-opportunities", label: "Include opportunities" },
        { id: "net-new-only", label: "Net-new only" },
      ],
    },
  ],
  skillInstructions: [
    "Collect participant companies and people from event pages, uploaded lists, files, CRM context, and web search.",
    "Classify each lead by participant role, event relevance, account fit, and likely reason for attending.",
    "Enrich companies and people with domains, titles, headquarters, company size, CRM status, and recent public signals.",
    "Prioritize leads according to the event goal, separating pre-event, on-site, and post-event actions when useful.",
    "Highlight warm paths such as existing contacts, CRM notes, shared accounts, prior interactions, or scheduled meetings.",
    "Return a conference-ready lead list with meeting rationale, conversation starters, recommended outreach timing, and source evidence.",
  ],
});
