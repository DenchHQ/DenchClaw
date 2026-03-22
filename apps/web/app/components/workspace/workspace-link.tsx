"use client";

import type { ReactNode, HTMLAttributes } from "react";
import { UrlFavicon } from "./url-favicon";
import { useLinkHover, useLinkPreview, LinkPreviewPortal } from "./link-preview-card";

type WorkspaceLinkProps = {
	href: string;
	text: string;
	linkType: "url" | "email" | "phone" | "file";
	faviconUrl?: string;
	showFavicon?: boolean;
	layout?: "inline" | "block";
	className?: string;
	children?: ReactNode;
};

export function WorkspaceLink({
	href,
	text,
	linkType,
	faviconUrl,
	showFavicon = false,
	layout = "inline",
	className,
	children,
}: WorkspaceLinkProps) {
	const isExternal = linkType === "url" || linkType === "file";
	const isPreviewable = linkType === "url";

	const previewUrl = isPreviewable ? href : undefined;
	const { open, triggerRef, triggerProps, cardProps } = useLinkHover(previewUrl);
	const { state, data } = useLinkPreview(previewUrl);

	const renderFavicon = showFavicon && linkType === "url" && faviconUrl;

	const defaultContent = renderFavicon ? (
		<span className={`flex min-w-0 items-center gap-1.5 ${layout === "inline" ? "max-w-full" : "w-full"}`}>
			<UrlFavicon src={faviconUrl!} />
			<span className="min-w-0 truncate">{text}</span>
		</span>
	) : (
		text
	);

	const anchorClassName = (() => {
		const base = className ?? "";
		if (renderFavicon) {
			return layout === "block"
				? `block underline underline-offset-2 ${base}`.trim()
				: `inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle underline underline-offset-2 ${base}`.trim();
		}
		return `underline underline-offset-2 ${base}`.trim();
	})();

	return (
		<>
			<a
				{...(isPreviewable ? triggerProps : {})}
				ref={isPreviewable ? (triggerRef as React.RefObject<HTMLAnchorElement>) : undefined}
				href={href}
				{...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
				className={anchorClassName}
				style={{ color: "var(--color-accent)" }}
				onClick={(e) => e.stopPropagation()}
			>
				{children ?? defaultContent}
			</a>
			{isPreviewable && (
				<LinkPreviewPortal
					open={open}
					triggerRef={triggerRef}
					data={data}
					loading={state === "loading"}
					cardProps={cardProps}
				/>
			)}
		</>
	);
}

/**
 * Wrap any element with link-preview hover behavior for an external URL.
 * The children are rendered as-is; hover triggers the preview portal.
 */
export function LinkPreviewWrapper({
	href,
	children,
	className,
	style,
	...rest
}: {
	href: string;
	children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
	const { open, triggerRef, triggerProps, cardProps } = useLinkHover(href);
	const { state, data } = useLinkPreview(href);

	return (
		<>
			<span
				{...rest}
				{...triggerProps}
				ref={triggerRef}
				className={className}
				style={style}
			>
				{children}
			</span>
			<LinkPreviewPortal
				open={open}
				triggerRef={triggerRef}
				data={data}
				loading={state === "loading"}
				cardProps={cardProps}
			/>
		</>
	);
}
