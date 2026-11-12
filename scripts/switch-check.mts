import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const first = process.env.FIRST ?? "ws://localhost:5174";
const second = process.env.SECOND;

if (!second) {
	console.log("skip: set SECOND=wss://... to test switching hosts");
	process.exit(0);
}

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

function browser(base: string) {
	const socket = new WebSocket(`${base}/ws`);
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
		socket,
		next(match: (message: any) => boolean, timeout = 8000): Promise<any> {
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
	};
}

const createCmd = () => {
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
		getSessionName: () => "switch demo",
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
		run(host: string) {
			return command?.({ args: host, ui: cmd.ui, cwd: cmd.cwd });
		},
	};
};

const sessionId = "sess_switch";

const a = browser(first);
const factory = await jiti
	.evalModule(source, { filename: modPath, async: true })
	.then((loaded: any) => (typeof loaded === "function" ? loaded : loaded.default));
const fake = createCmd();
factory(fake.cmd);
fake.hooks[0].onSessionStart({ source: "startup", sessionId });
fake.run(new URL(first).host);

const onFirst = await a.next((m) => m.t === "sessions" && m.sessions.some((s: any) => s.sessionId === sessionId));
check("connected to first host", Boolean(onFirst));

const b = browser(second);
fake.run(new URL(second).host);

const onSecond = await b.next((m) => m.t === "sessions" && m.sessions.some((s: any) => s.sessionId === sessionId));
check("connected to second host", Boolean(onSecond));

const goneFromFirst = await a.next(
	(m) => m.t === "sessions" && !m.sessions.some((s: any) => s.sessionId === sessionId),
);
check("removed from first host", Boolean(goneFromFirst));

fake.run(new URL(first).host);
const backOnFirst = await a.next((m) => m.t === "sessions" && m.sessions.some((s: any) => s.sessionId === sessionId));
check("back on first host", Boolean(backOnFirst));

const goneFromSecond = await b.next(
	(m) => m.t === "sessions" && !m.sessions.some((s: any) => s.sessionId === sessionId),
);
check("removed from second host", Boolean(goneFromSecond));

await wait(100);
a.socket.close();
b.socket.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
