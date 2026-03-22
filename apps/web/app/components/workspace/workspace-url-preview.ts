import { formatWorkspaceFieldValue } from "@/lib/workspace-cell-format";

export type UrlPreview = {
	href: string;
	text: string;
	faviconUrl: string;
};

type FieldLike = {
	name: string;
	type?: string;
};

export function getUrlPreview(
	value: unknown,
	fieldType?: string,
): UrlPreview | undefined {
	const formatted = formatWorkspaceFieldValue(value, fieldType);
	if (
		formatted.kind !== "link"
		|| formatted.linkType !== "url"
		|| !formatted.href
		|| !formatted.faviconUrl
	) {
		return undefined;
	}

	return {
		href: formatted.href,
		text: formatted.text,
		faviconUrl: formatted.faviconUrl,
	};
}

export function getFirstEntryUrlPreview(
	entry: Record<string, unknown>,
	fields: FieldLike[],
): UrlPreview | undefined {
	const orderedFields = [
		...fields.filter((field) => field.type === "url"),
		...fields.filter((field) => field.type !== "url"),
	];

	for (const field of orderedFields) {
		const preview = getUrlPreview(entry[field.name], field.type);
		if (preview) {
			return preview;
		}
	}

	return undefined;
}
