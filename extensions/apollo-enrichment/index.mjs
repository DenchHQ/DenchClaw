// extensions/shared/dench-gateway-client.ts
var ENRICHMENT_BASE_PATH = "/v1/enrichment";
function readTrimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}
function readStringList(value) {
  if (!Array.isArray(value)) return void 0;
  const items = value.map((item) => readTrimmedString(item)).filter((item) => Boolean(item));
  return items.length > 0 ? items : void 0;
}
function mapRequiredFieldsToEnrichFields(requiredFields) {
  if (!requiredFields || requiredFields.length === 0) return void 0;
  const tokens = /* @__PURE__ */ new Set();
  for (const field of requiredFields) {
    const normalized = field.trim().toLowerCase();
    if (normalized === "email" || normalized === "work_emails" || normalized === "workemail") {
      tokens.add("work_emails");
    } else if (normalized === "phone" || normalized === "phones") {
      tokens.add("phones");
    } else if (normalized === "personal_emails" || normalized === "personalemails") {
      tokens.add("personal_emails");
    } else if (normalized === "all") {
      return ["all"];
    }
  }
  if (tokens.size === 0) return void 0;
  return [...tokens];
}
function mapEnrichFieldsParam(enrichFields, requiredFields) {
  const explicit = readStringList(enrichFields);
  if (explicit) return explicit;
  return mapRequiredFieldsToEnrichFields(readStringList(requiredFields));
}
function buildPersonContactBody(params) {
  const linkedinUrl = readTrimmedString(params.linkedinUrl) ?? readTrimmedString(params.linkedin_url);
  const firstName = readTrimmedString(params.firstName) ?? readTrimmedString(params.first_name);
  const lastName = readTrimmedString(params.lastName) ?? readTrimmedString(params.last_name);
  const domain = readTrimmedString(params.domain);
  const companyName = readTrimmedString(params.organizationName) ?? readTrimmedString(params.organization_name);
  const contact = {};
  if (linkedinUrl) contact.linkedinUrl = linkedinUrl;
  if (firstName) contact.firstName = firstName;
  if (lastName) contact.lastName = lastName;
  if (domain) contact.domain = domain;
  if (companyName) contact.companyName = companyName;
  const enrichFields = mapEnrichFieldsParam(
    params.enrichFields,
    params.requiredFields ?? params.required_fields
  );
  if (enrichFields) contact.enrichFields = enrichFields;
  if (!linkedinUrl && !(firstName && lastName && (domain || companyName))) {
    return {
      error: "Person contact requires linkedinUrl OR firstName+lastName plus domain or companyName."
    };
  }
  return { contacts: [contact] };
}
function buildPeopleSearchBody(params) {
  const body = {};
  const titles = readStringList(params.titles) ?? readStringList(params.personTitles) ?? readStringList(params.person_titles);
  const locations = readStringList(params.locations) ?? readStringList(params.personLocations) ?? readStringList(params.person_locations);
  const domains = readStringList(params.organizationDomains) ?? readStringList(params.organization_domains);
  const companyDomain = readTrimmedString(params.companyDomain) ?? (domains && domains.length > 0 ? domains[0] : void 0);
  if (titles) body.titles = titles;
  if (locations) body.locations = locations;
  if (companyDomain) body.companyDomain = companyDomain;
  const limit = typeof params.limit === "number" ? params.limit : typeof params.perPage === "number" ? params.perPage : typeof params.per_page === "number" ? params.per_page : void 0;
  if (limit !== void 0) body.limit = limit;
  const page = typeof params.page === "number" ? params.page : void 0;
  if (page !== void 0 && limit !== void 0 && page > 0) {
    body.offset = (page - 1) * limit;
  } else if (typeof params.offset === "number") {
    body.offset = params.offset;
  }
  return body;
}
function normalizePersonRecord(raw) {
  const emails = Array.isArray(raw.emails) ? raw.emails : [];
  const phones = Array.isArray(raw.phones) ? raw.phones : [];
  const firstEmail = emails[0];
  const firstPhone = phones[0];
  return {
    ...raw,
    fullName: raw.fullName ?? raw.full_name,
    currentCompanyName: raw.currentCompanyName ?? raw.current_company_name ?? raw.companyName,
    emails,
    phones,
    email: firstEmail?.email,
    phone: firstPhone?.number ?? firstPhone?.sanitized_number,
    person: raw.person ?? raw
  };
}
function normalizeCompanyRecord(raw) {
  return {
    ...raw,
    name: raw.name ?? raw.companyName,
    organization: raw.organization ?? raw
  };
}
function interpretPersonContactResponse(payload) {
  if (payload.status === "completed" && payload.cachedResults.length > 0) {
    const first = payload.cachedResults[0];
    if (first && typeof first === "object") {
      return {
        kind: "person",
        person: normalizePersonRecord(first)
      };
    }
  }
  if (payload.enrichmentId) {
    return {
      kind: "queued",
      enrichmentId: payload.enrichmentId,
      status: "queued",
      pollPath: `/v1/enrichment/jobs/${payload.enrichmentId}`
    };
  }
  return {
    kind: "empty",
    reason: "Gateway returned no enrichment result and no job to poll."
  };
}
async function formatGatewayError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
  }
  const error = body?.error;
  const code = error?.code;
  const message = error?.message;
  if (response.status === 404 || code === "not_found") {
    return "No data returned";
  }
  if (response.status === 503 || code === "provider_unavailable" || code === "backend_unavailable") {
    return "Gateway providers unavailable";
  }
  if (code === "invalid_required_field") {
    return message ?? "Invalid required field";
  }
  if (message) return message;
  return `Gateway request failed (HTTP ${response.status})`;
}
async function gatewayFetch(gatewayUrl, apiKey, options) {
  const base = stripTrailingSlashes(gatewayUrl);
  const url = `${base}${options.path.startsWith("/") ? options.path : `/${options.path}`}`;
  const headers = {
    authorization: `Bearer ${apiKey}`
  };
  if (options.body !== void 0) {
    headers["content-type"] = "application/json";
  }
  if (options.scope) {
    headers["x-dench-scope"] = options.scope;
  }
  try {
    const response = await fetch(url, {
      method: options.method ?? (options.body !== void 0 ? "POST" : "GET"),
      headers,
      body: options.body !== void 0 ? JSON.stringify(options.body) : void 0
    });
    if (!response.ok) {
      return {
        ok: false,
        error: await formatGatewayError(response),
        status: response.status
      };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json") ? await response.json() : await response.text();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 0
    };
  }
}
async function gatewayPersonContact(gatewayUrl, apiKey, params) {
  const built = buildPersonContactBody(params);
  if ("error" in built) {
    return { ok: false, error: built.error };
  }
  const response = await gatewayFetch(gatewayUrl, apiKey, {
    method: "POST",
    path: `${ENRICHMENT_BASE_PATH}/person/contact`,
    body: { contacts: built.contacts, preferCache: true },
    scope: "data:enrichment"
  });
  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  return { ok: true, result: interpretPersonContactResponse(response.data) };
}
async function gatewayCompanySearch(gatewayUrl, apiKey, domain, limit = 1) {
  const response = await gatewayFetch(
    gatewayUrl,
    apiKey,
    {
      method: "POST",
      path: `${ENRICHMENT_BASE_PATH}/company/search`,
      body: { domain, limit },
      scope: "data:enrichment"
    }
  );
  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  const first = response.data.companies?.[0];
  return {
    ok: true,
    company: first ? normalizeCompanyRecord(first) : null
  };
}
async function gatewayPeopleSearch(gatewayUrl, apiKey, params) {
  const response = await gatewayFetch(gatewayUrl, apiKey, {
    method: "POST",
    path: `${ENRICHMENT_BASE_PATH}/people/search`,
    body: buildPeopleSearchBody(params),
    scope: "data:enrichment"
  });
  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  return { ok: true, people: response.data.people ?? [] };
}
async function gatewayEnrichmentJob(gatewayUrl, apiKey, enrichmentId) {
  const response = await gatewayFetch(gatewayUrl, apiKey, {
    method: "GET",
    path: `${ENRICHMENT_BASE_PATH}/jobs/${encodeURIComponent(enrichmentId)}`,
    scope: "data:enrichment"
  });
  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  return { ok: true, job: response.data };
}

