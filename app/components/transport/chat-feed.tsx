import { Loader2, MessageCircleDashed, Plus } from "lucide-react";
import { useMemo } from "react";

import { Bubble, BubbleContent } from "~/components/ui/bubble";
import { Button } from "~/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import { Message, MessageContent } from "~/components/ui/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "~/components/ui/message-scroller";
import { cn } from "~/lib/utils";
import type { Block } from "~/lib/transport-client";

import { BlockView } from "./block-view";

interface BlockGroup {
	id: string;
	kind: "user" | "agent";
	blocks: Block[];
}

function groupBlocks(blocks: Record<string, Block>, order: string[]): BlockGroup[] {
	const groups: BlockGroup[] = [];
	let current: BlockGroup | null = null;
	for (const key of order) {
		const block = blocks[key];
		if (!block) continue;
		const kind = block.kind === "user" ? "user" : "agent";
		if (!current || current.kind !== kind) {
			current = { id: `${kind}:${key}`, kind, blocks: [] };
			groups.push(current);
		}
		current.blocks.push(block);
	}
	return groups;
}

function MessageGroupView({
	group,
	busy,
	live,
}: {
	group: BlockGroup;
	busy: boolean;
	live: boolean;
}) {
	if (group.kind === "user") {
		const live = group.blocks[0]?.key.startsWith("run:") ?? false;
		return (
			<MessageScrollerItem messageId={group.id} scrollAnchor={live}>
				<Message align="end">
					<MessageContent>
						{group.blocks.map((block) => (
							<Bubble key={block.key} align="end" variant="muted">
								<BubbleContent>{block.text}</BubbleContent>
							</Bubble>
						))}
					</MessageContent>
				</Message>
			</MessageScrollerItem>
		);
	}

	return (
		<MessageScrollerItem messageId={group.id}>
			<Message>
				<MessageContent className="gap-3">
					{group.blocks.map((block, index) => (
						<BlockView
							key={block.key}
							block={block}
							running={
								live && busy && block.kind === "thinking" && index === group.blocks.length - 1
							}
						/>
					))}
				</MessageContent>
			</Message>
		</MessageScrollerItem>
	);
}

export function ChatFeed({
	blocks,
	order,
	loading,
	eof,
	busy,
	hasSession,
	hasPrompt,
	onLoadOlder,
}: {
	blocks: Record<string, Block>;
	order: string[];
	loading: boolean;
	eof: boolean;
	busy: boolean;
	hasSession: boolean;
	hasPrompt: boolean;
	onLoadOlder: () => void;
}) {
	const groups = useMemo(() => groupBlocks(blocks, order), [blocks, order]);
	const last = groups[groups.length - 1];

	return (
		<MessageScrollerProvider autoScroll>
			<MessageScroller className="min-h-0 flex-1">
				<MessageScrollerViewport>
					<MessageScrollerContent
						className={cn(
							"mx-auto w-full max-w-3xl gap-6 px-4 py-4 md:px-6",
							hasPrompt && "pb-[52dvh]",
						)}
					>
						{!eof && order.length > 0 ? (
							<div className="flex justify-center">
								<Button variant="outline" size="xs" onClick={onLoadOlder} disabled={loading}>
									{loading ? <Loader2 className="animate-spin" /> : <Plus />}
									{loading ? "loading…" : "load older"}
								</Button>
							</div>
						) : null}

						{order.length === 0 && !loading ? (
							<div className="grid min-h-64 flex-1 place-items-center">
								<Empty>
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<MessageCircleDashed />
										</EmptyMedia>
										<EmptyTitle>{hasSession ? "No history yet" : "Select a session"}</EmptyTitle>
										<EmptyDescription>
											{hasSession
												? "The first turn will appear here once the agent starts working."
												: "Select a session in the sidebar, or run /transport <host> in Command Code."}
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							</div>
						) : null}

						{groups.map((group) => (
							<MessageGroupView
								key={group.id}
								group={group}
								busy={busy}
								live={group === last}
							/>
						))}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}
