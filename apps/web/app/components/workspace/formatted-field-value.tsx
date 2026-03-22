"use client";

import { Fragment } from "react";
import { formatWorkspaceFieldValue } from "@/lib/workspace-cell-format";
import { UrlFavicon } from "./url-favicon";
import { LinkOpenButton } from "./link-open-button";
import { WorkspaceLink, LinkPreviewWrapper } from "./workspace-link";

type FormattedFieldValueProps = {
	value: unknown;
	fieldType?: string;
	mode?: "table" | "detail";
	className?: string;
	showUrlFavicon?: boolean;
	linkInteractionMode?: "inline" | "button";
};

function EmptyValue() {
	return <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>--</span>;
}

function FileEmbed({
	mediaType,
	url,
	label,
}: {
	mediaType: "image" | "video" | "audio" | "pdf";
	url: string;
	label: string;
}) {
	if (mediaType === "image") {
		return (
			<div className="mt-2 rounded-lg overflow-hidden border" style={{ borderColor: "var(--color-border)" }}>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={url} alt={label} className="max-h-64 w-auto" />
			</div>
		);
	}
	if (mediaType === "video") {
		return (
			<video
				src={url}
				controls
				className="mt-2 w-full max-h-72 rounded-lg border"
				style={{ borderColor: "var(--color-border)", background: "#000" }}
			/>
		);
	}
	if (mediaType === "audio") {
		return <audio src={url} controls className="mt-2 w-full" />;
	}
	return (
		<iframe
			src={`${url}#toolbar=0&navpanes=0&scrollbar=1`}
			title={label}
			className="mt-2 w-full h-72 rounded-lg border"
			style={{ borderColor: "var(--color-border)", background: "white" }}
		/>
	);
}

function normalizeNewlines(text: string): string {
	return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
}

/**
 * Render a single line/segment with auto-detected formatting.
 * For text/richtext fields, uses heuristic detection so URLs, emails,
 * phone numbers are rendered as clickable links.
 */
function FormattedSegment({
	text,
	fieldType,
	showUrlFavicon = false,
	linkInteractionMode = "inline",
	isTableMode = false,
}: {
	text: string;
	fieldType?: string;
	showUrlFavicon?: boolean;
	linkInteractionMode?: "inline" | "button";
	isTableMode?: boolean;
}) {
	const trimmed = text.trim();
	if (!trimmed) {return <>{text}</>;}
	const detectType = !fieldType || fieldType === "text" || fieldType === "richtext" ? undefined : fieldType;
	const fmt = formatWorkspaceFieldValue(trimmed, detectType);

	if (fmt.kind === "link" && fmt.href) {
		// In heuristic mode (text/richtext), file-path detection is prone to false positives
		// on prose that happens to contain slashes and dotted words
		// (e.g. "Alternate/legacy domains: getgc.ai, gc.ai").
		// Only trust file links when the line has no spaces (i.e. a standalone path).
		if (!detectType && fmt.linkType === "file" && trimmed.includes(" ")) {
			return <>{fmt.text}</>;
		}
		const openInNewTab = fmt.linkType === "url" || fmt.linkType === "file";
		const showFavicon = showUrlFavicon && fmt.linkType === "url" && !!fmt.faviconUrl;
		if (linkInteractionMode === "button") {
			const buttonContent = (
				<span
					className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle"
					style={{ color: "var(--color-accent)" }}
				>
					{showFavicon && <UrlFavicon src={fmt.faviconUrl!} />}
					<span className={isTableMode ? "min-w-0 truncate" : "min-w-0 break-all"}>{fmt.text}</span>
					<LinkOpenButton
						href={fmt.href}
						openInNewTab={openInNewTab}
						className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-black/5"
					/>
				</span>
			);
			return fmt.linkType === "url" ? (
				<LinkPreviewWrapper href={fmt.href}>{buttonContent}</LinkPreviewWrapper>
			) : buttonContent;
		}
		return (
			<WorkspaceLink
				href={fmt.href}
				text={fmt.text}
				linkType={fmt.linkType ?? "url"}
				faviconUrl={fmt.faviconUrl}
				showFavicon={showFavicon}
			/>
		);
	}

	if (fmt.kind === "number" || fmt.kind === "currency") {
		return <span className="tabular-nums">{fmt.text}</span>;
	}

	return <>{fmt.text}</>;
}

