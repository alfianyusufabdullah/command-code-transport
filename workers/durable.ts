import type { Hello, SessionInfo } from "./protocol";
import { PROTOCOL_VERSION } from "./protocol";

interface AgentRecord {
	socket: WebSocket;
	info: SessionInfo;
	registeredAt: number;
}

function parse(raw: unknown): Record<string, unknown> | null {
	if (typeof raw !== "string") return null;
	try {
		const value = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		return value as Record<string, unknown>;
	} catch {
		return null;
	}
}

export class TransportDurableObject implements DurableObject {
	private agents = new Map<string, AgentRecord>();
	private browsers = new Set<WebSocket>();
	private socketAgent = new Map<WebSocket, string>();

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("expected websocket", { status: 426 });
		}

		const url = new URL(request.url);
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		server.accept();

		if (url.pathname === "/agent") {
			this.attachAgent(server);
		} else {
			this.attachBrowser(server);
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	private attachAgent(socket: WebSocket): void {
		socket.addEventListener("message", (event) => this.onAgentMessage(socket, event.data));
		socket.addEventListener("close", () => this.dropAgent(socket));
		socket.addEventListener("error", () => this.dropAgent(socket));
	}

	private attachBrowser(socket: WebSocket): void {
		this.browsers.add(socket);
		socket.addEventListener("message", (event) => this.onBrowserMessage(socket, event.data));
		socket.addEventListener("close", () => this.dropBrowser(socket));
		socket.addEventListener("error", () => this.dropBrowser(socket));
		this.send(socket, { t: "sessions", sessions: this.sessionList() });
		this.sendPresence();
	}

	private onAgentMessage(socket: WebSocket, raw: unknown): void {
		const message = parse(raw);
		if (!message) return;

		if (message.t === "hello") {
			this.registerAgent(socket, message as unknown as Hello);
			return;
		}

		const agentId = this.socketAgent.get(socket);
		if (!agentId) {
			this.send(socket, { t: "error", code: "not_registered", message: "Send hello first." });
			return;
		}

		if (message.t === "ping") {
			this.send(socket, { t: "pong" });
			return;
		}

		if (message.t === "state") {
			const record = this.agents.get(agentId);
			if (record) {
				record.info.busy = message.busy === true;
				if (typeof message.name === "string") record.info.name = message.name;
				if (typeof message.model === "string") record.info.model = message.model;
				this.broadcast({ t: "sessions", sessions: this.sessionList() });
			}
			return;
		}

		if (message.t === "interaction") {
			const record = this.agents.get(agentId);
			if (record && typeof message.id === "string") {
				record.info.pending = message.id;
				this.broadcast({ t: "sessions", sessions: this.sessionList() });
			}
		}

		if (message.t === "interaction_closed") {
			const record = this.agents.get(agentId);
			if (record && record.info.pending === message.id) {
				delete record.info.pending;
				this.broadcast({ t: "sessions", sessions: this.sessionList() });
			}
		}

		if (message.t === "bye") {
			this.dropAgent(socket);
			try {
				socket.close(1000, "bye");
			} catch {
				return;
			}
			return;
		}

		this.broadcast(message);
	}

	private onBrowserMessage(socket: WebSocket, raw: unknown): void {
		const message = parse(raw);
		if (!message) return;

		if (message.t === "ping") {
			this.send(socket, { t: "pong" });
			return;
		}

		const agentId = message.agentId;
		if (typeof agentId !== "string") {
			this.send(socket, { t: "error", code: "missing_agent", message: "agentId is required." });
			return;
		}

		const record = this.agents.get(agentId);
		if (!record) {
			this.send(socket, {
				t: "error",
				code: "agent_offline",
				message: "That session is not connected.",
				requestId: typeof message.requestId === "string" ? message.requestId : undefined,
			});
			return;
		}

		this.send(record.socket, message);
	}

	private registerAgent(socket: WebSocket, hello: Hello): void {
		if (typeof hello.agentId !== "string" || hello.agentId.length === 0) {
			this.send(socket, { t: "error", code: "bad_hello", message: "agentId is required." });
			return;
		}
		if (typeof hello.sessionId !== "string") {
			this.send(socket, { t: "error", code: "bad_hello", message: "sessionId is required." });
			return;
		}

		const previous = this.agents.get(hello.agentId);
		if (previous && previous.socket !== socket) {
			this.socketAgent.delete(previous.socket);
			try {
				previous.socket.close(4001, "replaced");
			} catch {
				this.agents.delete(hello.agentId);
			}
		}

		for (const [id, record] of [...this.agents]) {
			if (id === hello.agentId || record.info.sessionId !== hello.sessionId) continue;
			this.socketAgent.delete(record.socket);
			try {
				record.socket.close(4001, "replaced");
			} catch {
				/* already closed */
			}
			this.agents.delete(id);
		}

		const info: SessionInfo = {
			agentId: hello.agentId,
			sessionId: hello.sessionId,
			name: typeof hello.name === "string" ? hello.name : "",
			cwd: typeof hello.cwd === "string" ? hello.cwd : "",
			model: typeof hello.model === "string" ? hello.model : "",
			busy: hello.busy === true,
		};

		this.agents.set(hello.agentId, { socket, info, registeredAt: Date.now() });
		this.socketAgent.set(socket, hello.agentId);
		this.send(socket, { t: "hello_ack", v: PROTOCOL_VERSION });
		this.broadcast({ t: "sessions", sessions: this.sessionList() });
		this.sendPresence();
	}

	private dropAgent(socket: WebSocket): void {
		const agentId = this.socketAgent.get(socket);
		if (!agentId) return;
		this.socketAgent.delete(socket);
		const record = this.agents.get(agentId);
		if (record && record.socket === socket) this.agents.delete(agentId);
		this.broadcast({ t: "sessions", sessions: this.sessionList() });
		this.sendPresence();
	}

	private dropBrowser(socket: WebSocket): void {
		if (!this.browsers.delete(socket)) return;
		this.sendPresence();
	}

	private sessionList(): SessionInfo[] {
		const seen = new Set<string>();
		const sessions: SessionInfo[] = [];
		const records = [...this.agents.values()].sort(
			(a, b) => b.registeredAt - a.registeredAt,
		);
		for (const record of records) {
			if (seen.has(record.info.sessionId)) continue;
			seen.add(record.info.sessionId);
			sessions.push({ ...record.info });
		}
		return sessions.sort((a, b) => a.name.localeCompare(b.name));
	}

	private sendPresence(): void {
		const count = this.browsers.size;
		for (const record of this.agents.values()) {
			this.send(record.socket, { t: "presence", agentId: record.info.agentId, browsers: count });
		}
	}

	private send(socket: WebSocket, payload: unknown): void {
		try {
			socket.send(JSON.stringify(payload));
		} catch {
			return;
		}
	}

	private broadcast(payload: unknown): void {
		if (this.browsers.size === 0) return;
		const encoded = JSON.stringify(payload);
		for (const socket of this.browsers) {
			try {
				socket.send(encoded);
			} catch {
				this.browsers.delete(socket);
			}
		}
	}
}
