import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const base = process.env.BASE ?? "ws://localhost:5174";
const modPath = fileURLToPath(new URL("../dist/transport.ts", import.meta.url));
const sessionId = "sess_int";
let leafId = "entry_2";
const tempHome = mkdtempSync(join(tmpdir(), "transport-home-"));
process.env.HOME = tempHome;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const results: { name: string; ok: boolean; extra?: string }[] = [];
const check = (name: string, ok: boolean, extra = "") => {
	results.push({ name, ok, extra });
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

function collect(socket: WebSocket) {
	const queue: any[] = [];
	const waiters: any[] = [];
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String((event as MessageEvent).data));
		const index = waiters.findIndex((waiter) => waiter.match(message));
		if (index >= 0) {
			const [waiter] = waiters.splice(index, 1);
			waiter.resolve(message);
		} else {
			queue.push(message);
		}
	});
	return (match: (message: any) => boolean, timeout = 6000): Promise<any> => {
		const found = queue.findIndex(match);
		if (found >= 0) return Promise.resolve(queue.splice(found, 1)[0]);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("timeout waiting for message")), timeout);
			waiters.push({
				match,
				resolve: (value: any) => {
					clearTimeout(timer);
					resolve(value);
				},
			});
		});
	};
}

const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
const loaded = await jiti.evalModule(readFileSync(modPath, "utf8"), { filename: modPath, async: true });
const factory = typeof loaded === "function" ? loaded : (loaded as any).default;
check("jiti loads factory", typeof factory === "function");

const handlers = new Map<string, ((payload: any) => void)[]>();
const hooksList: any[] = [];
const sent: { text: string; options?: any }[] = [];
const notices: string[] = [];
let commandHandler: ((context: any) => unknown) | null = null;

const cmd = {
	name: "transport",
	cwd: "/tmp/demo",
	addCommand(command: any) {
		commandHandler = command.handler;
		return { dispose() {} };
	},
	on(event: string, handler: (payload: any) => void) {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
		return { dispose() {} };
	},
	hooks(hooks: any) {
		hooksList.push(hooks);
		return { dispose() {} };
	},
	sessions: { leafId: () => leafId },
	sendUserMessage(text: string, options?: any) {
		sent.push({ text, options });
	},
	getSessionName: () => "demo session",
	getModel: () => "test-model",
	isIdle: () => false,
	ui: { notify: (message: string) => notices.push(message) },
};

factory(cmd);

const emit = (event: string, payload: any) => {
	for (const handler of handlers.get(event) ?? []) handler(payload);
};

check("command registered", typeof commandHandler === "function");
hooksList[0].onSessionStart?.({ source: "startup", sessionId });

const browser = new WebSocket(`${base}/ws`);
const nextBrowser = collect(browser);
await new Promise((resolve, reject) => {
	browser.addEventListener("open", () => resolve(null));
	browser.addEventListener("error", () => reject(new Error("browser ws error")));
});

const handler = commandHandler as (context: any) => unknown;
handler({ args: new URL(base).host, ui: cmd.ui, cwd: cmd.cwd });

const findMine = (message: any) =>
	(message.sessions ?? []).find(
		(candidate: any) => candidate.sessionId === sessionId && candidate.name === "demo session",
	);

const sessions = await nextBrowser((message) => message.t === "sessions" && Boolean(findMine(message)));
const agentId = findMine(sessions).agentId;
check(
	"hello registers session",
	findMine(sessions).model === "test-model",
	JSON.stringify(findMine(sessions)),
);

hooksList[0].transformMessage?.({
	message: { role: "user", content: [{ type: "text", text: "hello user" }] },
	state: {},
});
emit("run_start", { sessionId });
const busy = await nextBrowser(
	(message) => message.t === "sessions" && findMine(message)?.busy === true,
);
check("run_start marks busy", findMine(busy).busy === true);

const userChunk = await nextBrowser(
	(message) =>
		message.t === "update" &&
		message.agentId === agentId &&
		message.update.sessionUpdate === "user_message_chunk",
);
check(
	"user message echoed at run start",
	userChunk.update.content.text === "hello user",
	JSON.stringify(userChunk.update.content),
);

emit("text_delta", { delta: "hello from agent" });
const chunk = await nextBrowser(
	(message) =>
		message.t === "update" &&
		message.agentId === agentId &&
		message.update.sessionUpdate === "agent_message_chunk",
);
check("text_delta becomes agent_message_chunk", chunk.update.content.text === "hello from agent");

emit("thinking_delta", { delta: "pondering" });
const thought = await nextBrowser(
	(message) =>
		message.t === "update" &&
		message.agentId === agentId &&
		message.update.sessionUpdate === "agent_thought_chunk",
);
check("thinking_delta becomes agent_thought_chunk", thought.update.content.text === "pondering");

emit("tool_queued", { toolCallId: "tc_1", toolName: "read_file", input: { file_path: "/tmp/demo/a.txt" } });
const toolCall = await nextBrowser(
	(message) =>
		message.t === "update" && message.agentId === agentId && message.update.sessionUpdate === "tool_call",
);
check(
	"tool_queued becomes tool_call",
	toolCall.update.status === "pending" && toolCall.update.kind === "read",
	toolCall.update.title,
);

emit("tool_completed", { toolCallId: "tc_1", toolName: "read_file", result: [{ type: "text", text: "file body" }] });
const done = await nextBrowser(
	(message) =>
		message.t === "update" &&
		message.agentId === agentId &&
		message.update.sessionUpdate === "tool_call" &&
		message.update.status === "completed",
);
check("tool_completed becomes completed", JSON.stringify(done.update.content).includes("file body"));

emit("run_end", {});
const committed = await nextBrowser(
	(message) => message.t === "run_committed" && message.agentId === agentId,
);
check("run_end sends run_committed", typeof committed.runId === "string" && committed.runId.length > 0);

