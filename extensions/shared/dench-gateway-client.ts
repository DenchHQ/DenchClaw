export const ENRICHMENT_BASE_PATH = "/v1/enrichment";

export type EnrichFieldToken =
  | "work_emails"
  | "email"
  | "personal_emails"
  | "phones"
  | "all";

export type GatewayFetchOptions = {
  method?: "GET" | "POST";
  path: string;
  body?: unknown;
  scope?: string;
};

export type GatewayErrorBody = {
  error?: { code?: string; message?: string };
};

export type PersonContactGatewayResponse = {
  enrichmentId: string | null;
  status: "queued" | "completed";
  cachedResults: unknown[];
  queuedCount: number;
};

export type EnrichmentJobResponse = {
  enrichmentId: string;
  status: "pending" | "succeeded" | "failed";
  people?: Record<string, unknown>[];
  error?: { code?: string; message?: string };
};

export type HybridPersonResult =
  | { kind: "person"; person: Record<string, unknown> }
  | {
      kind: "queued";
      enrichmentId: string;
      status: "queued";
      pollPath: string;
    }
  | { kind: "empty"; reason: string };

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Linear-time trailing-slash trim. Avoids the `/\/+$/` regex flagged by
 * CodeQL as a polynomial regular expression on uncontrolled data.
 */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return value.slice(0, end);
}

function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => readTrimmedString(item))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
}

/** Map legacy Apollo `requiredFields` tokens to gateway `enrichFields`. */
export function mapRequiredFieldsToEnrichFields(
  requiredFields: string[] | undefined,
): EnrichFieldToken[] | undefined {
  if (!requiredFields || requiredFields.length === 0) return undefined;
  const tokens = new Set<EnrichFieldToken>();
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
    // Apollo-only fields (fullName, headline, linkedinID, etc.) have no enrichFields equivalent.
  }
  // No contact token matched (e.g. enriching name/headline/title): return undefined
  // so the gateway uses its default backfill instead of narrowing to email-only.
  if (tokens.size === 0) return undefined;
  return [...tokens];
}

export function mapEnrichFieldsParam(
  enrichFields: unknown,
  requiredFields: unknown,
): EnrichFieldToken[] | undefined {
  const explicit = readStringList(enrichFields) as EnrichFieldToken[] | undefined;
  if (explicit) return explicit;
  return mapRequiredFieldsToEnrichFields(readStringList(requiredFields));
}

export function buildPersonContactBody(params: {
  email?: unknown;
  linkedinUrl?: unknown;
  linkedin_url?: unknown;
  firstName?: unknown;
  first_name?: unknown;
  lastName?: unknown;
  last_name?: unknown;
  domain?: unknown;
  organizationName?: unknown;
  organization_name?: unknown;
  enrichFields?: unknown;
  requiredFields?: unknown;
  required_fields?: unknown;
}): { contacts: Record<string, unknown>[] } | { error: string } {
  const linkedinUrl =
    readTrimmedString(params.linkedinUrl) ?? readTrimmedString(params.linkedin_url);
  const firstName = readTrimmedString(params.firstName) ?? readTrimmedString(params.first_name);
  const lastName = readTrimmedString(params.lastName) ?? readTrimmedString(params.last_name);
  const domain = readTrimmedString(params.domain);
  const companyName =
    readTrimmedString(params.organizationName) ?? readTrimmedString(params.organization_name);

  const contact: Record<string, unknown> = {};
  if (linkedinUrl) contact.linkedinUrl = linkedinUrl;
  if (firstName) contact.firstName = firstName;
  if (lastName) contact.lastName = lastName;
  if (domain) contact.domain = domain;
  if (companyName) contact.companyName = companyName;

  const enrichFields = mapEnrichFieldsParam(
    params.enrichFields,
    params.requiredFields ?? params.required_fields,
  );
  if (enrichFields) contact.enrichFields = enrichFields;

  if (!linkedinUrl && !(firstName && lastName && (domain || companyName))) {
    return {
      error:
        "Person contact requires linkedinUrl OR firstName+lastName plus domain or companyName.",
    };
  }

  return { contacts: [contact] };
}

