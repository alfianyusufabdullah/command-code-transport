// The relay socket lives in bridge/bridge.mjs: the hooks runtime has no WebSocket.
// `$` may only be called as `$.noun.method(...)` inside a hook, so helpers get closures.
import type { Register } from "claude-code";

import {
	PROTOCOL_VERSION,
	SessionMirror,
	capUpdates,
	chunkUpdates,
	parseHost,
	randomId,
	truncate,
} from "../../core";
import type { Message, SkillInfo, Snapshot } from "../../core";

import { pageTurns, rowsToTurns } from "./history";
import type { SessionRow } from "./history";
import {
	AGENT_TOOLS,
	PERSON_ONLY,
	parseTaskNotification,
	planFromTodos,
	resultText,
	textContent,
	toolCallUpdate,
	toolInput,
	toolTitle,
} from "./vocab";

const TARGET = { plugin: "transport", key: "target" } as const;
const AGENT = { plugin: "transport", key: "agentId" } as const;

const ANSWER_TIMEOUT_MS = 30 * 60 * 1000;
const ASK_SETTLE_MS = 400;
const AUTO_SETTLE_MS = 2500;
const SUBAGENT_LINES = 30;

type Fetch = (url: string, init?: Record<string, unknown>) => Promise<{ text: string }>;
type Check = (args: { tool: string; input: unknown }) => Promise<{ decision: string; reason?: string }>;
type Io = {
	fetch: Fetch;
	spawn: (argv: string[]) => AsyncIterable<{ stream: string; text: string }>;
	messages: () => Promise<SessionRow[]>;
	commands: () => Promise<{ name: string; description?: string; source: string }[]>;
	check: Check;
	submit: (text: string) => Promise<unknown>;
	sessionId: () => Promise<string>;
	cwd: () => Promise<string>;
	model: () => Promise<string>;
	runtimeDir: () => Promise<string | undefined>;
	root: string;
	log: (text: string) => void;
	status: (text: string | undefined) => void;
	toast: (text: string) => void;
};

let io: Io | null = null;
let sock = "";
let agentId = "";
let connected = false;
let mirror = new SessionMirror("", send);
let queue: Message[] = [];
let flushing = false;
let mode = "";
let title = "";
let cwdPath = "";
let hintNow = "";
const pending = new Map<string, Message>();
const asks = new Map<string, (checked: unknown) => void>();
const started = new Set<string>();
const startWaiters = new Map<string, () => void>();
const agentCalls = new Map<string, { key: string; agentId?: string; lines: string[] }>();
const subagentParent = new Map<string, string>();
const asyncAgents = new Map<string, { key: string; name: string; input: Record<string, unknown> }>();
const asyncLines = new Map<string, string[]>();

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;
const active = () => io !== null && connected;

async function post(path: string, body: unknown) {
	if (!io || !sock) return null;
	return io.fetch(`http://bridge${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		socketPath: sock,
	});
}

function send(message: Message): void {
	queue.push(message);
	if (flushing) return;
	flushing = true;
	void (async () => {
		try {
			while (queue.length) {
				const batch = queue;
				queue = [];
				await post("/send", batch);
			}
		} catch (error) {
			io?.log(`transport: send failed ${String(error)}`);
		} finally {
			flushing = false;
		}
	})();
}

function debug(entry: Message): void {
	if (io && sock) void post("/debug", entry);
}

async function waitAnswer(fetch: Fetch, id: string): Promise<Message | null> {
	const deadline = Date.now() + ANSWER_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const response = await fetch(`http://bridge/wait?id=${encodeURIComponent(id)}`, { socketPath: sock });
		let body: Message | null = null;
		try {
			body = JSON.parse(response.text) as Message;
		} catch {
			return null;
		}
		if (body?.cancelled) return null;
		if (body && !body.pending) return body;
	}
	return null;
}

function openInteraction(message: Message): void {
	pending.set(String(message.id), message);
	send(message);
}

function closeInteraction(id: string, reason: string): void {
	pending.delete(id);
	send({ t: "interaction_closed", agentId, id, reason });
}

function noteMode(next: string): void {
	if (!next || next === mode) return;
	mode = next;
	mirror.emit(`mode:${randomId(6)}`, { sessionUpdate: "current_mode_update", currentModeId: mode });
}

