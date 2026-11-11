import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const base = process.env.BASE ?? "ws://localhost:5174";
const modPath = fileURLToPath(new URL("../dist/transport.ts", import.meta.url));
const source = readFileSync(modPath, "utf8");
const state = new Map<string, unknown>();
const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });

const results: { name: string; ok: boolean; extra?: string }[] = [];
const check = (name: string, ok: boolean, extra = "") => {
	results.push({ name, ok, extra });
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
	return {
		next(match: (message: any) => boolean, timeout = 6000): Promise<any> {
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
		},
		drain() {
			return queue.splice(0, queue.length);
		},
	};
}

function createCmd() {
	const handlers = new Map<string, ((payload: any) => void)[]>();
	const hooks: any[] = [];
	let command: ((context: any) => unknown) | null = null;

	const cmd = {
		name: "transport",
		cwd: "/tmp/demo",
		addCommand(value: any) {
			command = value.handler;
			return { dispose() {} };
		},
		on(event: string, handler: (payload: any) => void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return { dispose() {} };
		},
		hooks(value: any) {
			hooks.push(value);
			return { dispose() {} };
		},
		sessions: { leafId: () => undefined },
		sendUserMessage() {},
		getSessionName: () => "reload demo",
		getModel: () => "test-model",
		isIdle: () => true,
		ui: { notify() {} },
		state: {
			get<T>(key: string) {
				return state.get(key) as T | undefined;
			},
			set<T>(key: string, value: T) {
				state.set(key, value);
			},
		},
	};

	return {
		cmd,
		hooks,
		run(args: string) {
			return command?.({ args, ui: cmd.ui, cwd: cmd.cwd });
		},
	};
}

async function loadFactory() {
	const loaded = await jiti.evalModule(source, { filename: modPath, async: true });
	return (typeof loaded === "function" ? loaded : (loaded as any).default) as (cmd: any) => void;
}

const browser = new WebSocket(`${base}/ws`);
const browserIn = collect(browser);
await new Promise((resolve, reject) => {
	browser.addEventListener("open", () => resolve(null));
	browser.addEventListener("error", () => reject(new Error("browser ws error")));
});

const first = createCmd();
const factory1 = await loadFactory();
factory1(first.cmd);
first.hooks[0].onSessionStart({ source: "startup", sessionId: "sess_reload" });
const host = new URL(base).host;
const target = `${new URL(base).protocol}//${host}/agent`;
first.run(host);

const before = await browserIn.next(
	(message) => message.t === "sessions" && message.sessions.some((s: any) => s.sessionId === "sess_reload"),
);
const agentId = before.sessions.find((s: any) => s.sessionId === "sess_reload").agentId;
check("session registered before reload", Boolean(agentId), agentId);

first.hooks[0].onSessionEnd({ reason: "reload" });
await wait(400);
browserIn.drain();

const second = createCmd();
const factory2 = await loadFactory();
factory2(second.cmd);
second.hooks[0].onSessionStart({ source: "reload", sessionId: "sess_reload" });

const after = await browserIn.next(
	(message) =>
		message.t === "sessions" &&
		message.sessions.some((s: any) => s.sessionId === "sess_reload" && s.agentId === agentId),
);
check(
	"session reconnects after reload with same agentId",
	after.sessions.some((s: any) => s.sessionId === "sess_reload" && s.agentId === agentId),
	agentId,
);
check("target persisted in cmd.state", state.get("transport:target") === target, String(state.get("transport:target")));

browser.close();
await wait(100);
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
