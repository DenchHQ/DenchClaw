"use client";

type LinkOpenButtonProps = {
	href: string;
	openInNewTab?: boolean;
	title?: string;
	className?: string;
};

export function LinkOpenButton({
	href,
	openInNewTab = true,
	title = "Open link",
	className,
}: LinkOpenButtonProps) {
	return (
		<a
			href={href}
			{...(openInNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
			title={title}
			aria-label={title}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
			className={className ?? "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-black/5"}
		>
			<svg
				width="11"
				height="11"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M7 7h10v10" />
				<path d="M7 17 17 7" />
			</svg>
		</a>
	);
}
