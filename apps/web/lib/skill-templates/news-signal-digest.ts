import { defineSkillTemplate, externalApps } from "./create-template";

export const newsSignalDigest = defineSkillTemplate({
  id: "news-signal-digest",
  title: "News Signal Digest",
  summary: "Turn noisy news into a short digest of actionable signals.",
  category: "Research Anything",
  outcome: "Watches topics, companies, people, and markets, then posts relevant developments with context and next actions.",
  userUseCase: "Use this when a founder, seller, investor, recruiter, or operator needs a manual or scheduled news digest that turns noisy public updates into cited account, market, customer, investor, or hiring signals.",
  personas: ["Founder", "Sales", "Investor/BD", "Knowledge Worker"],
  requiredApps: [externalApps.slack],
  triggerModes: ["scheduled", "manual"],
  autonomy: "Can automate",
  interviewQuestions: [
    {
      id: "digest-scope",
      prompt: "What should the news digest cover?",
      required: true,
      options: [
        { id: "accounts", label: "CRM accounts" },
        { id: "customers", label: "Customers" },
        { id: "industry", label: "Industry" },
        { id: "investors", label: "Investors" },
        { id: "hiring", label: "Hiring market" },
      ],
      freeformHint: "Name accounts, keywords, markets, saved CRM segments, or watchlists.",
    },
    {
      id: "signal-types",
      prompt: "Which news signals should be included?",
      required: true,
      allowMultiple: true,
      options: [
        { id: "funding", label: "Funding or M&A" },
        { id: "leadership", label: "Leadership changes" },
        { id: "product", label: "Product launches" },
        { id: "customer", label: "Customer wins/losses" },
        { id: "risk", label: "Risk or layoffs" },
        { id: "hiring", label: "Hiring growth" },
      ],
    },
    {
      id: "cadence",
      prompt: "When should the news digest run, and should it be manual or scheduled?",
      required: true,
      options: [
        { id: "manual", label: "Manual digest" },
        { id: "daily-cron", label: "Daily cron" },
        { id: "weekly-cron", label: "Weekly cron" },
      ],
    },
    {
      id: "source-quality",
      prompt: "How strict should source quality be?",
      required: true,
      options: [
        { id: "primary-only", label: "Primary only" },
        { id: "trusted-news", label: "Trusted news" },
        { id: "broad-scan", label: "Broad scan", description: "Include confidence labels" },
      ],
    },
    {
      id: "output-format",
      prompt: "Where should the digest go and how should it read?",
      required: true,
      options: [
        { id: "dench-note", label: "Dench note" },
        { id: "slack", label: "Slack post" },
        { id: "gmail", label: "Gmail draft" },
        { id: "notion", label: "Notion page" },
      ],
      freeformHint: "Specify audience, max length, ranking rules, and whether to include recommended actions.",
    },
  ],
  skillInstructions: [
    "Use web search, Dench CRM records, enrichment, and files to identify relevant news; use connected Slack, Gmail, Notion, Calendar, or LinkedIn only when helpful.",
    "Cite every news item with source name, title, URL or file reference, publication date, and retrieval date when available.",
    "Rank items by relevance to the chosen scope, recency, credibility, and potential business impact.",
    "Filter duplicate syndications, stale articles, SEO spam, and unsupported rumors unless rumor monitoring is explicitly requested.",
    "Separate factual news from inferred implications and label confidence for every recommendation.",
    "For scheduled digests, include only new or materially updated items since the prior run and say when no meaningful signal was found.",
  ],
});
