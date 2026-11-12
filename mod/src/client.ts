import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { planFromTodo, toContent, toolDiff, toolKind, toolLocations, toolTitle } from "./acp";
import { formatAnswers, normalizeQuestions } from "./format";
import { discoverSkills } from "./skills";
import {
	activePath,
	capUpdates,
	chunkUpdates,
	entriesToUpdates,
	findSessionFile,
	groupTurns,
	loadEntries,
	paginate,
} from "./jsonl";
import type {
	AgentMessageShape,
	AnswerEntry,
	CloseReason,
	ModApi,
	Pending,
	PermissionInput,
	Question,
	RunBlock,
	SessionUpdate,
	SkillInfo,
	Snapshot,
	ToolCallInput,
	ToolCallResult,
} from "./types";
import { normalizeTarget, randomId, truncate } from "./util";

const PROTOCOL_VERSION = 1;
const INTERACTION_TIMEOUT_MS = Number(process.env.TRANSPORT_INTERACTION_TIMEOUT_MS ?? 60000);
const DISCONNECT_GRACE_MS = 5000;
const OUTBOX_LIMIT = 1000;

function textOf(update: SessionUpdate): string {
	const content = update.content as { type?: string; text?: string } | undefined;
	return content?.type === "text" && typeof content.text === "string" ? content.text : "";
}

function debug(line: string): void {
	try {
		appendFileSync(
			join(homedir(), ".commandcode", "transport-debug.log"),
			`${new Date().toISOString()} ${line}\n`,
		);
	} catch {
		/* ignore */
	}
}

function readAnswerLabel(answer: unknown): string | undefined {
	if (!answer || typeof answer !== "object") return undefined;
	const raw = (answer as Record<string, unknown>).answers;
	if (!Array.isArray(raw) || raw.length === 0) return undefined;
	const first = raw[0];
	if (!first || typeof first !== "object") return undefined;
	const selected = (first as Record<string, unknown>).selectedOptions;
	if (!Array.isArray(selected) || selected.length === 0) return undefined;
	const value = selected[0];
	return typeof value === "string" ? value : undefined;
}

export class TransportClient {
	private socket: WebSocket | null = null;
	private target: string | null = null;
	private connectionId = 0;
	private connecting = false;
	private retry = 0;
	private sessionId = "";
	private seq = 0;
	private stopped = false;
	private browsers = 0;
	private outbox: Record<string, unknown>[] = [];
	private dropped = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly pending = new Map<string, Pending>();

	private planPending: { id: string; closed: boolean } | null = null;
	private permissionPending: { toolName: string; closed: boolean } | null = null;
	private mirrors = new Map<string, { toolName: string }>();

	private runId = "";
	private skills: SkillInfo[] | null = null;
	private runActive = false;
	private blockSeq = 0;
	private userSeq = 0;
	private pendingUser: string[] = [];
	private textKey: string | null = null;
	private thinkKey: string | null = null;
	private runOrder: string[] = [];
	private runBlocks = new Map<string, RunBlock>();

	constructor(
		private readonly cmd: ModApi,
		private readonly agentId: string = randomId(10),
	) {}

	start(target: string): void {
		this.stopped = false;
		this.target = normalizeTarget(target) ?? target;
		this.retry = 0;
		this.outbox = [];
		this.dropped = 0;
		this.browsers = 0;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		for (const entry of [...this.pending.values()]) {
			entry.finish(null, "superseded");
		}
		this.planPending = null;
		try {
			this.socket?.close();
		} catch {
			/* already closed */
		}
		this.socket = null;
		this.connecting = false;
		this.connect();
	}

	setSessionId(next: string | undefined): void {
		if (!next || next === this.sessionId) return;
		this.sessionId = next;
		this.sendHello();
	}

	ensureTarget(target: string): void {
		const normalized = normalizeTarget(target) ?? target;
		if (
			this.target === normalized &&
			this.socket &&
			(this.socket.readyState === 0 || this.socket.readyState === 1)
		) {
			return;
		}
		this.start(normalized);
	}

	shutdown(): void {
		this.clearPending();
		this.rawSend({ t: "bye", agentId: this.agentId });
		this.disconnect();
	}

