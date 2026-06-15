import {
	mapRequiredFieldsToEnrichFields,
	type EnrichFieldToken,
} from "@/lib/dench-gateway-enrichment";

// ---------------------------------------------------------------------------
// Enrichment column definitions, object category detection, and helpers
// for Dench gateway enrichment (legacy `apolloPath` keys kept for DB compat).
// ---------------------------------------------------------------------------

export type EnrichmentCategory = "people" | "company";

export const ENRICHMENT_CATEGORIES: EnrichmentCategory[] = ["people", "company"];

export type EnrichmentColumnDef = {
	label: string;
	key: string;
	fieldType: string;
	/** Dot-path into the enrichment response payload to extract the value. */
	apolloPath: string;
	/**
	 * Legacy column metadata tokens mapped to gateway `enrichFields` where applicable.
	 * Empty array means no narrowing contract (gateway default backfill).
	 */
	requiredFields: string[];
	/**
	 * Additional dot-paths to try if `apolloPath` returns null. Lets the gateway
	 * evolve toward canonical merged responses without breaking extraction.
	 */
	extractionFallbacks?: string[];
};

export type EnrichmentInputDef = {
	/** What kind of input is needed (for auto-detection heuristics). */
	kind: "email" | "linkedin" | "domain";
	label: string;
};

// ---------------------------------------------------------------------------
// Object category detection
// ---------------------------------------------------------------------------

const PEOPLE_PATTERNS = /people|person|contact|lead|prospect/i;
const COMPANY_PATTERNS = /company|companies|organization|account|business/i;

export function detectEnrichmentCategory(
	objectName: string,
): EnrichmentCategory | null {
	if (PEOPLE_PATTERNS.test(objectName)) return "people";
	if (COMPANY_PATTERNS.test(objectName)) return "company";
	return null;
}

// ---------------------------------------------------------------------------
// Column definitions per category
// ---------------------------------------------------------------------------

export const PEOPLE_ENRICHMENT_COLUMNS: EnrichmentColumnDef[] = [
	{
		label: "Full Name",
		key: "person.name",
		fieldType: "text",
		apolloPath: "person.name",
		requiredFields: ["fullName"],
		extractionFallbacks: ["fullName", "person.fullName"],
	},
	{
		label: "Email",
		key: "person.email",
		fieldType: "email",
		apolloPath: "person.email",
		requiredFields: ["email"],
		extractionFallbacks: ["email", "emails.0.email"],
	},
	{
		label: "Headline",
		key: "person.headline",
		fieldType: "text",
		apolloPath: "person.headline",
		requiredFields: ["headline"],
		extractionFallbacks: ["headline"],
	},
	{
		label: "LinkedIn URL",
		key: "person.linkedin_url",
		fieldType: "url",
		apolloPath: "person.linkedin_url",
		requiredFields: ["linkedinID"],
		extractionFallbacks: ["linkedin_url", "URLs.linkedin", "person.URLs.linkedin"],
	},
	{
		label: "Twitter URL",
		key: "person.twitter_url",
		fieldType: "url",
		apolloPath: "person.twitter_url",
		requiredFields: ["URLs"],
		extractionFallbacks: ["twitter_url", "URLs.twitter", "person.URLs.twitter"],
	},
	{
		label: "Phone",
		key: "person.phone",
		fieldType: "phone",
		apolloPath: "person.contact.phone_numbers.0.sanitized_number",
		requiredFields: ["phone"],
		extractionFallbacks: [
			"phone",
			"person.phone",
			"phones.0.number",
			"phones.0.sanitized_number",
		],
	},
	{
		label: "Title",
		key: "person.title",
		fieldType: "text",
		apolloPath: "person.title",
		// Do not mirror the Headline column's `requiredFields: ["headline"]` —
		// that duplicated the gateway contract and tended to return the same
		// string as LinkedIn headline. Omit the contract to use default backfill,
		// then prefer legacy `person.title` and merged `title` before any headline.
		requiredFields: [],
		extractionFallbacks: ["title"],
	},
	{
		label: "Location",
		key: "person.location",
		fieldType: "text",
		apolloPath: "__computed.location",
		requiredFields: ["location"],
		extractionFallbacks: ["location", "person.location"],
	},
];

