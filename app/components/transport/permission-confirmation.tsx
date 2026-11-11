import { ChevronRight, ShieldAlert } from "lucide-react";

import { Button } from "~/components/ui/button";
import { CodeBlock, CodeBlockContent } from "~/components/ui/code-block";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "~/components/ui/item";
import type { PermissionInteraction } from "../../../workers/protocol";

export function PermissionConfirmation({
	interaction,
	onAnswer,
}: {
	interaction: PermissionInteraction;
	onAnswer: (id: string, decision: "allow" | "deny") => void;
}) {
	const input = JSON.stringify(interaction.input, null, 2) ?? "";

	return (
		<Item variant="outline" size="sm" className="border-amber-500/30 bg-amber-500/5">
			<ItemMedia variant="icon">
				<ShieldAlert className="text-amber-400" />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					Allow {interaction.toolName}?
					{interaction.safety ? (
						<span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-normal text-destructive">
							safety
						</span>
					) : null}
				</ItemTitle>
				{interaction.description ? (
					<ItemDescription>{interaction.description}</ItemDescription>
				) : null}
				<Collapsible>
					<CollapsibleTrigger asChild>
						<Button
							variant="ghost"
							size="xs"
							className="group mt-1 h-6 px-0 text-muted-foreground"
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
			</ItemContent>
			<ItemActions>
				<Button
					variant="destructive"
					size="sm"
					onClick={() => onAnswer(interaction.id, "deny")}
				>
					Deny
				</Button>
				{interaction.safety ? (
					<span className="text-[11px] text-muted-foreground">terminal only</span>
				) : (
					<Button size="sm" onClick={() => onAnswer(interaction.id, "allow")}>
						Allow
					</Button>
				)}
			</ItemActions>
		</Item>
	);
}