browser.send(
	JSON.stringify({ t: "prompt", agentId, text: "hi there", deliverAs: "steer" }),
);
await wait(250);
check(
	"browser prompt reaches sendUserMessage",
	sent.length === 1 && sent[0].text === "hi there" && sent[0].options?.deliverAs === "steer",
);

mkdirSync(join(tempHome, ".commandcode", "projects", "demo"), { recursive: true });
const file = join(tempHome, ".commandcode", "projects", "demo", `${sessionId}.jsonl`);
const lines = [
	{ type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/demo" },
	{
		type: "message",
		id: "entry_1",
		parentId: null,
		timestamp: "2026-01-01T00:00:01.000Z",
		message: { role: "user", content: [{ type: "text", text: "old question" }] },
	},
	{
		type: "message",
		id: "entry_2",
		parentId: "entry_1",
		timestamp: "2026-01-01T00:00:02.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "old answer" }] },
	},
];
writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

browser.send(
	JSON.stringify({
		t: "history",
		agentId,
		requestId: "req_1",
		limit: 20,
		before: null,
	}),
);
const page = await nextBrowser(
	(message) =>
		message.t === "history_page" && message.agentId === agentId && message.requestId === "req_1",
);
check(
	"history page served from jsonl",
	page.updates.length === 2 && page.eof === true,
	JSON.stringify(page.updates.map((item: any) => item.key)),
);
check("history cursor is first entry", page.cursor === "entry_1", String(page.cursor));

const bigText = "x".repeat(32 * 1024);
const bigLines: Record<string, unknown>[] = [];
let parentId = "entry_2";
let lastBigId = "entry_2";
for (let index = 0; index < 30; index += 1) {
	const userId = `big_u_${index}`;
	const assistantId = `big_a_${index}`;
	bigLines.push({
		type: "message",
		id: userId,
		parentId,
		timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 2)).toISOString(),
		message: { role: "user", content: [{ type: "text", text: `question ${index}` }] },
	});
	bigLines.push({
		type: "message",
		id: assistantId,
		parentId: userId,
		timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 2 + 1)).toISOString(),
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: bigText },
				{ type: "text", text: bigText },
			],
		},
	});
	parentId = assistantId;
	lastBigId = assistantId;
}
appendFileSync(file, bigLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
leafId = lastBigId;

browser.send(
	JSON.stringify({
		t: "history",
		agentId,
		requestId: "req_big",
		limit: 20,
		before: null,
		chunks: true,
	}),
);
const bigUpdates: any[] = [];
let bigChunks = 0;
let bigFinal: any = null;
for (let index = 0; index < 12; index += 1) {
	const part = await nextBrowser(
		(message) =>
			message.agentId === agentId &&
			message.requestId === "req_big" &&
			(message.t === "history_chunk" || message.t === "history_page"),
	);
	bigUpdates.push(...part.updates);
	if (part.t === "history_chunk") bigChunks += 1;
	if (part.t === "history_page" || part.final) {
		bigFinal = part;
		break;
	}
}
check("large history is chunked", bigChunks > 1, String(bigChunks));
check(
	"large history keeps the newest update",
	bigUpdates.at(-1)?.key === `e:${lastBigId}:t1`,
	String(bigUpdates.at(-1)?.key),
);
check("large history is not marked eof", bigFinal?.eof === false, String(bigFinal?.eof));

await wait(300);
const permissionPromise = hooksList[0].onPermissionRequest({
	toolName: "shell_command",
	input: { command: "ls" },
	description: "run ls",
	isSafetyPrompt: false,
});
const permission = await nextBrowser(
	(message) =>
		message.t === "interaction" && message.agentId === agentId && message.kind === "permission",
);
check("permission interaction reaches web", permission.toolName === "shell_command" && permission.safety === false);
browser.send(JSON.stringify({ t: "answer", agentId: permission.agentId, id: permission.id, decision: "allow" }));
const decision = await permissionPromise;
check("permission answer resolves allow", decision === "allow", String(decision));

const safetyPromise = hooksList[0].onPermissionRequest({
	toolName: "write_file",
	input: { file_path: "/etc/passwd" },
	description: "sensitive",
	isSafetyPrompt: true,
});
const safety = await nextBrowser(
	(message) =>
		message.t === "interaction" && message.agentId === agentId && message.safety === true,
);
browser.send(JSON.stringify({ t: "answer", agentId: safety.agentId, id: safety.id, decision: "allow" }));
const safetyDecision = await safetyPromise;
check("safety prompt ignores allow", safetyDecision === undefined, String(safetyDecision));

const questionPromise = hooksList[0].beforeToolCall({
	toolCallId: "tc_q",
	toolName: "ask_user_question",
	input: {
		questions: [
			{
				question: "Pick one?",
				header: "Pick",
				options: [
					{ label: "A", description: "first" },
					{ label: "B", description: "second" },
				],
				multiSelect: false,
			},
		],
	},
	state: {},
});
const question = await nextBrowser(
	(message) =>
		message.t === "interaction" && message.agentId === agentId && message.kind === "question",
);
check("question interaction reaches web", question.questions[0].options.length === 2);
browser.send(
	JSON.stringify({
		t: "answer",
		agentId: question.agentId,
		id: question.id,
		answers: [{ questionIndex: 0, selectedOptions: ["B"] }],
	}),
);
const questionResult: any = await questionPromise;
const text = questionResult?.result?.[0]?.text;
check(
	"question result matches host format",
	text === "Pick one? → B\n\nContinue with the user's answers in mind.",
	JSON.stringify(text),
);

browser.close();
await wait(200);
rmSync(tempHome, { recursive: true, force: true });

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
