import { cn } from "~/lib/utils";
import { harnessLabel } from "~/lib/harness";
import type { Harness, SessionInfo } from "../../../workers/protocol";

const TONES: Record<Harness, string> = {
	commandcode: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	"claude-code": "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
};

export function HarnessBadge({
	session,
	className,
}: {
	session: Pick<SessionInfo, "harness">;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center rounded border px-1 py-px text-[10px] leading-none font-medium whitespace-nowrap",
				TONES[session.harness ?? "commandcode"],
				className,
			)}
		>
			{harnessLabel(session)}
		</span>
	);
}
