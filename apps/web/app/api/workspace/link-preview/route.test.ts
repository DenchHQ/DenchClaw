import { describe, expect, it } from "vitest";
import { parseMetadata } from "./route";

describe("parseMetadata", () => {
	it("extracts OG title, description, image, and site name", () => {
		const html = `
			<html>
			<head>
				<meta property="og:title" content="Example Page">
				<meta property="og:description" content="A description of the page">
				<meta property="og:image" content="https://example.com/image.png">
				<meta property="og:site_name" content="Example">
				<title>Fallback Title</title>
			</head>
			<body></body>
			</html>
		`;
		const result = parseMetadata(html, "https://example.com/page");
		expect(result.title).toBe("Example Page");
		expect(result.description).toBe("A description of the page");
		expect(result.imageUrl).toBe("https://example.com/image.png");
		expect(result.siteName).toBe("Example");
		expect(result.domain).toBe("example.com");
	});

	it("falls back to <title> and meta description when OG tags are absent", () => {
		const html = `
			<html>
			<head>
				<title>My Page Title</title>
				<meta name="description" content="Basic meta description">
			</head>
			<body></body>
			</html>
		`;
		const result = parseMetadata(html, "https://example.com");
		expect(result.title).toBe("My Page Title");
		expect(result.description).toBe("Basic meta description");
		expect(result.imageUrl).toBeUndefined();
	});

	it("prefers Twitter card tags when OG is missing", () => {
		const html = `
			<html>
			<head>
				<meta name="twitter:title" content="Twitter Title">
				<meta name="twitter:description" content="Twitter description">
				<meta name="twitter:image" content="/card.jpg">
			</head>
			<body></body>
			</html>
		`;
		const result = parseMetadata(html, "https://example.com/article");
		expect(result.title).toBe("Twitter Title");
		expect(result.description).toBe("Twitter description");
		expect(result.imageUrl).toBe("https://example.com/card.jpg");
	});

	it("resolves relative image URLs against the page URL", () => {
		const html = `
			<html><head>
				<meta property="og:image" content="/static/cover.png">
			</head><body></body></html>
		`;
		const result = parseMetadata(html, "https://cdn.example.com/page");
		expect(result.imageUrl).toBe("https://cdn.example.com/static/cover.png");
	});

	it("extracts favicon from link[rel=icon] and resolves relative paths", () => {
		const html = `
			<html><head>
				<link rel="icon" href="/assets/favicon.png">
				<title>Site</title>
			</head><body></body></html>
		`;
		const result = parseMetadata(html, "https://example.com/about");
		expect(result.faviconUrl).toBe("https://example.com/assets/favicon.png");
	});

	it("falls back to /favicon.ico when no link[rel=icon] is found", () => {
		const html = `<html><head><title>No icon</title></head><body></body></html>`;
		const result = parseMetadata(html, "https://example.com/path");
		expect(result.faviconUrl).toBe("https://example.com/favicon.ico");
	});

	it("decodes HTML entities in title and description", () => {
		const html = `
			<html><head>
				<meta property="og:title" content="Tom &amp; Jerry&#39;s Page">
				<meta property="og:description" content="It&apos;s &lt;great&gt;">
			</head><body></body></html>
		`;
		const result = parseMetadata(html, "https://example.com");
		expect(result.title).toBe("Tom & Jerry's Page");
	});

	it("handles pages with no metadata gracefully", () => {
		const html = `<html><body>Hello</body></html>`;
		const result = parseMetadata(html, "https://bare.example.com");
		expect(result.domain).toBe("bare.example.com");
		expect(result.url).toBe("https://bare.example.com");
		expect(result.title).toBeUndefined();
		expect(result.description).toBeUndefined();
	});

	it("handles content-before-property ordering in meta tags", () => {
		const html = `
			<html><head>
				<meta content="Reversed Order" property="og:title">
			</head><body></body></html>
		`;
		const result = parseMetadata(html, "https://example.com");
		expect(result.title).toBe("Reversed Order");
	});

	it("resolves apple-touch-icon as favicon (iOS bookmark icons)", () => {
		const html = `
			<html><head>
				<link rel="apple-touch-icon" href="/apple-icon-180.png">
			</head><body></body></html>
		`;
		const result = parseMetadata(html, "https://example.com");
		expect(result.faviconUrl).toBe("https://example.com/apple-icon-180.png");
	});

	it("prefers OG tags over Twitter when both present (OG is the canonical standard)", () => {
		const html = `
			<html><head>
				<meta property="og:title" content="OG Title">
				<meta name="twitter:title" content="Twitter Title">
				<meta property="og:description" content="OG Description">
				<meta name="twitter:description" content="Twitter Description">
			</head><body></body></html>
		`;
		const result = parseMetadata(html, "https://example.com");
		expect(result.title).toBe("OG Title");
		expect(result.description).toBe("OG Description");
	});

	it("handles malformed HTML without crashing (robustness against real-world pages)", () => {
		const html = `<html><head><meta property="og:title" content="Still works"><body>unclosed tags everywhere`;
		const result = parseMetadata(html, "https://example.com");
		expect(result.title).toBe("Still works");
		expect(result.domain).toBe("example.com");
	});

	it("strips query strings from domain in result (clean domain display)", () => {
		const html = `<html><head><title>Test</title></head></html>`;
		const result = parseMetadata(html, "https://example.com/path?utm_source=test&ref=abc");
		expect(result.domain).toBe("example.com");
		expect(result.url).toBe("https://example.com/path?utm_source=test&ref=abc");
	});

	it("handles twitter:image:src as image fallback", () => {
		const html = `
			<html><head>
				<meta name="twitter:image:src" content="https://cdn.example.com/card.jpg">
			</head><body></body></html>
		`;
		const result = parseMetadata(html, "https://example.com");
		expect(result.imageUrl).toBe("https://cdn.example.com/card.jpg");
	});
});