export function buildPeopleSearchBody(params: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const titles =
    readStringList(params.titles) ??
    readStringList(params.personTitles) ??
    readStringList(params.person_titles);
  const locations =
    readStringList(params.locations) ??
    readStringList(params.personLocations) ??
    readStringList(params.person_locations);
  const domains =
    readStringList(params.organizationDomains) ??
    readStringList(params.organization_domains);
  const companyDomain =
    readTrimmedString(params.companyDomain) ??
    (domains && domains.length > 0 ? domains[0] : undefined);

  if (titles) body.titles = titles;
  if (locations) body.locations = locations;
  if (companyDomain) body.companyDomain = companyDomain;

  const limit =
    typeof params.limit === "number"
      ? params.limit
      : typeof params.perPage === "number"
        ? params.perPage
        : typeof params.per_page === "number"
          ? params.per_page
          : undefined;
  if (limit !== undefined) body.limit = limit;

  const page = typeof params.page === "number" ? params.page : undefined;
  if (page !== undefined && limit !== undefined && page > 0) {
    body.offset = (page - 1) * limit;
  } else if (typeof params.offset === "number") {
    body.offset = params.offset;
  }

  return body;
}

export function normalizePersonRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const emails = Array.isArray(raw.emails) ? raw.emails : [];
  const phones = Array.isArray(raw.phones) ? raw.phones : [];
  const firstEmail = emails[0] as { email?: string; type?: string } | undefined;
  const firstPhone = phones[0] as { number?: string; sanitized_number?: string } | undefined;

  return {
    ...raw,
    fullName: raw.fullName ?? raw.full_name,
    currentCompanyName: raw.currentCompanyName ?? raw.current_company_name ?? raw.companyName,
    emails,
    phones,
    email: firstEmail?.email,
    phone: firstPhone?.number ?? firstPhone?.sanitized_number,
    person: raw.person ?? raw,
  };
}

export function normalizeCompanyRecord(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    name: raw.name ?? raw.companyName,
    organization: raw.organization ?? raw,
  };
}

export function interpretPersonContactResponse(
  payload: PersonContactGatewayResponse,
): HybridPersonResult {
  if (payload.status === "completed" && payload.cachedResults.length > 0) {
    const first = payload.cachedResults[0];
    if (first && typeof first === "object") {
      return {
        kind: "person",
        person: normalizePersonRecord(first as Record<string, unknown>),
      };
    }
  }
  // A real job id means the gateway queued work we can poll. This covers both
  // an explicit "queued" status and a "completed" response with an empty cache
  // (the job is still being backfilled upstream).
  if (payload.enrichmentId) {
    return {
      kind: "queued",
      enrichmentId: payload.enrichmentId,
      status: "queued",
      pollPath: `/v1/enrichment/jobs/${payload.enrichmentId}`,
    };
  }
  // No cached result and no job id to poll: surface as an empty result instead
  // of polling a placeholder id that can never resolve.
  return {
    kind: "empty",
    reason: "Gateway returned no enrichment result and no job to poll.",
  };
}

export async function formatGatewayError(response: Response): Promise<string> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // fall through
  }
  const error = (body as GatewayErrorBody | null)?.error;
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