export function FormattedFieldValue({
	value,
	fieldType,
	mode = "table",
	className,
	showUrlFavicon = false,
	linkInteractionMode = "inline",
}: FormattedFieldValueProps) {
	const formatted = formatWorkspaceFieldValue(value, fieldType);
	const isTableMode = mode === "table";

	if (formatted.kind === "empty") {
		return <EmptyValue />;
	}

	const displayText = normalizeNewlines(formatted.text);
	const hasNewlines = displayText.includes("\n");

	if (hasNewlines) {
		const lines = displayText.split("\n");
		const containerClass = className ?? (isTableMode ? "block max-w-[300px] line-clamp-3" : "break-words");
		return (
			<span className={containerClass}>
				{lines.map((line, i) => (
					<Fragment key={i}>
						{i > 0 && <br />}
						<FormattedSegment
							text={line}
							fieldType={fieldType}
							showUrlFavicon={showUrlFavicon}
							linkInteractionMode={linkInteractionMode}
							isTableMode={isTableMode}
						/>
					</Fragment>
				))}
			</span>
		);
	}

	// Single-line: full formatting with embeds
	const textClassName = className ?? (isTableMode ? "truncate block max-w-[300px]" : "break-words");

	if (formatted.kind === "link" && formatted.href) {
		const openInNewTab = formatted.linkType === "url" || formatted.linkType === "file";
		const canEmbedInModal = !isTableMode && !!formatted.embedUrl && !!formatted.mediaType;
		const showFavicon = showUrlFavicon && formatted.linkType === "url" && !!formatted.faviconUrl;
		if (linkInteractionMode === "button") {
			const buttonContent = (
				<div className={isTableMode ? "block max-w-[300px]" : "w-full"}>
					<span
						className="flex w-full min-w-0 items-center gap-1.5"
						style={{ color: "var(--color-accent)" }}
					>
						{showFavicon && <UrlFavicon src={formatted.faviconUrl!} />}
						<span className={isTableMode ? "min-w-0 truncate" : "min-w-0 break-all"}>
							{formatted.text}
						</span>
						<LinkOpenButton
							href={formatted.href}
							openInNewTab={openInNewTab}
						/>
					</span>
					{canEmbedInModal && (
						<FileEmbed
							mediaType={formatted.mediaType!}
							url={formatted.embedUrl!}
							label={formatted.text}
						/>
					)}
				</div>
			);
			return formatted.linkType === "url" ? (
				<LinkPreviewWrapper href={formatted.href}>{buttonContent}</LinkPreviewWrapper>
			) : buttonContent;
		}
		return (
			<div className={isTableMode ? "block max-w-[300px]" : "w-full"}>
				<WorkspaceLink
					href={formatted.href}
					text={formatted.text}
					linkType={formatted.linkType ?? "url"}
					faviconUrl={formatted.faviconUrl}
					showFavicon={showFavicon}
					layout="block"
					className={isTableMode ? "truncate" : ""}
				/>
				{canEmbedInModal && (
					<FileEmbed
						mediaType={formatted.mediaType!}
						url={formatted.embedUrl!}
						label={formatted.text}
					/>
				)}
			</div>
		);
	}

	if (formatted.kind === "number" || formatted.kind === "currency") {
		return <span className={`tabular-nums ${textClassName}`}>{formatted.text}</span>;
	}

	return <span className={textClassName}>{displayText}</span>;
}
