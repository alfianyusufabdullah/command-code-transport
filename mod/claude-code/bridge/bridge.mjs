import { appendFileSync, existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";

const [socketPath, target] = process.argv.slice(2);
if (!socketPath || !target) {
	process.stderr.write("usage: bridge.mjs <socket> <ws-url>\n");
	process.exit(2);
}

const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const log = (line) => process.stderr.write(`[transport bridge] ${line}\n`);

let ws = null;
let hello = null;
let retry = 0;
const outbox = [];
const answers = new Map();
const waiters = new Map();

function reply(res, status, body) {
	if (res.writableEnded) return;
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

function deliver(id, payload) {
	const list = waiters.get(id);
	if (!list || list.length === 0) {
		answers.set(id, payload);
		return;
	}
	waiters.delete(id);
	for (const res of list) reply(res, 200, payload);
}

function rawSend(message) {
	if (ws?.readyState !== 1) return false;
	ws.send(JSON.stringify(message));
	return true;
}

function send(message) {
	if (rawSend(message)) return;
	if (outbox.length > 2000) outbox.shift();
	outbox.push(message);
}

function connect() {
	const socket = new WebSocket(target);
	ws = socket;
	socket.addEventListener("open", () => {
		retry = 0;
		log(`open ${target}`);
		if (hello) rawSend(hello);
		while (outbox.length) rawSend(outbox.shift());
		out({ kind: "status", connected: true });
	});
	socket.addEventListener("message", (event) => {
		let message;
		try {
			message = JSON.parse(String(event.data));
		} catch {
			return;
		}
		if (message.t === "pong") return;
		if (message.t === "answer" && typeof message.id === "string") deliver(message.id, message);
		out({ kind: "relay", msg: message });
	});
	socket.addEventListener("close", () => {
		if (ws !== socket) return;
		ws = null;
		out({ kind: "status", connected: false });
		setTimeout(connect, Math.min(15000, 500 * 2 ** Math.min(retry++, 5)));
	});
	socket.addEventListener("error", () => {});
}

setInterval(() => rawSend({ t: "ping" }), 25000).unref();

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://bridge");
	if (req.method === "GET" && url.pathname === "/wait") {
		const id = url.searchParams.get("id") ?? "";
		const early = answers.get(id);
		if (early) {
			answers.delete(id);
			return reply(res, 200, early);
		}
		waiters.set(id, [...(waiters.get(id) ?? []), res]);
		const timer = setTimeout(() => {
			waiters.set(id, (waiters.get(id) ?? []).filter((waiting) => waiting !== res));
			reply(res, 200, { pending: true });
		}, 20000);
		res.on("close", () => clearTimeout(timer));
		return;
	}
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		let parsed = null;
		try {
			parsed = body ? JSON.parse(body) : null;
		} catch {
			return reply(res, 400, { error: "bad json" });
		}
		if (url.pathname === "/hello") {
			hello = parsed;
			rawSend(hello);
			return reply(res, 200, { ok: true });
		}
		if (url.pathname === "/send") {
			for (const message of Array.isArray(parsed) ? parsed : [parsed]) send(message);
			return reply(res, 200, { ok: true });
		}
		if (url.pathname === "/cancel") {
			deliver(url.searchParams.get("id") ?? "", { cancelled: true });
			return reply(res, 200, { ok: true });
		}
		if (url.pathname === "/debug") {
			const file = process.env.TRANSPORT_DEBUG_FILE;
			if (file) appendFileSync(file, `${new Date().toISOString()} ${JSON.stringify(parsed)}\n`);
			return reply(res, 200, { ok: true });
		}
		reply(res, 404, { error: "not found" });
	});
});

if (existsSync(socketPath)) unlinkSync(socketPath);
server.listen(socketPath, () => {
	out({ kind: "ready" });
	connect();
});

function shutdown() {
	try {
		if (hello) rawSend({ t: "bye", agentId: hello.agentId });
		unlinkSync(socketPath);
	} catch {}
	process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
