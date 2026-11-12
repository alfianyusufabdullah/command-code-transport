import { MessageSquare, Terminal } from "lucide-react";

import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";
import type { SessionInfo } from "../../../workers/protocol";

export function AppSidebar({
	sessions,
	activeAgentId,
	onSelect,
}: {
	sessions: SessionInfo[];
	activeAgentId: string | null;
	onSelect: (agentId: string) => void;
}) {
	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" tooltip="transport">
							<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								<Terminal className="size-4" />
							</div>
							<div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
								<span className="truncate text-sm font-medium">transport</span>
								<span className="truncate text-xs text-muted-foreground">
									Command Code remote
								</span>
							</div>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Sessions</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{sessions.length === 0 ? (
								<p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
									No sessions yet. Run{" "}
									<code className="rounded bg-muted px-1 py-0.5 text-[10px]">
										/transport &lt;host&gt;
									</code>{" "}
									in Command Code.
								</p>
							) : (
								sessions.map((session) => (
									<SidebarMenuItem key={session.agentId}>
										<SidebarMenuButton
											isActive={session.agentId === activeAgentId}
											onClick={() => onSelect(session.agentId)}
											tooltip={session.name || session.sessionId}
											className="h-auto items-start py-1.5 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:items-center! group-data-[collapsible=icon]:justify-center! group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0!"
										>
											<span
												className={cn(
													"mt-1.5 size-1.5 shrink-0 rounded-full group-data-[collapsible=icon]:hidden",
													session.busy ? "bg-sky-400" : "bg-muted-foreground/40",
												)}
											/>
											<MessageSquare className="hidden size-4 shrink-0 group-data-[collapsible=icon]:block" />
											<span className="flex min-w-0 flex-1 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
												<span className="truncate text-sm">
													{session.name || session.sessionId}
												</span>
												<span className="truncate text-[10px] font-normal text-muted-foreground">
													{session.model || "no model"} · {session.cwd}
												</span>
											</span>
											{session.pending ? (
												<span className="rounded bg-amber-500/20 px-1 py-0.5 text-[10px] text-amber-700 dark:text-amber-300 group-data-[collapsible=icon]:hidden">
													waiting
												</span>
											) : null}
										</SidebarMenuButton>
									</SidebarMenuItem>
								))
							)}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
		</Sidebar>
	);
}
