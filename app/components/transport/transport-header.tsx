import { RefreshCw } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { SessionInfo } from "../../../workers/protocol";

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
				<div className="truncate text-[11px] text-muted-foreground">
					{session ? `${session.model || "no model"} · ${session.cwd}` : "pilih sesi di sidebar"}
				</div>
			</div>
			<div className="ml-auto flex items-center gap-2">
				{session?.busy ? (
					<Badge variant="outline" className="border-sky-500/40 text-sky-300">
						running
					</Badge>
				) : null}
				{session?.pending ? (
					<Badge variant="outline" className="border-amber-500/40 text-amber-300">
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
