"use client";

type UrlFaviconProps = {
	src: string;
	className?: string;
};

export function UrlFavicon({ src, className }: UrlFaviconProps) {
	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={src}
			alt=""
			aria-hidden="true"
			className={className ?? "w-4 h-4 rounded-[4px] shrink-0"}
		/>
	);
}