// extensions/shared/dench-auth.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
var DEFAULT_GATEWAY_URL = "https://gateway.merseoriginals.com";
var AUTH_PROFILES_REL = path.join("agents", "main", "agent", "auth-profiles.json");
function readDenchAuthProfileKey() {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    const key = readKeyFromAuthProfiles(path.join(stateDir, AUTH_PROFILES_REL));
    if (key) return key;
  }
  return envFallback();
}
function readKeyFromAuthProfiles(authPath) {
  try {
    if (!existsSync(authPath)) return void 0;
    const raw = JSON.parse(readFileSync(authPath, "utf-8"));
    const key = raw?.profiles?.["dench-cloud:default"]?.key;
    return typeof key === "string" && key.trim() ? key.trim() : void 0;
  } catch {
    return void 0;
  }
}
function envFallback() {
  return process.env.DENCH_CLOUD_API_KEY?.trim() || process.env.DENCH_API_KEY?.trim() || void 0;
}
function resolveDenchGatewayUrl(pluginConfig) {
  const configured = pluginConfig?.gatewayUrl;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  return process.env.DENCH_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL;
}

// extensions/apollo-enrichment/index.ts
var id = "apollo-enrichment";
var ENRICH_ACTIONS = ["people", "company", "people_search", "job_status"];
function asRecord(value) {
  return value && typeof value === "object" ? value : void 0;
}
function readTrimmedString2(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function jsonResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload
  };
}
var DenchEnrichParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [...ENRICH_ACTIONS],
      description: 'Action: "people" (person contact), "company" (domain lookup), "people_search" (filters), or "job_status" (poll queued person job).'
    },
    enrichmentId: {
      type: "string",
      description: "Enrichment job ID for job_status polling."
    },
    email: { type: "string", description: "Legacy hint; person contact prefers linkedinUrl or name+company." },
    linkedinUrl: { type: "string", description: "LinkedIn URL for person contact enrichment." },
    firstName: { type: "string", description: "Person first name." },
    lastName: { type: "string", description: "Person last name." },
    domain: { type: "string", description: "Company domain such as acme.com." },
    organizationName: {
      type: "string",
      description: "Organization name hint for person contact."
    },
    personTitles: {
      type: "array",
      items: { type: "string" },
      description: "Job titles for people search."
    },
    personLocations: {
      type: "array",
      items: { type: "string" },
      description: "Locations for people search."
    },
    organizationDomains: {
      type: "array",
      items: { type: "string" },
      description: "Organization domains for people search."
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
      description: "Legacy alias for personTitles."
    },
    person_locations: {
      type: "array",
      items: { type: "string" },
      description: "Legacy alias for personLocations."
    },
    organization_domains: {
      type: "array",
      items: { type: "string" },
      description: "Legacy alias for organizationDomains."
    },
    per_page: { type: "number", description: "Legacy alias for perPage." },
    enrichFields: {
      type: "array",
      items: { type: "string" },
      description: 'FullEnrich enrichFields for person contact: "work_emails", "phones", "personal_emails", or "all". Defaults to work_emails.'
    },
    requiredFields: {
      type: "array",
      items: { type: "string" },
      description: "Legacy Apollo requiredFields; mapped to enrichFields (email\u2192work_emails, phone\u2192phones). Prefer enrichFields."
    },
    required_fields: {
      type: "array",
      items: { type: "string" },
      description: "Legacy alias for requiredFields."
    }
  },
  required: ["action"]
};
async function executeDenchEnrich(gatewayUrl, apiKey, params) {
  const action = params.action;
  if (action !== "people" && action !== "company" && action !== "people_search" && action !== "job_status") {
    return jsonResult({
      error: `Unknown action "${String(action)}". Use "people", "company", "people_search", or "job_status".`
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
        message: "Person enrichment queued. Call action job_status with enrichmentId, or retry later."
      });
    }
    if (action === "company") {
      const domain = readTrimmedString2(params.domain);
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
    const enrichmentId = readTrimmedString2(params.enrichmentId);
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
        error: job.error?.message ?? "Enrichment job failed"
      });
    }
    if (job.status === "pending") {
      return jsonResult({
        enrichmentId,
        status: job.status,
        message: "Job still pending; retry job_status later."
      });
    }
    const people = (job.people ?? []).map(
      (p) => normalizePersonRecord(p)
    );
    return jsonResult({
      enrichmentId,
      status: job.status,
      people,
      person: people[0]
    });
  } catch (err) {
    return jsonResult({
      error: "Enrichment request failed.",
      detail: err instanceof Error ? err.message : String(err)
    });
  }
}
function register(api) {
  const rootConfig = asRecord(api.config);
  const pluginEntries = asRecord(asRecord(rootConfig?.plugins)?.entries);
  const pluginConfig = asRecord(asRecord(pluginEntries?.[id])?.config);
  if (pluginConfig?.enabled === false) {
    return;
  }
  const gwPluginConfig = asRecord(asRecord(pluginEntries?.["dench-ai-gateway"])?.config);
  const gatewayUrl = resolveDenchGatewayUrl(gwPluginConfig);
  const apiKey = readDenchAuthProfileKey();
  if (!apiKey) {
    api.logger?.info?.(
      "[apollo-enrichment] No Dench Cloud API key found; tool will not be registered."
    );
    return;
  }
  api.registerTool({
    name: "dench_enrich",
    label: "Dench Enrichment",
    description: 'Look up people and companies through the Dench Cloud gateway (FullEnrich). Use action "people" for person contact (linkedinUrl or name+company); returns cached person immediately or a queued enrichmentId. Use "company" for company lookup by domain. Use "people_search" for filtered people lists. Use "job_status" with enrichmentId to resolve queued person jobs. Prefer enrichFields over legacy requiredFields.',
    parameters: DenchEnrichParameters,
    execute: (_toolCallId, params) => executeDenchEnrich(gatewayUrl, apiKey, params)
  });
}
export {
  register as default,
  id
};
