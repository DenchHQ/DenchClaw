import type {
  SkillTemplateApp,
  SkillTemplateDefinition,
} from "./types";

export const externalApps = {
  gmail: { slug: "gmail", name: "Gmail" },
  googleCalendar: { slug: "google-calendar", name: "Google Calendar" },
  hubspot: { slug: "hubspot", name: "HubSpot" },
  notion: { slug: "notion", name: "Notion" },
  slack: { slug: "slack", name: "Slack" },
  github: { slug: "github", name: "GitHub" },
  linkedin: { slug: "linkedin", name: "LinkedIn" },
} satisfies Record<string, SkillTemplateApp>;

export function defineSkillTemplate(
  template: SkillTemplateDefinition,
): SkillTemplateDefinition {
  return template;
}