export const COMPANY_ENRICHMENT_COLUMNS: EnrichmentColumnDef[] = [
	{
		label: "Company Name",
		key: "organization.name",
		fieldType: "text",
		apolloPath: "organization.name",
		requiredFields: ["name"],
		extractionFallbacks: ["name", "companies.0.name"],
	},
	{
		label: "Website URL",
		key: "organization.website_url",
		fieldType: "url",
		apolloPath: "organization.website_url",
		requiredFields: ["website"],
		extractionFallbacks: ["website", "organization.website"],
	},
	{
		label: "Industry",
		key: "organization.industry",
		fieldType: "text",
		apolloPath: "organization.industry",
		requiredFields: ["industryList"],
		extractionFallbacks: ["industryList.0", "organization.industryList.0"],
	},
	{
		label: "LinkedIn URL",
		key: "organization.linkedin_url",
		fieldType: "url",
		apolloPath: "organization.linkedin_url",
		requiredFields: ["linkedinID"],
		extractionFallbacks: ["URLs.linkedin", "organization.URLs.linkedin"],
	},
	{
		label: "Total Funding",
		key: "organization.total_funding_printed",
		fieldType: "text",
		apolloPath: "organization.total_funding_printed",
		requiredFields: ["totalFunding"],
		extractionFallbacks: ["totalFunding", "organization.totalFunding"],
	},
	{
		label: "Founded Year",
		key: "organization.founded_year",
		fieldType: "number",
		apolloPath: "organization.founded_year",
		requiredFields: ["founded"],
		extractionFallbacks: ["founded", "organization.founded"],
	},
];

export function getEnrichmentColumns(
	category: EnrichmentCategory,
): EnrichmentColumnDef[] {
	return category === "people"
		? PEOPLE_ENRICHMENT_COLUMNS
		: COMPANY_ENRICHMENT_COLUMNS;
}

// ---------------------------------------------------------------------------
// Input requirements per category
// ---------------------------------------------------------------------------

// The Dench gateway enriches people from a LinkedIn URL only; email-only input
// is rejected by the enrich route, so email is intentionally not a people input.
export const PEOPLE_INPUTS: EnrichmentInputDef[] = [
	{ kind: "linkedin", label: "LinkedIn URL" },
];

export const COMPANY_INPUTS: EnrichmentInputDef[] = [
	{ kind: "domain", label: "Website / Domain" },
	{ kind: "linkedin", label: "LinkedIn URL" },
];

export function getInputDefs(category: EnrichmentCategory): EnrichmentInputDef[] {
	return category === "people" ? PEOPLE_INPUTS : COMPANY_INPUTS;
}

// ---------------------------------------------------------------------------
// Auto-detect an input column from existing fields
// ---------------------------------------------------------------------------

export type FieldCandidate = { id: string; name: string; type: string };

export function isEligibleInputField(
	category: EnrichmentCategory,
	field: FieldCandidate,
): boolean {
	if (category === "people") {
		// People enrichment requires a LinkedIn URL; email is not accepted.
		return /linkedin/i.test(field.name);
	}

	return (
		/domain|website/i.test(field.name)
		|| /linkedin/i.test(field.name)
		|| (/^url$/i.test(field.name) && field.type === "url")
	);
}

export function getEligibleInputFields(
	category: EnrichmentCategory,
	fields: FieldCandidate[],
): FieldCandidate[] {
	return fields.filter((field) => isEligibleInputField(category, field));
}

export function getAvailableEnrichmentCategories(
	objectName: string,
	fields: FieldCandidate[],
): EnrichmentCategory[] {
	const detected = detectEnrichmentCategory(objectName);
	if (detected) return [detected];

	const categoriesWithInputs = ENRICHMENT_CATEGORIES.filter(
		(category) => getEligibleInputFields(category, fields).length > 0,
	);
	return categoriesWithInputs.length > 0 ? categoriesWithInputs : ENRICHMENT_CATEGORIES;
}

export function autoDetectInputField(
	category: EnrichmentCategory,
	fields: FieldCandidate[],
): FieldCandidate | null {
	const eligibleFields = getEligibleInputFields(category, fields);
	if (category === "people") {
		// People enrichment requires a LinkedIn URL; never default to email.
		const linkedinField = eligibleFields.find(
			(f) => /linkedin/i.test(f.name),
		);
		if (linkedinField) return linkedinField;
	} else {
		const domainField = eligibleFields.find(
			(f) => /website|domain|^url$/i.test(f.name),
		);
		if (domainField) return domainField;
		const linkedinField = eligibleFields.find(
			(f) => /linkedin/i.test(f.name),
		);
		if (linkedinField) return linkedinField;
	}
	return null;
}

