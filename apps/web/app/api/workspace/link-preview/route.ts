export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type LinkPreviewData = {
	url: string;
	domain: string;
	title?: string;
	description?: string;
	imageUrl?: string;
	faviconUrl?: string;
	siteName?: string;
};

const FETCH_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 512_000;

function isValidHttpUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

function resolveUrl(relative: string, base: string): string | undefined {
	try {
		return new URL(relative, base).toString();
	} catch {
		return undefined;
	}
}

function extractMetaContent(html: string, nameOrProperty: string): string | undefined {
	const escaped = nameOrProperty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(
		`<meta\\s+[^>]*(?:name|property)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*?)["'][^>]*>` +
		`|<meta\\s+[^>]*content\\s*=\\s*["']([^"']*?)["'][^>]*(?:name|property)\\s*=\\s*["']${escaped}["'][^>]*>`,
		"i",
	);
	const match = html.match(re);
	const val = match?.[1] ?? match?.[2];
	return val?.trim() || undefined;
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match?.[1]?.replace(/\s+/g, " ").trim() || undefined;
}

function extractFaviconHref(html: string): string | undefined {
	const iconMatch = html.match(
		/<link\s+[^>]*rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href\s*=\s*["']([^"']+?)["'][^>]*>/i,
	) ?? html.match(
		/<link\s+[^>]*href\s*=\s*["']([^"']+?)["'][^>]*rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/i,
	);
	return iconMatch?.[1]?.trim() || undefined;
}

function decodeEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function parseMetadata(html: string, pageUrl: string): LinkPreviewData {
	const parsedUrl = new URL(pageUrl);
	const domain = parsedUrl.hostname;

	const ogTitle = extractMetaContent(html, "og:title");
	const twitterTitle = extractMetaContent(html, "twitter:title");
	const htmlTitle = extractTitle(html);

	const ogDescription = extractMetaContent(html, "og:description");
	const twitterDescription = extractMetaContent(html, "twitter:description");
	const metaDescription = extractMetaContent(html, "description");

	const ogImage = extractMetaContent(html, "og:image");
	const twitterImage = extractMetaContent(html, "twitter:image");
	const twitterImageSrc = extractMetaContent(html, "twitter:image:src");

	const ogSiteName = extractMetaContent(html, "og:site_name");

	const rawFavicon = extractFaviconHref(html);

	const rawTitle = ogTitle ?? twitterTitle ?? htmlTitle;
	const rawDescription = ogDescription ?? twitterDescription ?? metaDescription;
	const rawImage = ogImage ?? twitterImage ?? twitterImageSrc;

	const result: LinkPreviewData = {
		url: pageUrl,
		domain,
	};

	if (rawTitle) {result.title = decodeEntities(rawTitle);}
	if (rawDescription) {result.description = decodeEntities(rawDescription);}
	if (rawImage) {result.imageUrl = resolveUrl(rawImage, pageUrl);}
	if (ogSiteName) {result.siteName = decodeEntities(ogSiteName);}

	if (rawFavicon) {
		result.faviconUrl = resolveUrl(rawFavicon, pageUrl);
	} else {
		result.faviconUrl = `${parsedUrl.protocol}//${parsedUrl.host}/favicon.ico`;
	}

	return result;
}

export async function GET(req: Request) {
	const { searchParams } = new URL(req.url);
	const targetUrl = searchParams.get("url");

	if (!targetUrl || !isValidHttpUrl(targetUrl)) {
		return Response.json({ error: "Invalid or missing URL" }, { status: 400 });
	}

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		const res = await fetch(targetUrl, {
			signal: controller.signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; DenchClawBot/1.0; +https://dench.com)",
				Accept: "text/html,application/xhtml+xml",
			},
			redirect: "follow",
		});
		clearTimeout(timer);

		if (!res.ok) {
			return Response.json({ error: `Upstream returned ${res.status}` }, { status: 502 });
		}

		const contentType = res.headers.get("content-type") ?? "";
		if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
			return Response.json(
				{ url: targetUrl, domain: new URL(targetUrl).hostname } satisfies LinkPreviewData,
				{ headers: { "Cache-Control": "public, max-age=86400" } },
			);
		}

		const reader = res.body?.getReader();
		if (!reader) {
			return Response.json({ error: "No response body" }, { status: 502 });
		}

		const chunks: Uint8Array[] = [];
		let totalBytes = 0;
		while (totalBytes < MAX_BODY_BYTES) {
			const { done, value } = await reader.read();
			if (done) {break;}
			chunks.push(value);
			totalBytes += value.byteLength;
		}
		reader.cancel().catch(() => {});

		const html = new TextDecoder("utf-8", { fatal: false }).decode(
			Buffer.concat(chunks),
		);

		const finalUrl = res.url || targetUrl;
		const data = parseMetadata(html, finalUrl);

		return Response.json(data, {
			headers: { "Cache-Control": "public, max-age=86400" },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Fetch failed";
		return Response.json({ error: message }, { status: 502 });
	}
}
