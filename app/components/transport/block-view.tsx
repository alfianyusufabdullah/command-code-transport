import { Info } from "lucide-react";

import { Markdown } from "~/components/markdown";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "~/components/ui/trace";
import type { Block } from "~/lib/transport-client";

import { PlanBlock } from "./block-plan";
import { ReasoningBlock } from "./block-reasoning";
import { ToolBlock } from "./block-tool";

export function BlockView({ block, running }: { block: Block; running: boolean }) {
	if (block.kind === "thinking") {
		return <ReasoningBlock text={block.text} running={running} />;
	}

	if (block.kind === "tool") {
		return <ToolBlock block={block} />;
	}

	if (block.kind === "plan") {
		return <PlanBlock entries={block.entries ?? []} />;
	}

	if (block.kind === "assistant") {
		return <Markdown text={block.text} />;
	}

	if (block.kind === "user") {
		return <p className="text-sm whitespace-pre-wrap">{block.text}</p>;
	}

	return (
		<Trace>
			<TraceLine>
				<TraceIcon>
					<Info />
				</TraceIcon>
				<TraceTitle>{block.text || block.mode || "update"}</TraceTitle>
			</TraceLine>
		</Trace>
	);
}
