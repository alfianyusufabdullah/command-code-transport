import type { Interaction } from "../../workers/protocol";
import { AppSidebar } from "~/components/transport/app-sidebar";
import { ChatFeed } from "~/components/transport/chat-feed";
import { Composer } from "~/components/transport/composer";
import { InteractionPanel } from "~/components/transport/interaction-panel";
import { TransportHeader } from "~/components/transport/transport-header";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { useTransport } from "~/lib/transport-client";

export function meta() {
	return [
		{ title: "transport" },
		{ name: "description", content: "Remote for Command Code sessions" },
	];
}

export default function Home() {
	const {
		state,
		selectSession,
		loadOlder,
		refresh,
		sendPrompt,
		answerPermission,
		answerQuestion,
	} = useTransport();

	const active = state.sessions.find((session) => session.agentId === state.activeAgentId);
	const interactions = Object.values(state.interactions).filter(
		(interaction: Interaction) => interaction.agentId === state.activeAgentId,
	);

	return (
		<SidebarProvider className="h-dvh overflow-hidden">
			<AppSidebar
				sessions={state.sessions}
				activeAgentId={state.activeAgentId}
				onSelect={selectSession}
			/>
			<SidebarInset className="flex h-full min-h-0 flex-col overflow-hidden">
				<TransportHeader session={active} onRefresh={refresh} />

				{state.notice ? (
					<Alert className="rounded-none border-x-0 border-t-0 border-amber-500/30 bg-amber-500/10 text-amber-200">
						<AlertTitle>Koneksi</AlertTitle>
						<AlertDescription className="text-amber-200/80">{state.notice}</AlertDescription>
						<AlertAction>
							<Button variant="ghost" size="xs" onClick={refresh}>
								reload
							</Button>
						</AlertAction>
					</Alert>
				) : null}

				<ChatFeed
					blocks={state.blocks}
					order={state.order}
					loading={state.loading}
					eof={state.eof}
					busy={Boolean(active?.busy)}
					hasSession={Boolean(active)}
					onLoadOlder={loadOlder}
				/>

				<InteractionPanel
					interactions={interactions}
					onPermission={answerPermission}
					onQuestion={answerQuestion}
				/>

				<Composer disabled={!active} busy={Boolean(active?.busy)} onSend={sendPrompt} />
			</SidebarInset>
		</SidebarProvider>
	);
}