/** Determine input kind from the matched field. */
export function inferInputKind(
	field: FieldCandidate,
): "email" | "linkedin" | "domain" {
	if (field.type === "email" || /^e[-_]?mail/i.test(field.name)) return "email";
	if (/linkedin/i.test(field.name)) return "linkedin";
	return "domain";
}

// ---------------------------------------------------------------------------
// Extract a value from the Apollo response using a dot-path
// ---------------------------------------------------------------------------

function extractApolloValue(
	payload: Record<string, unknown>,
	apolloPath: string,
): string | null {
	if (apolloPath === "__computed.location") {
		return computeLocation(payload);
	}

	const parts = apolloPath.split(".");
	let current: unknown = payload;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return null;
		const idx = Number(part);
		if (Array.isArray(current) && !Number.isNaN(idx)) {
			current = current[idx];
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}
	if (current == null) return null;
	if (typeof current === "object") return JSON.stringify(current);
	return String(current);
}

/**
 * Try the column's primary `apolloPath` first, then any `extractionFallbacks`
 * in order. Returns the first non-null match or null.
 */
export function extractEnrichmentValue(
	payload: Record<string, unknown>,
	column: Pick<EnrichmentColumnDef, "apolloPath" | "extractionFallbacks">,
): string | null {
	const primary = extractApolloValue(payload, column.apolloPath);
	if (primary != null) return primary;
	for (const fallback of column.extractionFallbacks ?? []) {
		const value = extractApolloValue(payload, fallback);
		if (value != null) return value;
	}
	return null;
}

/**
 * Resolve the canonical `requiredFields` list for the column whose primary
 * `apolloPath` matches. Falls back to an empty array (gateway will then use
 * its default backfill list) when no column matches.
 */
export function getRequiredFieldsForApolloPath(
	category: EnrichmentCategory,
	apolloPath: string,
): string[] {
	const column = getEnrichmentColumns(category).find(
		(candidate) => candidate.apolloPath === apolloPath,
	);
	return column?.requiredFields ?? [];
}

/** Map a column's legacy `requiredFields` to gateway `enrichFields` tokens. */
export function getEnrichFieldsForApolloPath(
	category: EnrichmentCategory,
	apolloPath: string,
): EnrichFieldToken[] | undefined {
	return mapRequiredFieldsToEnrichFields(
		getRequiredFieldsForApolloPath(category, apolloPath),
	);
}

function computeLocation(payload: Record<string, unknown>): string | null {
	const person = payload.person as Record<string, unknown> | undefined;
	const city = person?.city ?? payload.city;
	const state = person?.state ?? payload.state;
	const country = person?.country ?? payload.country;
	const parts = [city, state, country].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Enrichment metadata stored in field.default_value
// ---------------------------------------------------------------------------

export type EnrichmentFieldMeta = {
	enrichment: {
		category: EnrichmentCategory;
		key: string;
		apolloPath: string;
		inputFieldName: string;
	};
};

export function buildEnrichmentMeta(
	category: EnrichmentCategory,
	colDef: EnrichmentColumnDef,
	inputFieldName: string,
): EnrichmentFieldMeta {
	return {
		enrichment: {
			category,
			key: colDef.key,
			apolloPath: colDef.apolloPath,
			inputFieldName,
		},
	};
}

export function parseEnrichmentMeta(
	defaultValue: string | null | undefined,
): EnrichmentFieldMeta | null {
	if (!defaultValue) return null;
	try {
		const parsed = JSON.parse(defaultValue);
		if (parsed?.enrichment?.category && parsed.enrichment.key) {
			return parsed as EnrichmentFieldMeta;
		}
	} catch { /* not enrichment metadata */ }
	return null;
}

/** Domain extraction from a URL or bare domain string. */
export function extractDomain(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) return "";
	try {
		const url = new URL(
			trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
		);
		return url.hostname.replace(/^www\./, "");
	} catch {
		return trimmed.replace(/^www\./, "");
	}
}