	disconnect(): void {
		this.stopped = true;
		try {
			this.socket?.close(1000, "disconnect");
		} catch {
			this.socket = null;
		}
	}

	startHeartbeat(): void {
		const ping = () => {
			if (this.socket?.readyState === 1) this.rawSend({ t: "ping" });
		};
		if (this.cmd.clock) {
			this.cmd.clock.every(25000, ping);
			return;
		}
		const timer = setInterval(ping, 25000);
		timer.unref?.();
	}

	onMessageCommitted(message: AgentMessageShape): void {
		if (message.role !== "user" || message.meta?.isMeta) return;
		const content = Array.isArray(message.content) ? message.content : [];
		const texts: string[] = [];
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const value = block as { type?: unknown; text?: unknown };
			if (value.type === "text" && typeof value.text === "string" && value.text.trim()) {
				texts.push(truncate(value.text));
			}
		}
		if (texts.length === 0) return;
		if (!this.runActive) {
			this.pendingUser.push(...texts);
			return;
		}
		for (const text of texts) {
			this.userSeq += 1;
			this.setSnapshot(`run:${this.runId}:user:${this.userSeq}`, {
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text },
			});
		}
	}

	onRunStart(event: Record<string, unknown>): void {
		this.setSessionId(typeof event.sessionId === "string" ? event.sessionId : undefined);
		this.runId = randomId(8);
		this.runActive = true;
		this.blockSeq = 0;
		this.userSeq = 0;
		this.textKey = null;
		this.thinkKey = null;
		this.runOrder = [];
		this.runBlocks = new Map();
		for (const text of this.pendingUser) {
			this.userSeq += 1;
			this.setSnapshot(`run:${this.runId}:user:${this.userSeq}`, {
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text },
			});
		}
		this.pendingUser = [];
		this.sendState(true);
	}

	onMessageStart(): void {
		this.textKey = null;
		this.thinkKey = null;
	}

	onThinkingStart(): void {
		this.blockSeq += 1;
		this.thinkKey = `run:${this.runId}:b${this.blockSeq}`;
	}

	onThinkingDelta(event: Record<string, unknown>): void {
		const delta = typeof event.delta === "string" ? event.delta : "";
		if (!delta) return;
		if (!this.thinkKey) {
			this.blockSeq += 1;
			this.thinkKey = `run:${this.runId}:b${this.blockSeq}`;
		}
		this.appendChunk("agent_thought_chunk", this.thinkKey, delta);
	}

	onThinkingEnd(): void {
		this.thinkKey = null;
	}

	onTextDelta(event: Record<string, unknown>): void {
		const delta = typeof event.delta === "string" ? event.delta : "";
		if (!delta) return;
		if (!this.textKey) {
			this.blockSeq += 1;
			this.textKey = `run:${this.runId}:b${this.blockSeq}`;
		}
		this.appendChunk("agent_message_chunk", this.textKey, delta);
	}

	onToolQueued(event: Record<string, unknown>): void {
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
		if (!toolCallId) return;
		this.textKey = null;
		const name = typeof event.toolName === "string" ? event.toolName : "tool";
		const input = (event.input ?? {}) as Record<string, unknown>;
		this.setSnapshot(`run:${this.runId}:t:${toolCallId}`, {
			sessionUpdate: "tool_call",
			toolCallId,
			title: toolTitle(name, input),
			kind: toolKind(name),
			status: "pending",
			rawInput: input,
			content: toolDiff(name, input),
			locations: toolLocations(name, input),
		});
		if (name === "todo_write") {
			const plan = planFromTodo(this.runId, input);
			if (plan) this.setSnapshot(plan.key, plan.update);
		}
	}

	onToolRunning(event: Record<string, unknown>): void {
		if (this.permissionPending && event.toolName === this.permissionPending.toolName) {
			this.clearPermissionPending();
		}
		if (typeof event.toolName === "string" && event.toolName !== "ask_user_question") {
			this.closeMirrors(event.toolName);
		}
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
		if (!toolCallId) return;
		this.updateTool(`run:${this.runId}:t:${toolCallId}`, toolCallId, {
			status: "in_progress",
			...(typeof event.description === "string" ? { title: event.description } : {}),
		});
	}

	onToolUpdate(event: Record<string, unknown>): void {
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
		if (!toolCallId) return;
		this.updateTool(`run:${this.runId}:t:${toolCallId}`, toolCallId, {
			status: "in_progress",
			content: toContent(event.partial),
		});
	}

	onToolCompleted(event: Record<string, unknown>): void {
		if (this.permissionPending && event.toolName === this.permissionPending.toolName) {
			this.clearPermissionPending();
		}
		if (typeof event.toolName === "string") this.closeMirrors(event.toolName);
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
		if (!toolCallId) return;
		if (this.isPlanTool(event.toolName)) this.closePlanPending();
		this.updateTool(`run:${this.runId}:t:${toolCallId}`, toolCallId, {
			status: "completed",
			content: toContent(event.result),
		});
	}

	onToolFailed(event: Record<string, unknown>, fallback: string): void {
		if (this.permissionPending && event.toolName === this.permissionPending.toolName) {
			this.clearPermissionPending();
		}
		if (typeof event.toolName === "string") this.closeMirrors(event.toolName);
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
		if (!toolCallId) return;
		if (this.isPlanTool(event.toolName)) this.closePlanPending();
		const text =
			typeof event.error === "string"
				? event.error
				: typeof event.hookOutput === "string"
					? `Blocked by a hook: ${event.hookOutput}`
					: fallback;
		this.updateTool(`run:${this.runId}:t:${toolCallId}`, toolCallId, {
			status: "failed",
			content: [{ type: "content", content: { type: "text", text: truncate(text) } }],
		});
	}

	onModeChanged(event: Record<string, unknown>): void {
		this.seq += 1;
		this.send({
			t: "update",
			agentId: this.agentId,
			seq: this.seq,
			key: `mode:${randomId(6)}`,
			update: {
				sessionUpdate: "current_mode_update",
				currentModeId: String(event.mode ?? ""),
			},
		});
	}

	onSessionTitled(event: Record<string, unknown>): void {
		this.seq += 1;
		this.send({
			t: "update",
			agentId: this.agentId,
			seq: this.seq,
			key: "session:title",
			update: { sessionUpdate: "session_info_update", title: String(event.title ?? "") },
		});
	}

	finishRun(): void {
		if (!this.runActive) return;
		this.rawSend({ t: "run_committed", agentId: this.agentId, runId: this.runId });
		this.runActive = false;
		this.textKey = null;
		this.thinkKey = null;
		this.sendState(false);
	}

	onPlanRequest(toolName: string): void {
		if (!this.socket || this.socket.readyState !== 1) return;
		this.closePlanPending();

		const exiting = toolName === "exit_plan_mode";
		const options = exiting
			? [
					{ label: "Approve", description: "Exit plan mode and auto-accept edits" },
					{ label: "Cancel", description: "Stay in plan mode" },
				]
			: [
					{ label: "Approve", description: "Enter plan mode" },
					{ label: "Cancel", description: "Stay in the current mode" },
				];

		const id = `plan_${randomId(6)}`;
		const pending = { id, closed: false };
		this.planPending = pending;
		debug(
			`plan_request tool=${toolName} browsers=${this.browsers} readable=${process.stdin.listenerCount("readable")}`,
		);

		const interaction = {
			t: "interaction",
			agentId: this.agentId,
			id,
			kind: "question",
			questions: [
				{
					question: exiting ? "Exit plan mode and start implementing?" : "Enter plan mode?",
					header: "Plan",
					options,
					multiSelect: false,
				},
			],
		};
		this.writePending(interaction);

		void this.waitForAnswer(id, () => {
			this.rawSend(interaction);
		}, 0).then((answer) => {
			if (pending.closed || this.planPending !== pending) return;
			const selected = readAnswerLabel(answer);
			if (!selected) {
				if (this.planPending === pending) this.planPending = null;
				return;
			}

			const keys = exiting
				? selected === "Approve"
					? "\u0001"
					: "\u001b"
				: selected === "Approve"
					? "1"
					: "2";

			debug(`plan_answer tool=${toolName} label=${selected}`);
			const inject = () => {
				if (pending.closed || this.planPending !== pending) return;
				debug(
					`plan_inject keys=${JSON.stringify(keys)} readable=${process.stdin.listenerCount("readable")}`,
				);
				this.injectKey(keys);
			};
			setTimeout(inject, 800);
			setTimeout(() => {
				if (pending.closed || this.planPending !== pending) return;
				debug("plan_inject_retry");
				this.injectKey(keys);
			}, 1700);
			setTimeout(() => {
				if (this.planPending === pending) {
					pending.closed = true;
					this.planPending = null;
				}
			}, 2600);
		});
	}

	private isPlanTool(toolName: unknown): boolean {
		return toolName === "enter_plan_mode" || toolName === "exit_plan_mode";
	}

	private closePlanPending(): void {
		const pending = this.planPending;
		if (!pending) return;
		pending.closed = true;
		this.planPending = null;
		const entry = this.pending.get(pending.id);
		if (entry) entry.finish(null, "superseded");
		this.clearPending(pending.id);
		debug("plan_close");
	}

	private injectKey(sequence: string): void {
		try {
			process.stdin.unshift(Buffer.from(sequence));
			process.stdin.emit("readable");
		} catch {
			/* stdin unavailable */
		}
	}

	async answerPermission(input: PermissionInput): Promise<"allow" | "deny" | undefined> {
		const decision = await this.askPermission(input);
		debug(
			`perm_answer tool=${input.toolName} safety=${String(Boolean(input.isSafetyPrompt))} decision=${String(decision)} browsers=${this.browsers}`,
		);
		if (decision === "deny") return "deny";
		if (decision === "allow") {
			if (!input.isSafetyPrompt) return "allow";
			this.schedulePermissionAllow(input.toolName);
		}
		return undefined;
	}

	private schedulePermissionAllow(toolName: string): void {
		this.clearPermissionPending();
		const pending = { toolName, closed: false };
		this.permissionPending = pending;
		const inject = () => {
			if (pending.closed) return;
			debug(`perm_inject tool=${toolName} readable=${process.stdin.listenerCount("readable")}`);
			this.injectKey("1");
		};
		setTimeout(inject, 900);
		setTimeout(() => {
			if (!pending.closed) this.injectKey("1");
		}, 1800);
		setTimeout(() => {
			if (this.permissionPending === pending) this.permissionPending = null;
		}, 3000);
	}

	private clearPermissionPending(): void {
		if (this.permissionPending) this.permissionPending.closed = true;
		this.permissionPending = null;
	}

	async answerQuestion(input: ToolCallInput): Promise<ToolCallResult | undefined> {
		if (input.toolName === "enter_plan_mode" || input.toolName === "exit_plan_mode") {
			this.onPlanRequest(input.toolName);
			return undefined;
		}
		if (input.toolName !== "ask_user_question") return undefined;
		const questions = normalizeQuestions(input.input);
		if (!questions) return undefined;
		const answers = await this.askQuestion(questions);
		if (!answers) return undefined;
		return { result: [{ type: "text", text: formatAnswers(questions, answers) }] };
	}

	private rawSend(payload: Record<string, unknown>): void {
		if (this.socket && this.socket.readyState === 1) {
			this.socket.send(JSON.stringify(payload));
		}
	}

	private send(payload: Record<string, unknown>): void {
		if (this.socket && this.socket.readyState === 1) {
			this.socket.send(JSON.stringify(payload));
			return;
		}
		if (this.outbox.length >= OUTBOX_LIMIT) {
			this.outbox.shift();
			this.dropped += 1;
		}
		this.outbox.push(payload);
	}

	private helloPayload(): Record<string, unknown> {
		return {
			t: "hello",
			v: PROTOCOL_VERSION,
			agentId: this.agentId,
			sessionId: this.sessionId,
			name: this.cmd.getSessionName() ?? basename(this.cmd.cwd),
			cwd: this.cmd.cwd,
			model: this.cmd.getModel() ?? "",
			busy: !this.cmd.isIdle(),
		};
	}

	private sendHello(): void {
		this.rawSend(this.helloPayload());
	}

	private sendState(busy: boolean): void {
		this.rawSend({
			t: "state",
			agentId: this.agentId,
			busy,
			name: this.cmd.getSessionName() ?? basename(this.cmd.cwd),
			model: this.cmd.getModel() ?? "",
		});
	}

	private emit(key: string, update: SessionUpdate): void {
		this.seq += 1;
		this.send({ t: "update", agentId: this.agentId, seq: this.seq, key, update });
	}

	private setSnapshot(key: string, update: SessionUpdate): void {
		const existing = this.runBlocks.get(key);
		if (existing) {
			existing.update = update;
			existing.text = textOf(update);
		} else {
			this.runBlocks.set(key, { key, update, text: textOf(update) });
			this.runOrder.push(key);
		}
		this.emit(key, update);
	}

	private appendChunk(
		kind: "agent_message_chunk" | "agent_thought_chunk",
		key: string,
		delta: string,
	): void {
		const existing = this.runBlocks.get(key);
		if (!existing) {
			this.runBlocks.set(key, {
				key,
				update: { sessionUpdate: kind, content: { type: "text", text: delta } },
				text: delta,
			});
			this.runOrder.push(key);
		} else {
			existing.text += delta;
			existing.update = {
				sessionUpdate: kind,
				content: { type: "text", text: existing.text },
			};
		}
		this.seq += 1;
		this.send({
			t: "update",
			agentId: this.agentId,
			seq: this.seq,
			key,
			update: { sessionUpdate: kind, content: { type: "text", text: delta } },
		});
	}

	private snapshotForReplay(): Snapshot[] {
		return this.runOrder
			.map((key) => this.runBlocks.get(key))
			.filter((entry): entry is RunBlock => Boolean(entry))
			.map((entry) => ({ key: entry.key, update: entry.update }));
	}

	private updateTool(
		key: string,
		toolCallId: string,
		patch: Record<string, unknown>,
	): void {
		const existing = this.runBlocks.get(key);
		const base =
			existing && existing.update.sessionUpdate === "tool_call"
				? { ...existing.update }
				: {
						sessionUpdate: "tool_call",
						toolCallId,
						title: toolCallId,
						kind: "other",
						status: "pending",
					};
		const merged = { ...base, ...patch, sessionUpdate: "tool_call" } as SessionUpdate;
		this.setSnapshot(key, merged);
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retry, 5)) + Math.random() * 500;
		this.retry += 1;
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	private flushOutbox(): void {
		const queue = this.outbox;
		this.outbox = [];
		for (const payload of queue) this.rawSend(payload);
	}

	private connect(): void {
		if (this.stopped || !this.target || this.connecting) return;
		this.connecting = true;
		let ws: WebSocket;
		try {
			ws = new WebSocket(this.target);
		} catch {
			this.connecting = false;
			this.scheduleReconnect();
			return;
		}
		this.socket = ws;
		const generation = ++this.connectionId;

		ws.addEventListener("open", () => {
			if (this.connectionId !== generation) {
				try {
					ws.close();
				} catch {
					/* already closed */
				}
				return;
			}
			this.connecting = false;
			this.retry = 0;
			this.sendHello();
			this.sendSkills();
			this.sendPending();
			if (this.dropped > 0) {
				this.rawSend({ t: "gap", agentId: this.agentId, dropped: this.dropped });
				this.dropped = 0;
			}
			this.flushOutbox();
			if (this.runActive) {
				this.rawSend({
					t: "replay",
					agentId: this.agentId,
					updates: this.snapshotForReplay(),
				});
			}
		});

		ws.addEventListener("message", (event) => {
			if (this.connectionId !== generation) return;
			const data = (event as MessageEvent).data;
			if (typeof data === "string") this.handleRelayMessage(data);
		});

		ws.addEventListener("close", (event) => {
			if (this.connectionId !== generation) return;
			this.connecting = false;
			if (this.socket === ws) this.socket = null;
			if (event.code === 4001) {
				this.stopped = true;
				return;
			}
			if (!this.stopped) this.scheduleReconnect();
		});

		ws.addEventListener("error", () => {
			if (this.connectionId !== generation) return;
			try {
				ws.close();
			} catch {
				this.connecting = false;
				this.scheduleReconnect();
			}
		});
	}

	private handleRelayMessage(raw: string): void {
		let message: Record<string, unknown>;
		try {
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
			message = parsed as Record<string, unknown>;
		} catch {
			return;
		}

		if (message.t === "presence") {
			this.browsers = typeof message.browsers === "number" ? message.browsers : 0;
			if (this.browsers > 0) {
				this.sendSkills();
				this.sendPending();
			}
			return;
		}

		if (message.t === "prompt" && typeof message.text === "string") {
			const deliverAs = message.deliverAs === "follow-up" ? "follow-up" : "steer";
			this.cmd.sendUserMessage(message.text, { deliverAs });
			return;
		}

		if (message.t === "history") {
			this.serveHistory(
				String(message.requestId ?? ""),
				typeof message.limit === "number" ? message.limit : 20,
				typeof message.before === "string" ? message.before : null,
				message.chunks === true,
			);
			return;
		}

		if (message.t === "answer" && typeof message.id === "string") {
			const entry = this.pending.get(message.id);
			if (entry) entry.finish(message, "answered");
			return;
		}

		if (message.t === "error") {
			this.cmd.ui.notify(
				`transport: ${String(message.message ?? message.code ?? "relay error")}`,
			);
		}
	}

	private serveHistory(
		requestId: string,
		limit: number,
		before: string | null,
		chunks: boolean,
	): void {
		const empty = () =>
			this.rawSend({
				t: "history_page",
				agentId: this.agentId,
				requestId,
				updates: [],
				cursor: null,
				eof: true,
				uptoSeq: this.seq,
			});

		if (!this.sessionId) return empty();
		const file = findSessionFile(this.sessionId);
		if (!file) return empty();

		let entries;
		try {
			entries = loadEntries(file);
		} catch {
			this.rawSend({
				t: "error",
				code: "unsupported_session_file",
				message: "Session file is not JSONL v3.",
				requestId,
			});
			return;
		}

		let leaf: string | undefined;
		try {
			leaf = this.cmd.sessions.leafId();
		} catch {
			leaf = undefined;
		}

		const path = activePath(entries, leaf);
		const turns = groupTurns(path);
		const page = paginate(turns, limit, before);
		if ("error" in page) {
			this.rawSend({
				t: "error",
				code: page.error,
				message: "Cursor is not on the active branch.",
				requestId,
			});
			return;
		}

		const updates = entriesToUpdates(page.turns);
		if (!chunks) {
			this.rawSend({
				t: "history_page",
				agentId: this.agentId,
				requestId,
				updates: capUpdates(updates),
				cursor: page.cursor,
				eof: page.eof,
				uptoSeq: this.seq,
			});
		} else {
			this.sendHistory(requestId, updates, page.cursor, page.eof);
		}

		if (this.runActive && this.runOrder.length > 0) {
			for (const chunk of chunkUpdates(this.snapshotForReplay())) {
				this.rawSend({
					t: "replay",
					agentId: this.agentId,
					updates: chunk,
				});
			}
		}

		this.sendPending();
	}

	private pendingPath(): string | null {
		if (!this.sessionId) return null;
		return join(
			homedir(),
			".commandcode",
			"transport",
			`pending-${this.sessionId}.json`,
		);
	}

	private writePending(payload: Record<string, unknown>): void {
		const file = this.pendingPath();
		if (!file) return;
		try {
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, JSON.stringify(payload));
		} catch {
			/* ignore */
		}
	}

	private readPending(): Record<string, unknown> | null {
		const file = this.pendingPath();
		if (!file || !existsSync(file)) return null;
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8"));
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: null;
		} catch {
			return null;
		}
	}

	private clearPending(id?: string): void {
		const file = this.pendingPath();
		if (!file) return;
		if (id) {
			const current = this.readPending();
			if (current && current.id !== id) return;
		}
		try {
			unlinkSync(file);
		} catch {
			/* ignore */
		}
	}

	private sendPending(): void {
		if (!this.socket || this.socket.readyState !== 1) return;
		const pending = this.readPending();
		if (!pending) return;
		this.rawSend({ ...pending, t: "interaction", agentId: this.agentId });
	}

	private sendMirror(payload: Record<string, unknown>, toolName: string): void {
		if (!this.socket || this.socket.readyState !== 1) return;
		const id = String(payload.id ?? "");
		if (!id) return;
		this.mirrors.set(id, { toolName });
		this.rawSend(payload);
	}

	private closeMirrors(toolName: string): void {
		for (const [id, mirror] of [...this.mirrors]) {
			if (toolName && mirror.toolName !== toolName) continue;
			this.rawSend({
				t: "interaction_closed",
				agentId: this.agentId,
				id,
				reason: "answered",
			});
			this.clearPending(id);
			this.mirrors.delete(id);
		}
	}

	private sendSkills(): void {
		if (!this.socket || this.socket.readyState !== 1) return;
		if (!this.skills) this.skills = discoverSkills(this.cmd.cwd);
		this.rawSend({ t: "skills", agentId: this.agentId, skills: this.skills });
	}

	private sendHistory(
		requestId: string,
		updates: Snapshot[],
		cursor: string | null,
		eof: boolean,
	): void {
		const chunks = chunkUpdates(updates);
		if (chunks.length <= 1) {
			this.rawSend({
				t: "history_page",
				agentId: this.agentId,
				requestId,
				updates: chunks[0] ?? [],
				cursor,
				eof,
				uptoSeq: this.seq,
			});
			return;
		}

		chunks.forEach((chunk, index) => {
			this.rawSend({
				t: "history_chunk",
				agentId: this.agentId,
				requestId,
				updates: chunk,
				cursor,
				eof,
				uptoSeq: this.seq,
				final: index === chunks.length - 1,
			});
		});
	}

	private waitForAnswer(
		id: string,
		start: () => void,
		timeoutMs = INTERACTION_TIMEOUT_MS,
	): Promise<unknown> {
		return new Promise((resolve) => {
			let settled = false;
			let grace: ReturnType<typeof setTimeout> | null = null;

			const finish = (value: unknown, reason: CloseReason) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				if (grace) clearTimeout(grace);
				this.pending.delete(id);
				this.clearPending(id);
				this.rawSend({ t: "interaction_closed", agentId: this.agentId, id, reason });
				resolve(value);
			};

			const timer =
				timeoutMs > 0 ? setTimeout(() => finish(null, "timeout"), timeoutMs) : null;

			this.pending.set(id, {
				finish,
				scheduleDisconnect() {
					if (settled || grace) return;
					grace = setTimeout(() => finish(null, "disconnected"), DISCONNECT_GRACE_MS);
				},
			});

			start();
		});
	}

	private async askPermission(input: PermissionInput): Promise<"allow" | "deny" | null> {
		if (!this.socket || this.socket.readyState !== 1) return null;
		const id = `perm_${randomId(6)}`;
		const interaction = {
			t: "interaction",
			agentId: this.agentId,
			id,
			kind: "permission",
			toolName: input.toolName,
			input: input.input,
			description: input.description,
			safety: Boolean(input.isSafetyPrompt),
		};
		if (this.browsers === 0) {
			const mirror = { ...interaction, tui: true };
			this.writePending(mirror);
			this.sendMirror(mirror, input.toolName);
			return null;
		}
		const answer = await this.waitForAnswer(id, () => {
			this.writePending(interaction);
			this.rawSend(interaction);
		});
		if (!answer || typeof answer !== "object") return null;
		const decision = (answer as Record<string, unknown>).decision;
		return decision === "allow" || decision === "deny" ? decision : null;
	}

	private async askQuestion(questions: Question[]): Promise<AnswerEntry[] | null> {
		if (!this.socket || this.socket.readyState !== 1) return null;
		const id = `q_${randomId(6)}`;
		const interaction = {
			t: "interaction",
			agentId: this.agentId,
			id,
			kind: "question",
			questions,
		};
		if (this.browsers === 0) {
			const mirror = { ...interaction, tui: true };
			this.writePending(mirror);
			this.sendMirror(mirror, "ask_user_question");
			return null;
		}
		const answer = await this.waitForAnswer(id, () => {
			this.writePending(interaction);
			this.rawSend(interaction);
		});
		if (!answer || typeof answer !== "object") return null;
		const raw = (answer as Record<string, unknown>).answers;
		if (!Array.isArray(raw)) return null;
		const answers: AnswerEntry[] = [];
		for (const item of raw) {
			if (!item || typeof item !== "object") continue;
			const value = item as Record<string, unknown>;
			if (typeof value.questionIndex !== "number" || !Array.isArray(value.selectedOptions)) {
				continue;
			}
			answers.push({
				questionIndex: value.questionIndex,
				selectedOptions: value.selectedOptions.filter(
					(option): option is string => typeof option === "string",
				),
			});
		}
		return answers;
	}
}