async function detectMode(check: Check, hint: string): Promise<void> {
	if (/for shortcuts/i.test(hint)) return noteMode("default");
	if (!/shift\+tab/i.test(hint)) return;
	const write = await check({
		tool: "Write",
		input: { file_path: `${cwdPath}/.transport-mode-probe`, content: "" },
	});
	const bash = await check({ tool: "Bash", input: { command: "curl -sI https://example.invalid" } });
	noteMode(
		write.decision === "allow"
			? bash.decision === "allow"
				? "bypassPermissions"
				: "acceptEdits"
			: /cannot write/i.test(write.reason ?? "")
				? "plan"
				: "auto",
	);
}

function noteTitle(text: string): void {
	if (title || !text.trim()) return;
	title = text.trim().split("\n")[0]!.slice(0, 60);
	mirror.emit("session:title", { sessionUpdate: "session_info_update", title });
	send({ t: "state", agentId, busy: mirror.runActive, name: title });
}

function noteRunning(calls: { tool_use_id?: unknown; isRunning?: unknown }[]): void {
	for (const call of calls) {
		if (!call?.isRunning || typeof call.tool_use_id !== "string") continue;
		started.add(call.tool_use_id);
		startWaiters.get(call.tool_use_id)?.();
	}
}

function subagentLine(subagent: string, line: string): void {
	let parent = subagentParent.get(subagent);
	if (!parent) {
		for (const [id, call] of agentCalls) {
			if (call.agentId) continue;
			call.agentId = subagent;
			parent = id;
			subagentParent.set(subagent, id);
			break;
		}
	}
	if (!parent) {
		const key = `agent:${subagent}`;
		const lines = [...(asyncLines.get(key) ?? []), line];
		asyncLines.set(key, lines);
		mirror.emit(key, {
			sessionUpdate: "tool_call",
			toolCallId: key,
			title: `Subagent ${subagent.slice(0, 8)}`,
			kind: "think",
			status: "in_progress",
			content: textContent(lines.slice(-SUBAGENT_LINES).join("\n")),
		});
		return;
	}
	const running = agentCalls.get(parent);
	if (running) {
		running.lines.push(line);
		const block = mirror.block(running.key);
		if (block) {
			mirror.setSnapshot(running.key, {
				...block.update,
				content: textContent(running.lines.slice(-SUBAGENT_LINES).join("\n")),
			});
		}
		return;
	}
	const launched = asyncAgents.get(parent);
	if (!launched) return;
	const lines = [...(asyncLines.get(parent) ?? []), line];
	asyncLines.set(parent, lines);
	mirror.emit(
		launched.key,
		toolCallUpdate(parent, launched.name, launched.input, "in_progress", {
			title: `${toolTitle(launched.name, launched.input)} (background)`,
			content: textContent(lines.slice(-SUBAGENT_LINES).join("\n")),
		}),
	);
}

function sendHistoryFrames(requestId: string, updates: Snapshot[], cursor: string | null, eof: boolean, chunks: boolean): void {
	if (!chunks) {
		send({ t: "history_page", agentId, requestId, updates: capUpdates(updates), cursor, eof, uptoSeq: mirror.seq });
		return;
	}
	const frames = chunkUpdates(updates);
	frames.forEach((frame, index) => {
		send({
			t: "history_chunk",
			agentId,
			requestId,
			updates: frame,
			cursor,
			eof,
			uptoSeq: mirror.seq,
			final: index === frames.length - 1,
		});
	});
}

async function serveHistory(host: Io, message: Message): Promise<void> {
	const requestId = String(message.requestId ?? "");
	const limit = typeof message.limit === "number" && message.limit > 0 ? message.limit : 20;
	const before = typeof message.before === "string" ? Number(message.before) : null;
	const turns = rowsToTurns(await host.messages());
	if (mirror.runActive && mirror.hasBlocks) turns.pop();
	const page = pageTurns(turns, limit, before);
	sendHistoryFrames(requestId, page.updates, page.cursor, page.eof, message.chunks === true);
	if (before !== null) return;
	if (mirror.runActive && mirror.hasBlocks) send({ t: "replay", agentId, updates: mirror.snapshot() });
	for (const interaction of pending.values()) send(interaction);
}

async function sendSkills(host: Io): Promise<void> {
	const skills: SkillInfo[] = (await host.commands())
		.filter((command) => command.source !== "builtin")
		.map((command) => ({
			name: command.name,
			description: command.description ?? "",
			source: command.source === "user" ? "user" : "project",
		}));
	send({ t: "skills", agentId, skills });
}

async function onRelay(host: Io, message: Message): Promise<void> {
	if (message.t === "presence") {
		if (typeof message.browsers === "number" && message.browsers > 0) await sendSkills(host);
		return;
	}
	if (message.t === "prompt" && typeof message.text === "string") {
		void host.submit(message.text);
		return;
	}
	if (message.t === "history") return serveHistory(host, message);
	if (message.t === "error") host.toast(`transport: ${String(message.message ?? message.code)}`);
}

