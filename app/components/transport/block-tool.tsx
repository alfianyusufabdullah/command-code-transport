import { CodeBlock, CodeBlockContent } from "~/components/ui/code-block";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "~/components/ui/trace";
import type { Block } from "~/lib/transport-client";

import { contentText, toolIcon, toolLabel } from "./status";

export function ToolBlock({ block }: { block: Block }) {
	const status = block.status ?? "pending";
	const Icon = toolIcon(block.toolKind);
	const title = block.title ?? block.toolCallId ?? "tool";
	const body = contentText(block.content);
	const line = (
		<TraceLine
			status={
				status === "failed" ? "error" : status === "in_progress" ? "running" : "pending"
			}
		>
			<TraceIcon>
				<Icon />
			</TraceIcon>
			<TraceTitle>
				{toolLabel(status)} {title}
			</TraceTitle>
		</TraceLine>
	);

	if (!body) {
		return (
			<Trace>
				{line}
			</Trace>
		);
	}

	return (
		<Trace>
			<TraceCollapsible defaultOpen={status === "failed"}>
				<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<CodeBlock size="sm">
						<CodeBlockContent wrap className="max-h-64">
							{body}
						</CodeBlockContent>
					</CodeBlock>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}
