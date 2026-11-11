const base = process.env.BASE ?? "ws://localhost:5174";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const agentId = `agent_${Date.now().toString(36)}`;

function open(url) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.addEventListener("open", () => resolve(socket));
		socket.addEventListener("error", (event) => reject(new Error(String(event.message ?? "ws error"))));
	});
}

function collect(socket) {
	const queue = [];
	const waiters = [];
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		const index = waiters.findIndex((waiter) => waiter.match(message));
		if (index >= 0) {
			const [waiter] = waiters.splice(index, 1);
			waiter.resolve(message);
		} else {
			queue.push(message);
		}
	});
	return {
		next(match, timeout = 5000) {
			const found = queue.findIndex(match);
			if (found >= 0) return Promise.resolve(queue.splice(found, 1)[0]);
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("timeout waiting for message")), timeout);
				waiters.push({
					match,
					resolve: (value) => {
						clearTimeout(timer);
						resolve(value);
					},
				});
			});
		},
	};
}

const results = [];
const check = (name, ok, extra = "") => {
	results.push({ name, ok, extra });
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const mine = (message) => (message.sessions ?? []).find((session) => session.agentId === agentId);
const fromMine = (message) => message.agentId === agentId;

const agent = await open(`${base}/agent`);
const browser = await open(`${base}/ws`);
const observer = await open(`${base}/ws`);
const agentIn = collect(agent);
const browserIn = collect(browser);
const observerIn = collect(observer);

browser.send(JSON.stringify({ t: "ping" }));
const pong = await browserIn.next((message) => message.t === "pong");
check("browser ping/pong", pong.t === "pong");

agent.send(
	JSON.stringify({
		t: "hello",
		v: 1,
		agentId,
		sessionId: "sess_test",
		name: "demo",
		cwd: "/tmp/demo",
		model: "test-model",
		busy: false,
	}),
);
const ack = await agentIn.next((message) => message.t === "hello_ack");
check("agent hello_ack", ack.v === 1);

const sessions = await browserIn.next(
	(message) => message.t === "sessions" && Boolean(mine(message)),
);
const session = mine(sessions);
check(
	"sessions broadcast",
	session?.sessionId === "sess_test" && session?.name === "demo",
	JSON.stringify(session),
);

const presence = await agentIn.next((message) => message.t === "presence");
const initialBrowsers = presence.browsers;
check("presence to agent", typeof presence.browsers === "number", `browsers=${presence.browsers}`);

agent.send(
	JSON.stringify({
		t: "update",
		agentId,
		seq: 1,
		key: "e:1",
		update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
	}),
);
const update = await browserIn.next((message) => message.t === "update" && fromMine(message));
check("update forwarded to browser", update.key === "e:1" && update.seq === 1);

browser.send(JSON.stringify({ t: "prompt", agentId, text: "hello", deliverAs: "steer" }));
const prompt = await agentIn.next((message) => message.t === "prompt");
check("prompt forwarded to agent", prompt.text === "hello" && prompt.deliverAs === "steer");

browser.send(JSON.stringify({ t: "history", agentId, requestId: "r1", limit: 20, before: null }));
const history = await agentIn.next((message) => message.t === "history");
check("history forwarded to agent", history.requestId === "r1" && history.limit === 20);

agent.send(
	JSON.stringify({
		t: "interaction",
		agentId,
		id: "perm_1",
		kind: "permission",
		toolName: "shell_command",
		input: { command: "ls" },
		description: "run ls",
		safety: false,
	}),
);
const interaction = await browserIn.next(
	(message) => message.t === "interaction" && fromMine(message),
);
check("interaction forwarded to browser", interaction.id === "perm_1");

const waiting = await browserIn.next(
	(message) => message.t === "sessions" && mine(message)?.pending === "perm_1",
);
check("pending marker in sessions", Boolean(waiting));

browser.send(JSON.stringify({ t: "answer", agentId, id: "perm_1", decision: "allow" }));
const answer = await agentIn.next((message) => message.t === "answer");
check("answer forwarded to agent", answer.decision === "allow");

agent.send(JSON.stringify({ t: "interaction_closed", agentId, id: "perm_1", reason: "answered" }));
const cleared = await browserIn.next(
	(message) =>
		message.t === "sessions" && Boolean(mine(message)) && !("pending" in mine(message)),
);
check("pending marker cleared", Boolean(cleared));

const observerSaw = await observerIn.next(
	(message) => message.t === "sessions" && Boolean(mine(message)),
);
check("observer sees session", Boolean(mine(observerSaw)));

browser.send(JSON.stringify({ t: "prompt", agentId: "missing_agent_id", text: "x" }));
const error = await browserIn.next((message) => message.t === "error");
check("unknown agent returns error", error.code === "agent_offline", error.code);

browser.close();
const presenceDown = await agentIn.next(
	(message) => message.t === "presence" && message.browsers < initialBrowsers,
);
check(
	"presence drops when browser closes",
	presenceDown.browsers < initialBrowsers,
	`${initialBrowsers} -> ${presenceDown.browsers}`,
);

agent.close();
const gone = await observerIn.next((message) => message.t === "sessions" && !mine(message));
check("agent close removes session", !mine(gone));

observer.close();
await wait(50);

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
