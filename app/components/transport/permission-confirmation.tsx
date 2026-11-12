import { Check, ChevronRight, ShieldAlert, X } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CodeBlock, CodeBlockContent } from "~/components/ui/code-block";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";
import type { PermissionInteraction } from "../../../workers/protocol";

import { PromptShell } from "./prompt-shell";

export function PermissionConfirmation({
	interaction,
	onAnswer,
}: {
	interaction: PermissionInteraction;
	onAnswer: (id: string, decision: "allow" | "deny") => void;
}) {
	const input = JSON.stringify(interaction.input, null, 2) ?? "";

	return (
		<PromptShell
			icon={ShieldAlert}
			eyebrow={interaction.safety ? "Safety check" : "Permission"}
			title={`Allow ${interaction.toolName}?`}
			tone={interaction.safety ? "warn" : "info"}
			badge={
				<Badge
					variant="outline"
					className={
						interaction.safety
							? "border-amber-500/40 text-amber-700 dark:text-amber-300"
							: "border-sky-500/40 text-sky-700 dark:text-sky-300"
					}
				>
					{interaction.safety ? "safety" : "tool"}
				</Badge>
			}
			footer={
				interaction.tui ? (
					<Badge variant="outline">answer in terminal</Badge>
				) : (
					<>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onAnswer(interaction.id, "deny")}
						>
							<X />
							Deny
						</Button>
						<Button size="sm" onClick={() => onAnswer(interaction.id, "allow")}>
							<Check />
							Allow
						</Button>
					</>
				)
			}
		>
			{interaction.description ? (
				<p className="text-sm leading-relaxed text-foreground/90">
					{interaction.description}
				</p>
			) : null}

			{interaction.tui ? (
				<p className="text-xs text-muted-foreground">
					This prompt is open in the terminal. Answer it there; this card closes
					automatically.
				</p>
			) : null}

			{interaction.safety ? (
				<div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100/90">
					<ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
					<span>
						This action is never auto-approved. Allow will be forwarded to the terminal
						prompt.
					</span>
				</div>
			) : null}

			<Collapsible>
				<CollapsibleTrigger asChild>
					<Button
						variant="ghost"
						size="xs"
						className="group h-6 px-0 text-muted-foreground"
					>
						<ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
						details
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CodeBlock size="sm" className="mt-1">
						<CodeBlockContent wrap className="max-h-48">
							{input}
						</CodeBlockContent>
					</CodeBlock>
				</CollapsibleContent>
			</Collapsible>
		</PromptShell>
	);
}