async function hello(host: Io): Promise<void> {
	const cwd = await host.cwd();
	cwdPath = cwd;
	await post("/hello", {
		t: "hello",
		v: PROTOCOL_VERSION,
		agentId,
		harness: "claude-code",
		experimental: true,
		sessionId: await host.sessionId(),
		name: title || basename(cwd),
		cwd,
		model: await host.model(),
		busy: mirror.runActive,
	});
	if (mode) mirror.emit(`mode:${randomId(6)}`, { sessionUpdate: "current_mode_update", currentModeId: mode });
	if (hintNow) void detectMode(host.check, hintNow);
	for (const interaction of pending.values()) send(interaction);
}

function start(host: Io, target: string, id: string): void {
	agentId = id;
	if (io) return;
	io = host;
	mirror = new SessionMirror(agentId, send);
	const label = target.replace(/^wss?:\/\//, "").replace(/\/agent$/, "");
	void (async () => {
		const dir = (await host.runtimeDir()) ?? "/tmp";
		sock = `${dir}/transport-${agentId}.sock`;
		const child = host.spawn(["node", `${host.root}/bridge/bridge.mjs`, sock, target]);
		let buffer = "";
		for await (const piece of child) {
			if (piece.stream === "stderr") {
				host.log(piece.text.trim());
				continue;
			}
			buffer += piece.text;
			let newline: number;
			while ((newline = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				let item: Message;
				try {
					item = JSON.parse(line) as Message;
				} catch {
					continue;
				}
				try {
					if (item.kind === "ready") await hello(host);
					else if (item.kind === "status") {
						connected = item.connected === true;
						host.status(`transport ${connected ? "●" : "○"} ${label} · experimental`);
						if (connected) for (const interaction of pending.values()) send(interaction);
					} else if (item.kind === "relay") await onRelay(host, item.msg as Message);
				} catch (error) {
					host.log(`transport: ${String(error)}`);
				}
			}
		}
		if (io === host) io = null;
		connected = false;
		host.status(undefined);
	})();
}

export const register: Register = (on) => {
	on("session.start", async ($, e, next) => {
		const result = await next(e);
		await $.command.register({
			name: "transport",
			description: "Expose this session to the transport web relay (experimental)",
			argumentHint: "<host>",
		});
		const stored = (await $.state.get(TARGET)).value;
		const target = parseHost(stored ?? (await $.env.get("TRANSPORT_TARGET")) ?? "");
		if (!target) return result;
		let id = (await $.state.get(AGENT)).value;
		if (!id) {
			id = `cc_${randomId(10)}`;
			await $.state.set(AGENT, id);
		}
		start(
			{
				fetch: (url, init) => $.http.fetch(url, init),
				spawn: (argv) => $.process.spawn({ argv }),
				messages: () => $.session.messages(),
				commands: () => $.command.list(),
				check: (args) => $.tool.check(args),
				submit: (text) => $.prompt.submit({ text, asUser: true }),
				sessionId: () => $.session.id(),
				cwd: () => $.session.cwd(),
				model: () => $.session.model(),
				runtimeDir: () => $.env.get("XDG_RUNTIME_DIR"),
				root: $.plugin.root,
				log: (text) => void $.ui.log(text, { to: "debug" }),
				status: (text) => void $.ui.status(text),
				toast: (text) => void $.ui.toast(text),
			},
			target,
			id,
		);
		return result;
	});

	on("command.run", { command: "transport" }, async ($, e) => {
		const target = parseHost(e.args);
		if (!target) return { text: "Usage: /transport <host>" };
		await $.state.set(TARGET, e.args.trim());
		let id = (await $.state.get(AGENT)).value;
		if (!id) {
			id = `cc_${randomId(10)}`;
			await $.state.set(AGENT, id);
		}
		start(
			{
				fetch: (url, init) => $.http.fetch(url, init),
				spawn: (argv) => $.process.spawn({ argv }),
				messages: () => $.session.messages(),
				commands: () => $.command.list(),
				check: (args) => $.tool.check(args),
				submit: (text) => $.prompt.submit({ text, asUser: true }),
				sessionId: () => $.session.id(),
				cwd: () => $.session.cwd(),
				model: () => $.session.model(),
				runtimeDir: () => $.env.get("XDG_RUNTIME_DIR"),
				root: $.plugin.root,
				log: (text) => void $.ui.log(text, { to: "debug" }),
				status: (text) => void $.ui.status(text),
				toast: (text) => void $.ui.toast(text),
			},
			target,
			id,
		);
		return { text: `Transport (experimental): ${e.args.trim()}` };
	});

	on("turn.start", async ($, e, next) => {
		if (e.agentId || !active()) return next(e);
		mirror.beginRun(e.turnId);
		const note = parseTaskNotification(e.text);
		if (note) {
			const launched = asyncAgents.get(note.toolUseId);
			if (launched) {
				mirror.emit(
					launched.key,
					toolCallUpdate(note.toolUseId, launched.name, launched.input, note.status === "completed" ? "completed" : "failed", {
						title: `${toolTitle(launched.name, launched.input)} (background)`,
						content: textContent([...(asyncLines.get(note.toolUseId) ?? []), note.summary].filter(Boolean).join("\n")),
					}),
				);
				asyncAgents.delete(note.toolUseId);
			}
			mirror.setSnapshot(`run:${e.turnId}:user`, {
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: `↩ ${note.summary || "Background task finished"}` },
			});
		} else if (e.text.trim()) {
			noteTitle(e.text);
			mirror.setSnapshot(`run:${e.turnId}:user`, {
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: truncate(e.text) },
			});
		}
		send({ t: "state", agentId, busy: true });
		return next(e);
	});

	on("turn.step", async function* ($, e, next) {
		const stream = next(e);
		if (e.agentId || !active()) return yield* stream;
		for await (const chunk of stream) {
			const key = `run:${mirror.runId}:s${e.index}:b${"index" in chunk ? chunk.index : 0}`;
			if (chunk.kind === "text" && chunk.text) mirror.appendChunk("agent_message_chunk", key, chunk.text);
			else if (chunk.kind === "thinking" && chunk.text) mirror.appendChunk("agent_thought_chunk", key, chunk.text);
			yield chunk;
		}
		return await stream.result;
	});

	on("turn.complete", async ($, e, next) => {
		if (e.agentId || !mirror.runActive) return next(e);
		mirror.endRun();
		send({ t: "run_committed", agentId, runId: mirror.runId });
		send({ t: "state", agentId, busy: false });
		return next(e);
	});

	on("ui.render", { component: "PromptHint" }, async ($, e, next) => {
		const hint = String(e.props.hint ?? "");
		if (hint !== hintNow) {
			hintNow = hint;
			if (active()) void detectMode((args) => $.tool.check(args), hint);
		}
		return next(e);
	});

	on("ui.render", { component: "ToolGroup" }, async ($, e, next) => {
		if (active()) noteRunning([...e.props.calls]);
		return next(e);
	});
	on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
		if (active()) noteRunning([{ tool_use_id: e.requestId, isRunning: e.props.isRunning }]);
		return next(e);
	});

	on("tool.check", async ($, e, next) => {
		const verdict = await next(e);
		if (e.tool_use_id && verdict.decision === "ask" && e.approver === "person") asks.get(e.tool_use_id)?.(e.input);
		return verdict;
	});

	on("tool.call", async ($, e, next) => {
		if (!active() || !e.tool_use_id) return next(e);
		const id = e.tool_use_id;
		const name = String(e.tool);
		const input = toolInput(e as unknown as Record<string, unknown>);
		const subagent = e.agentId;
		const fetch: Fetch = (url, init) => $.http.fetch(url, init);
		const key = `run:${mirror.runId}:t:${id}`;

		if (subagent) subagentLine(subagent, `↳ ${toolTitle(name, input)}`);
		else {
			mirror.setSnapshot(key, toolCallUpdate(id, name, input, "in_progress"));
			if (name === "TodoWrite") {
				const plan = planFromTodos(input);
				if (plan) mirror.setSnapshot(`run:${mirror.runId}:plan`, plan);
			}
			if (AGENT_TOOLS.has(name)) agentCalls.set(id, { key, lines: [] });
		}

		let result: any;
		if (name === "AskUserQuestion" && !subagent) {
			const qid = `q_${randomId(6)}`;
			const asked = (input.questions ?? []) as {
				question: string;
				header: string;
				multiSelect?: boolean;
				options?: { label: string; description?: string; preview?: string }[];
			}[];
			const questions = asked.map((question) => ({
				question: question.question,
				header: question.header,
				multiSelect: Boolean(question.multiSelect),
				options: (question.options ?? []).map((option) => ({
					label: option.label,
					description: option.description,
					preview: option.preview,
				})),
			}));
			openInteraction({ t: "interaction", agentId, id: qid, kind: "question", questions });
			const terminal = next(e).then((value: unknown) => ({ from: "tui" as const, value }));
			const web = waitAnswer(fetch, qid).then((answer) => ({ from: "web" as const, answer }));
			const first = await Promise.race([terminal, web]);
			const answered = first.from === "web" ? (first.answer?.answers as { questionIndex: number; selectedOptions?: string[] }[] | undefined) : undefined;
			if (Array.isArray(answered)) {
				closeInteraction(qid, "answered");
				const answers: Record<string, string> = {};
				for (const entry of answered) {
					const question = questions[entry.questionIndex];
					if (question) answers[question.question] = (entry.selectedOptions ?? []).join(", ");
				}
				mirror.setSnapshot(key, toolCallUpdate(id, name, input, "completed", { content: textContent(JSON.stringify(answers)) }));
				// Returning while next() is pending aborts the terminal dialog.
				return { result: { questions: input.questions, answers } } as never;
			}
			if (first.from === "tui") void post(`/cancel?id=${qid}`, {});
			closeInteraction(qid, "answered");
			result = first.from === "tui" ? first.value : (await terminal).value;
		} else {
			let checked: unknown = input;
			const asked = new Promise<"ask">((resolve) =>
				asks.set(id, (value) => {
					checked = value;
					resolve("ask");
				}),
			);
			const terminal = next(e).then((value: unknown) => ({ from: "tui" as const, value }));
			let first = await Promise.race([terminal, asked]);
			asks.delete(id);
			if (first === "ask") {
				const settled = await Promise.race([
					terminal,
					$.clock.sleep(mode === "auto" ? AUTO_SETTLE_MS : ASK_SETTLE_MS).then(() => "ask" as const),
				]);
				if (settled !== "ask") first = settled;
			}
			if (first !== "ask") result = first.value;
			else if (PERSON_ONLY.has(name)) {
				const pid = `perm_${randomId(6)}`;
				openInteraction({ t: "interaction", agentId, id: pid, kind: "permission", toolName: name, input: checked, safety: false, tui: true });
				result = (await terminal).value;
				closeInteraction(pid, "answered");
			} else {
				const pid = `perm_${randomId(6)}`;
				openInteraction({
					t: "interaction",
					agentId,
					id: pid,
					kind: "permission",
					toolName: subagent ? `${name} (subagent)` : name,
					input: checked,
					safety: false,
				});
				const web = waitAnswer(fetch, pid).then((answer) => ({ from: "web" as const, answer }));
				const run = new Promise<{ from: "started" }>((resolve) => {
					if (started.has(id)) resolve({ from: "started" });
					else startWaiters.set(id, () => resolve({ from: "started" }));
				});
				const second = await Promise.race([terminal, web, run]);
				startWaiters.delete(id);
				const decision = second.from === "web" ? second.answer?.decision : undefined;
				debug({ ev: "decided", pid, by: second.from, decision });
				if (second.from === "started" || (second.from === "web" && started.has(id))) {
					void post(`/cancel?id=${pid}`, {});
					closeInteraction(pid, "answered");
					result = (await terminal).value;
				} else if (decision === "deny") {
					closeInteraction(pid, "answered");
					result = { deny: "Denied from the transport web UI" };
				} else if (decision === "allow") {
					closeInteraction(pid, "answered");
					result = await $.tool.call({ tool: name, ...input } as never);
				} else {
					if (second.from === "tui") void post(`/cancel?id=${pid}`, {});
					closeInteraction(pid, "answered");
					result = second.from === "tui" ? second.value : (await terminal).value;
				}
				started.delete(id);
			}
		}

		const failed = result?.deny !== undefined || result?.isError === true;
		if (subagent) {
			if (failed) subagentLine(subagent, `  ✗ ${resultText(result).slice(0, 120)}`);
			return result;
		}
		if (!failed && name === "ExitPlanMode") noteMode("default");
		if (!failed && name === "EnterPlanMode") noteMode("plan");
		const call = agentCalls.get(id);
		agentCalls.delete(id);
		const launched = call ? /agentId: (\w+)/.exec(resultText(result))?.[1] : undefined;
		if (launched) {
			subagentParent.set(launched, id);
			asyncAgents.set(id, { key, name, input });
		}
		mirror.setSnapshot(
			key,
			toolCallUpdate(id, name, input, failed ? "failed" : "completed", {
				content: textContent([...(call?.lines ?? []), resultText(result)].filter(Boolean).join("\n")),
			}),
		);
		return result;
	});
};
