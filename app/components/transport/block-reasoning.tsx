import { CircleCheck, LoaderCircle } from "lucide-react";

import {
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "~/components/ui/trace";

export function ReasoningBlock({ text, running }: { text: string; running: boolean }) {
	return (
		<TraceCollapsible defaultOpen={running}>
			<TraceCollapsibleTrigger>
				<TraceLine status={running ? "running" : undefined}>
					<TraceIcon>
						{running ? <LoaderCircle className="animate-spin" /> : <CircleCheck />}
					</TraceIcon>
					<TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
				</TraceLine>
			</TraceCollapsibleTrigger>
			<TraceCollapsibleContent className="text-sm whitespace-pre-wrap text-muted-foreground">
				{text}
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
}
