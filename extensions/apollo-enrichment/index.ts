import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  gatewayCompanySearch,
  gatewayEnrichmentJob,
  gatewayPeopleSearch,
  gatewayPersonContact,
  normalizePersonRecord,
} from "../shared/dench-gateway-client.js";
import {
  readDenchAuthProfileKey,
  resolveDenchGatewayUrl,
} from "../shared/dench-auth.js";

export const id = "apollo-enrichment";

const ENRICH_ACTIONS = ["people", "company", "people_search", "job_status"] as const;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

const DenchEnrichParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [...ENRICH_ACTIONS],
      description:
        'Action: "people" (person contact), "company" (domain lookup), "people_search" (filters), or "job_status" (poll queued person job).',
    },
    enrichmentId: {
      type: "string",
      description: "Enrichment job ID for job_status polling.",
    },
    email: { type: "string", description: "Legacy hint; person contact prefers linkedinUrl or name+company." },
    linkedinUrl: { type: "string", description: "LinkedIn URL for person contact enrichment." },
    firstName: { type: "string", description: "Person first name." },
    lastName: { type: "string", description: "Person last name." },
    domain: { type: "string", description: "Company domain such as acme.com." },
    organizationName: {
      type: "string",
      description: "Organization name hint for person contact.",
    },
    personTitles: {
      type: "array",
      items: { type: "string" },
      description: "Job titles for people search.",
    },
    personLocations: {
      type: "array",
      items: { type: "string" },
      description: "Locations for people search.",
    },
    organizationDomains: {
      type: "array",
      items: { type: "string" },
      description: "Organization domains for people search.",
    },
    page: { type: "number", description: "People search page number (1-based)." },
    perPage: { type: "number", description: "People search page size." },
    first_name: { type: "string", description: "Legacy alias for firstName." },
    last_name: { type: "string", description: "Legacy alias for lastName." },
    organization_name: { type: "string", description: "Legacy alias for organizationName." },
    linkedin_url: { type: "string", description: "Legacy alias for linkedinUrl." },
    person_titles: {
      type: "array",
      items: { type: "string" },
      description: "Legacy alias for personTitles.",
    },
    person_locations: {
      type: "array",
      items: { type: "string" },
      description: "Legacy alias for personLocations.",
    },
    organization_domains: {
      type: "array",
      items: { type: "string" },
      description: "Legacy alias for organizationDomains.",
    },
    per_page: { type: "number", description: "Legacy alias for perPage." },
    enrichFields: {
      type: "array",
      items: { type: "string" },
      description:
        'FullEnrich enrichFields for person contact: "work_emails", "phones", "personal_emails", or "all". Defaults to work_emails.',
    },
    requiredFields: {
      type: "array",
      items: { type: "string" },
      description:
        "Legacy Apollo requiredFields; mapped to enrichFields (email→work_emails, phone→phones). Prefer enrichFields.",
    },
    required_fields: {
      type: "array",
      items: { type: "string" },
      description: "Legacy alias for requiredFields.",
    },
  },
  required: ["action"],
};

async function executeDenchEnrich(
  gatewayUrl: string,
  apiKey: string,
  params: Record<string, unknown>,
) {
  const action = params.action;
  if (
    action !== "people" &&
    action !== "company" &&
    action !== "people_search" &&
    action !== "job_status"
  ) {
    return jsonResult({
      error: `Unknown action "${String(action)}". Use "people", "company", "people_search", or "job_status".`,
    });
  }

  try {
    if (action === "people") {
      const result = await gatewayPersonContact(gatewayUrl, apiKey, params);
      if (!result.ok) {
        return jsonResult({ error: result.error });
      }
      if (result.result.kind === "person") {
        return jsonResult({ person: result.result.person });
      }
      if (result.result.kind === "empty") {
        return jsonResult({ error: result.result.reason });
      }
      return jsonResult({
        enrichmentId: result.result.enrichmentId,
        status: result.result.status,
        pollPath: result.result.pollPath,
        message:
          "Person enrichment queued. Call action job_status with enrichmentId, or retry later.",
      });
    }

    if (action === "company") {
      const domain = readTrimmedString(params.domain);
      if (!domain) {
        return jsonResult({ error: "Company enrichment requires a domain." });
      }
      const result = await gatewayCompanySearch(gatewayUrl, apiKey, domain, 1);
      if (!result.ok) {
        return jsonResult({ error: result.error });
      }
      if (!result.company) {
        return jsonResult({ error: "No data returned" });
      }
      return jsonResult({ company: result.company, organization: result.company });
    }

    if (action === "people_search") {
      const result = await gatewayPeopleSearch(gatewayUrl, apiKey, params);
      if (!result.ok) {
        return jsonResult({ error: result.error });
      }
      return jsonResult({ people: result.people });
    }

    const enrichmentId = readTrimmedString(params.enrichmentId);
    if (!enrichmentId) {
      return jsonResult({ error: "job_status requires enrichmentId." });
    }
    const jobResult = await gatewayEnrichmentJob(gatewayUrl, apiKey, enrichmentId);
    if (!jobResult.ok) {
      return jsonResult({ error: jobResult.error });
    }
    const job = jobResult.job;
    if (job.status === "failed") {
      return jsonResult({
        enrichmentId,
        status: job.status,
        error: job.error?.message ?? "Enrichment job failed",
      });
    }
    if (job.status === "pending") {
      return jsonResult({
        enrichmentId,
        status: job.status,
        message: "Job still pending; retry job_status later.",
      });
    }
    const people = (job.people ?? []).map((p) =>
      normalizePersonRecord(p as Record<string, unknown>),
    );
    return jsonResult({
      enrichmentId,
      status: job.status,
      people,
      person: people[0],
    });
  } catch (err) {
    return jsonResult({
      error: "Enrichment request failed.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export default function register(api: OpenClawPluginApi) {
  const rootConfig = asRecord(api.config);
  const pluginEntries = asRecord(asRecord(rootConfig?.plugins)?.entries);
  const pluginConfig = asRecord(asRecord(pluginEntries?.[id])?.config);
  if (pluginConfig?.enabled === false) {
    return;
  }

  const gwPluginConfig = asRecord(asRecord(pluginEntries?.["dench-ai-gateway"])?.config);
  const gatewayUrl = resolveDenchGatewayUrl(gwPluginConfig as Record<string, unknown> | undefined);
  const apiKey = readDenchAuthProfileKey();

  if (!apiKey) {
    api.logger?.info?.(
      "[apollo-enrichment] No Dench Cloud API key found; tool will not be registered.",
    );
    return;
  }

  api.registerTool({
    name: "dench_enrich",
    label: "Dench Enrichment",
    description:
      "Look up people and companies through the Dench Cloud gateway (FullEnrich). " +
      'Use action "people" for person contact (linkedinUrl or name+company); returns cached person immediately or a queued enrichmentId. ' +
      'Use "company" for company lookup by domain. Use "people_search" for filtered people lists. ' +
      'Use "job_status" with enrichmentId to resolve queued person jobs. Prefer enrichFields over legacy requiredFields.',
    parameters: DenchEnrichParameters,
    execute: (_toolCallId: string, params: Record<string, unknown>) =>
      executeDenchEnrich(gatewayUrl, apiKey, params),
  } as AnyAgentTool);
}
