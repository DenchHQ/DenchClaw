import { describe, expect, it } from "vitest";
import { getUrlPreview, getFirstEntryUrlPreview } from "./workspace-url-preview";

describe("getUrlPreview", () => {
	it("returns preview for valid HTTP URLs (enforces protocol boundary)", () => {
		const result = getUrlPreview("https://example.com/page", "url");
		expect(result).toBeDefined();
		expect(result!.href).toBe("https://example.com/page");
		expect(result!.faviconUrl).toContain("example.com");
	});

	it("returns undefined for non-URL link types (prevents favicon on emails/phones)", () => {
		expect(getUrlPreview("user@example.com", "email")).toBeUndefined();
		expect(getUrlPreview("+1-555-123-4567", "phone")).toBeUndefined();
	});

	it("returns undefined for plain text that is not a URL", () => {
		expect(getUrlPreview("just some text", "text")).toBeUndefined();
		expect(getUrlPreview("not-a-url", undefined)).toBeUndefined();
	});

	it("returns undefined for empty/null values", () => {
		expect(getUrlPreview(null)).toBeUndefined();
		expect(getUrlPreview("")).toBeUndefined();
		expect(getUrlPreview(undefined)).toBeUndefined();
	});

	it("detects URLs via heuristic when no fieldType is given", () => {
		const result = getUrlPreview("www.example.com");
		expect(result).toBeDefined();
		expect(result!.href).toBe("https://www.example.com");
	});

	it("returns undefined for workspace file paths (favicon only for external URLs)", () => {
		expect(getUrlPreview("/?path=docs%2Ffile.pdf", "text")).toBeUndefined();
		expect(getUrlPreview("/Users/me/file.png", "text")).toBeUndefined();
	});
});

describe("getFirstEntryUrlPreview", () => {
	const fields = [
		{ name: "name", type: "text" },
		{ name: "website", type: "url" },
		{ name: "email", type: "email" },
		{ name: "notes", type: "text" },
	];

	it("prioritizes url-typed fields over text fields with URLs (prevents wrong favicon)", () => {
		const entry = {
			name: "https://wrong-one.com",
			website: "https://correct-one.com",
			email: "test@example.com",
			notes: "https://also-wrong.com",
		};
		const result = getFirstEntryUrlPreview(entry, fields);
		expect(result).toBeDefined();
		expect(result!.href).toBe("https://correct-one.com/");
	});

	it("falls back to text fields when no url-typed field has a valid URL", () => {
		const entry = {
			name: "Acme Corp",
			website: "",
			email: "test@example.com",
			notes: "See https://docs.example.com for details",
		};
		const fieldsWithTextUrl = [
			{ name: "name", type: "text" },
			{ name: "website", type: "url" },
			{ name: "email", type: "email" },
			{ name: "notes", type: "text" },
		];
		const result = getFirstEntryUrlPreview(entry, fieldsWithTextUrl);
		expect(result).toBeUndefined();
	});

	it("returns undefined when no fields contain URLs", () => {
		const entry = {
			name: "Acme Corp",
			website: "",
			email: "hello@acme.com",
			notes: "Some plain text",
		};
		const result = getFirstEntryUrlPreview(entry, fields);
		expect(result).toBeUndefined();
	});

	it("returns undefined for empty entry", () => {
		const result = getFirstEntryUrlPreview({}, fields);
		expect(result).toBeUndefined();
	});

	it("returns undefined when fields array is empty", () => {
		const entry = { website: "https://example.com" };
		const result = getFirstEntryUrlPreview(entry, []);
		expect(result).toBeUndefined();
	});

	it("checks url-typed fields in declaration order when multiple exist", () => {
		const multiUrlFields = [
			{ name: "secondary_site", type: "url" },
			{ name: "primary_site", type: "url" },
			{ name: "name", type: "text" },
		];
		const entry = {
			secondary_site: "https://second.com",
			primary_site: "https://first.com",
			name: "Test",
		};
		const result = getFirstEntryUrlPreview(entry, multiUrlFields);
		expect(result!.href).toBe("https://second.com/");
	});

	it("skips url-typed fields with invalid values and continues to next", () => {
		const multiUrlFields = [
			{ name: "broken", type: "url" },
			{ name: "working", type: "url" },
		];
		const entry = {
			broken: "not-a-url",
			working: "https://valid.com",
		};
		const result = getFirstEntryUrlPreview(entry, multiUrlFields);
		expect(result!.href).toBe("https://valid.com/");
	});
});