export async function gatewayFetch<T = unknown>(
  gatewayUrl: string,
  apiKey: string,
  options: GatewayFetchOptions,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const base = stripTrailingSlashes(gatewayUrl);
  const url = `${base}${options.path.startsWith("/") ? options.path : `/${options.path}`}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.scope) {
    headers["x-dench-scope"] = options.scope;
  }

  try {
    const response = await fetch(url, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: await formatGatewayError(response),
        status: response.status,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? ((await response.json()) as T)
      : ((await response.text()) as T);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 0,
    };
  }
}

export async function gatewayPersonContact(
  gatewayUrl: string,
  apiKey: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; result: HybridPersonResult } | { ok: false; error: string }> {
  const built = buildPersonContactBody(params);
  if ("error" in built) {
    return { ok: false, error: built.error };
  }

  const response = await gatewayFetch<PersonContactGatewayResponse>(gatewayUrl, apiKey, {
    method: "POST",
    path: `${ENRICHMENT_BASE_PATH}/person/contact`,
    body: { contacts: built.contacts, preferCache: true },
    scope: "data:enrichment",
  });

  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  return { ok: true, result: interpretPersonContactResponse(response.data) };
}

export async function gatewayCompanySearch(
  gatewayUrl: string,
  apiKey: string,
  domain: string,
  limit = 1,
): Promise<{ ok: true; company: Record<string, unknown> | null } | { ok: false; error: string }> {
  const response = await gatewayFetch<{ companies?: Record<string, unknown>[] }>(
    gatewayUrl,
    apiKey,
    {
      method: "POST",
      path: `${ENRICHMENT_BASE_PATH}/company/search`,
      body: { domain, limit },
      scope: "data:enrichment",
    },
  );

  if (!response.ok) {
    return { ok: false, error: response.error };
  }

  const first = response.data.companies?.[0];
  return {
    ok: true,
    company: first ? normalizeCompanyRecord(first) : null,
  };
}

export async function gatewayPeopleSearch(
  gatewayUrl: string,
  apiKey: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; people: unknown[] } | { ok: false; error: string }> {
  const response = await gatewayFetch<{ people?: unknown[] }>(gatewayUrl, apiKey, {
    method: "POST",
    path: `${ENRICHMENT_BASE_PATH}/people/search`,
    body: buildPeopleSearchBody(params),
    scope: "data:enrichment",
  });

  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  return { ok: true, people: response.data.people ?? [] };
}

export async function gatewayEnrichmentJob(
  gatewayUrl: string,
  apiKey: string,
  enrichmentId: string,
): Promise<{ ok: true; job: EnrichmentJobResponse } | { ok: false; error: string }> {
  const response = await gatewayFetch<EnrichmentJobResponse>(gatewayUrl, apiKey, {
    method: "GET",
    path: `${ENRICHMENT_BASE_PATH}/jobs/${encodeURIComponent(enrichmentId)}`,
    scope: "data:enrichment",
  });

  if (!response.ok) {
    return { ok: false, error: response.error };
  }
  return { ok: true, job: response.data };
}

/** Poll a queued enrichment job with a short timeout (web SSE use). */
export async function pollEnrichmentJobWithTimeout(
  gatewayUrl: string,
  apiKey: string,
  enrichmentId: string,
  options?: { maxAttempts?: number; delayMs?: number },
): Promise<{ ok: true; person: Record<string, unknown> } | { ok: false; error: string; pending?: boolean }> {
  const maxAttempts = options?.maxAttempts ?? 8;
  const delayMs = options?.delayMs ?? 1500;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await gatewayEnrichmentJob(gatewayUrl, apiKey, enrichmentId);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const job = result.job;
    if (job.status === "failed") {
      return {
        ok: false,
        error: job.error?.message ?? "Enrichment job failed",
      };
    }
    if (job.status === "succeeded") {
      if (job.people && job.people.length > 0) {
        return {
          ok: true,
          person: normalizePersonRecord(job.people[0] as Record<string, unknown>),
        };
      }
      // Succeeded with no people: a definitive empty result, not a pending job.
      // Returning here avoids spinning through the remaining attempts (which
      // would otherwise misreport "Enrichment timed out").
      return { ok: false, error: "No enrichment data found" };
    }
    if (job.status === "pending" && attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (job.status === "pending") {
      return { ok: false, error: "Enrichment still pending", pending: true };
    }
  }

  return { ok: false, error: "Enrichment timed out", pending: true };
}
