import { Streamdown } from "streamdown";

import { cn } from "~/lib/utils";

export function Markdown({ text, className }: { text: string; className?: string }) {
	return (
		<Streamdown
			mode="streaming"
			className={cn(
				"max-w-none text-sm leading-relaxed",
				"[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
				"[&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5",
				"[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold",
				"[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold",
				"[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium",
				"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
				"[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
				className,
			)}
		>
			{text}
		</Streamdown>
	);
}
