import type { Message, RunBlock, SessionUpdate, Snapshot } from "./types";

function textOf(update: SessionUpdate): string {
	const content = update.content as { type?: string; text?: string } | undefined;
	return content?.type === "text" && typeof content.text === "string" ? content.text : "";
}

export class SessionMirror {
	seq = 0;
	runId = "";
	runActive = false;
	private order: string[] = [];
	private blocks = new Map<string, RunBlock>();

	constructor(
		private readonly agentId: string,
		private readonly send: (message: Message) => void,
	) {}

	beginRun(runId: string): void {
		this.runId = runId;
		this.runActive = true;
		this.order = [];
		this.blocks = new Map();
	}

	endRun(): boolean {
		const was = this.runActive;
		this.runActive = false;
		return was;
	}

	get hasBlocks(): boolean {
		return this.order.length > 0;
	}

	emit(key: string, update: SessionUpdate): void {
		this.seq += 1;
		this.send({ t: "update", agentId: this.agentId, seq: this.seq, key, update });
	}

	setSnapshot(key: string, update: SessionUpdate): void {
		const existing = this.blocks.get(key);
		if (existing) {
			existing.update = update;
			existing.text = textOf(update);
		} else {
			this.blocks.set(key, { key, update, text: textOf(update) });
			this.order.push(key);
		}
		this.emit(key, update);
	}

	appendChunk(
		kind: "agent_message_chunk" | "agent_thought_chunk",
		key: string,
		delta: string,
	): void {
		const existing = this.blocks.get(key);
		if (!existing) {
			this.blocks.set(key, {
				key,
				update: { sessionUpdate: kind, content: { type: "text", text: delta } },
				text: delta,
			});
			this.order.push(key);
		} else {
			existing.text += delta;
			existing.update = { sessionUpdate: kind, content: { type: "text", text: existing.text } };
		}
		this.emit(key, { sessionUpdate: kind, content: { type: "text", text: delta } });
	}

	updateTool(key: string, toolCallId: string, patch: Record<string, unknown>): void {
		const existing = this.blocks.get(key);
		const base =
			existing && existing.update.sessionUpdate === "tool_call"
				? { ...existing.update }
				: { sessionUpdate: "tool_call", toolCallId, title: toolCallId, kind: "other", status: "pending" };
		this.setSnapshot(key, { ...base, ...patch, sessionUpdate: "tool_call" } as SessionUpdate);
	}

	block(key: string): RunBlock | undefined {
		return this.blocks.get(key);
	}

	snapshot(): Snapshot[] {
		return this.order
			.map((key) => this.blocks.get(key))
			.filter((entry): entry is RunBlock => Boolean(entry))
			.map((entry) => ({ key: entry.key, update: entry.update }));
	}
}
