import { RefreshCw } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { harnessLabel } from "~/lib/harness";
import type { SessionInfo } from "../../../workers/protocol";

import { HarnessBadge } from "./harness-badge";
import { ModeToggle } from "./mode-toggle";

export function TransportHeader({
	session,
	onRefresh,
}: {
	session: SessionInfo | undefined;
	onRefresh: () => void;
}) {
	return (
		<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
			<SidebarTrigger />
			<span aria-hidden className="mx-1 h-4 w-px self-center bg-border" />
			<div className="min-w-0">
				<div className="truncate text-sm font-medium">
					{session ? session.name || session.sessionId : "no session"}
				</div>
				<div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
					{session ? (
						<>
							<HarnessBadge session={session} />
							<span className="truncate">
								{session.model || "no model"} · {session.cwd}
							</span>
						</>
					) : (
						"select a session in the sidebar"
					)}
				</div>
			</div>
			<div className="ml-auto flex items-center gap-2">
				{session?.experimental ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Badge variant="outline" className="border-violet-500/40 text-violet-700 dark:text-violet-300">
								experimental
							</Badge>
						</TooltipTrigger>
						<TooltipContent>{harnessLabel(session)} support is experimental</TooltipContent>
					</Tooltip>
				) : null}
				{session?.busy ? (
					<Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-300">
						running
					</Badge>
				) : null}
				{session?.pending ? (
					<Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
						waiting
					</Badge>
				) : null}
				<ModeToggle />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label="reload history">
							<RefreshCw />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Reload history</TooltipContent>
				</Tooltip>
			</div>
		</header>
	);
}
