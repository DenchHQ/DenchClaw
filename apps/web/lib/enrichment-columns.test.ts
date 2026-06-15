import { describe, expect, it } from "vitest";
import {
	COMPANY_ENRICHMENT_COLUMNS,
	PEOPLE_ENRICHMENT_COLUMNS,
	extractEnrichmentValue,
	getAvailableEnrichmentCategories,
	getEligibleInputFields,
	getEnrichFieldsForApolloPath,
	getRequiredFieldsForApolloPath,
} from "./enrichment-columns";

describe("getEligibleInputFields", () => {
	it("limits people enrichment inputs to LinkedIn fields (email is rejected by the gateway)", () => {
		const fields = [
			{ id: "name", name: "Full Name", type: "text" },
			{ id: "email", name: "Email", type: "email" },
			{ id: "linkedin", name: "LinkedIn URL", type: "url" },
			{ id: "company", name: "Company", type: "text" },
		];

		expect(getEligibleInputFields("people", fields).map((field) => field.id)).toEqual([
			"linkedin",
		]);
	});

	it("limits company enrichment inputs to domain, website, and LinkedIn fields", () => {
		const fields = [
			{ id: "name", name: "Company Name", type: "text" },
			{ id: "domain", name: "Domain", type: "text" },
			{ id: "website", name: "Website", type: "url" },
			{ id: "linkedin", name: "LinkedIn URL", type: "url" },
			{ id: "industry", name: "Industry", type: "text" },
		];

		expect(getEligibleInputFields("company", fields).map((field) => field.id)).toEqual([
			"domain",
			"website",
			"linkedin",
		]);
	});

	it("preserves object-name category detection for built-in people and company tables", () => {
		expect(getAvailableEnrichmentCategories("people", [])).toEqual(["people"]);
		expect(getAvailableEnrichmentCategories("companies", [])).toEqual(["company"]);
	});

	it("makes company enrichment available on generic tables with a domain column", () => {
		expect(getAvailableEnrichmentCategories("portfolio", [
			{ id: "domain", name: "Domain", type: "text" },
		])).toEqual(["company"]);
	});

	it("shows both enrichment categories on generic tables when identifiers are ambiguous or email-only", () => {
		// Email is no longer a people-enrichment identifier (the gateway requires a
		// LinkedIn URL for people), so an email-only generic table can't be pinned
		// to a single category and surfaces both options.
		expect(getAvailableEnrichmentCategories("investors", [
			{ id: "email", name: "Email", type: "email" },
		])).toEqual(["people", "company"]);

		expect(getAvailableEnrichmentCategories("pipeline", [
			{ id: "linkedin", name: "LinkedIn URL", type: "url" },
		])).toEqual(["people", "company"]);

		expect(getAvailableEnrichmentCategories("custom_table", [
			{ id: "notes", name: "Notes", type: "text" },
		])).toEqual(["people", "company"]);
	});
});

describe("requiredFields mapping", () => {
	it("records requiredFields per catalog column (empty means gateway default backfill)", () => {
		for (const column of [...PEOPLE_ENRICHMENT_COLUMNS, ...COMPANY_ENRICHMENT_COLUMNS]) {
			expect(Array.isArray(column.requiredFields)).toBe(true);
		}
		expect(
			PEOPLE_ENRICHMENT_COLUMNS.find((column) => column.label === "Title")?.requiredFields,
		).toEqual([]);
	});

	it("resolves canonical requiredFields from an apolloPath", () => {
		expect(getRequiredFieldsForApolloPath("people", "person.contact.phone_numbers.0.sanitized_number"))
			.toEqual(["phone"]);
		expect(getRequiredFieldsForApolloPath("people", "person.headline")).toEqual(["headline"]);
		expect(getRequiredFieldsForApolloPath("people", "person.title")).toEqual([]);
		expect(getRequiredFieldsForApolloPath("company", "organization.industry")).toEqual(["industryList"]);
		expect(getRequiredFieldsForApolloPath("company", "organization.website_url")).toEqual(["website"]);
	});

	it("returns an empty list for unknown apolloPaths so the gateway uses default backfill", () => {
		expect(getRequiredFieldsForApolloPath("people", "person.unknown")).toEqual([]);
	});
});

describe("getEnrichFieldsForApolloPath", () => {
	it("maps a phone requiredField to the gateway phones token", () => {
		expect(
			getEnrichFieldsForApolloPath("people", "person.contact.phone_numbers.0.sanitized_number"),
		).toEqual(["phones"]);
	});

	it("maps email/work_emails requiredFields to the gateway work_emails token", () => {
		const emailColumn = PEOPLE_ENRICHMENT_COLUMNS.find((column) => column.label === "Email");
		expect(emailColumn).toBeDefined();
		expect(getEnrichFieldsForApolloPath("people", emailColumn!.apolloPath)).toEqual([
			"work_emails",
		]);
	});

	it("returns undefined when the column carries no enrichFields contract (default backfill)", () => {
		// Title has an empty requiredFields list, so no narrowing token is sent.
		expect(getEnrichFieldsForApolloPath("people", "person.title")).toBeUndefined();
	});

	it("returns undefined for unknown apolloPaths so the gateway uses default backfill", () => {
		expect(getEnrichFieldsForApolloPath("people", "person.unknown")).toBeUndefined();
	});

	it("returns undefined for non-contact Apollo fields so the gateway uses default backfill", () => {
		// industryList / website are Apollo metadata tokens with no contact-field
		// mapping. We must NOT narrow these to work_emails, otherwise the gateway
		// would only attempt email backfill and the requested field would be
		// missing from the response. Sending no token lets the gateway run its
		// default backfill and return the metadata.
		expect(getEnrichFieldsForApolloPath("company", "organization.industry")).toBeUndefined();
		expect(getEnrichFieldsForApolloPath("company", "organization.website_url")).toBeUndefined();
	});
});

describe("extractEnrichmentValue", () => {
	const phoneColumn = PEOPLE_ENRICHMENT_COLUMNS.find((column) => column.label === "Phone");

	it("prefers the legacy Apollo path when both shapes are present", () => {
		const payload = {
			person: { contact: { phone_numbers: [{ sanitized_number: "+1234" }] } },
			phone: "+9999",
		};
		expect(extractEnrichmentValue(payload, phoneColumn!)).toBe("+1234");
	});

	it("falls back to the canonical top-level field when the legacy path is missing", () => {
		const payload = { phone: "+9999" };
		expect(extractEnrichmentValue(payload, phoneColumn!)).toBe("+9999");
	});

	it("returns null when no path resolves", () => {
		expect(extractEnrichmentValue({}, phoneColumn!)).toBeNull();
	});

	it("does not map Title to LinkedIn headline when only headline data exists", () => {
		const titleColumn = PEOPLE_ENRICHMENT_COLUMNS.find((column) => column.label === "Title")!;
		expect(
			extractEnrichmentValue(
				{ person: { headline: "CEO at Acme" }, headline: "CEO at Acme" },
				titleColumn,
			),
		).toBeNull();
	});
});
