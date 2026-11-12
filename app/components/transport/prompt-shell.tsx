import type { LucideIcon } from "lucide-react";

import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";

type Tone = "info" | "warn" | "danger";

const tones: Record<Tone, { card: string; icon: string }> = {
	info: {
		card: "border-sky-500/30",
		icon: "bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-300",
	},
	warn: {
		card: "border-amber-500/35",
		icon: "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-300",
	},
	danger: {
		card: "border-rose-500/35",
		icon: "bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-300",
	},
};

export function PromptShell({
	icon: Icon,
	eyebrow,
	title,
	badge,
	tone = "info",
	children,
	footer,
}: {
	icon: LucideIcon;
	eyebrow: string;
	title: string;
	badge?: React.ReactNode;
	tone?: Tone;
	children: React.ReactNode;
	footer?: React.ReactNode;
}) {
	const style = tones[tone];
	return (
		<Card
			className={cn(
				"gap-0 overflow-hidden border bg-card py-0 ring-1 ring-black/5 dark:ring-white/10",
				style.card,
			)}
		>
			<CardHeader className="border-b border-border/60 bg-muted/20 px-4 py-3">
				<div className="flex items-start gap-3">
					<span
						className={cn(
							"flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
							style.icon,
						)}
					>
						<Icon className="size-4" />
					</span>
					<div className="min-w-0 flex-1">
						<div className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
							{eyebrow}
						</div>
						<CardTitle className="truncate text-sm">{title}</CardTitle>
					</div>
					{badge}
				</div>
			</CardHeader>
			<CardContent className="space-y-3 px-4 py-3">{children}</CardContent>
			{footer ? (
				<CardFooter className="justify-end gap-2 border-t border-border/60 bg-muted/20 px-4 py-2.5">
					{footer}
				</CardFooter>
			) : null}
		</Card>
	);
}
