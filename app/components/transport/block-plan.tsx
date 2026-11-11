import { Circle, CircleCheck, CircleDot, Route } from "lucide-react";

import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "~/components/ui/trace";
import type { AcpPlanEntry } from "../../../workers/protocol";

export function PlanBlock({ entries }: { entries: AcpPlanEntry[] }) {
	const done = entries.filter((entry) => entry.status === "completed").length;
	const running = entries.some((entry) => entry.status === "in_progress");

	return (
		<Trace>
			<TraceCollapsible defaultOpen>
				<TraceCollapsibleTrigger>
					<TraceLine status={running ? "running" : undefined}>
						<TraceIcon>
							<Route />
						</TraceIcon>
						<TraceTitle>Plan</TraceTitle>
						<TraceDescription>
							{done} of {entries.length} done
						</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<Trace>
						{entries.map((entry, index) => (
							<TraceLine
								key={index}
								status={
									entry.status === "pending"
										? "pending"
										: entry.status === "in_progress"
											? "running"
											: undefined
								}
							>
								<TraceIcon>
									{entry.status === "completed" ? (
										<CircleCheck />
									) : entry.status === "in_progress" ? (
										<CircleDot />
									) : (
										<Circle />
									)}
								</TraceIcon>
								<TraceTitle>{entry.content}</TraceTitle>
							</TraceLine>
						))}
					</Trace>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}
