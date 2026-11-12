import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
	AcpPlanEntry,
	AcpToolCall,
	AcpToolCallUpdate,
	AcpToolContent,
	DeliverAs,
	HistoryPage,
	Interaction,
	SessionInfo,
	SessionUpdate,
	SnapshotUpdate,
	ToolStatus,
	UpdateMessage,
	WebToRelay,
} from "../../workers/protocol";

export type BlockKind = "user" | "assistant" | "thinking" | "tool" | "plan" | "info";

export interface Block {
	key: string;
	kind: BlockKind;
	text: string;
	toolCallId?: string;
	title?: string;
	toolKind?: string;
	status?: ToolStatus;
	content?: AcpToolContent[];
	entries?: AcpPlanEntry[];
	mode?: string;
}

export interface TransportState {
	status: "connecting" | "open" | "closed";
	sessions: SessionInfo[];
	activeAgentId: string | null;
	blocks: Record<string, Block>;
	order: string[];
	interactions: Record<string, Interaction>;
	cursor: string | null;
	eof: boolean;
	loading: boolean;
	notice: string | null;
	pendingRuns: string[];
}

type RequestKind = "initial" | "older" | "refresh";

type Action =
	| { type: "status"; status: TransportState["status"] }
	| { type: "sessions"; sessions: SessionInfo[] }
	| { type: "select"; agentId: string }
	| { type: "history"; page: HistoryPage; refresh: boolean }
	| { type: "delta"; message: UpdateMessage }
	| { type: "snapshot"; updates: SnapshotUpdate[] }
	| { type: "run_committed"; runId: string }
	| { type: "interaction"; interaction: Interaction }
	| { type: "interaction_closed"; id: string }
	| { type: "notice"; notice: string | null }
	| { type: "error"; message: string }
	| { type: "loading"; loading: boolean };

const initialState: TransportState = {
	status: "connecting",
	sessions: [],
	activeAgentId: null,
	blocks: {},
	order: [],
	interactions: {},
	cursor: null,
	eof: false,
	loading: false,
	notice: null,
	pendingRuns: [],
};

function kindFor(update: SessionUpdate): BlockKind {
	switch (update.sessionUpdate) {
		case "agent_message_chunk":
			return "assistant";
		case "agent_thought_chunk":
			return "thinking";
		case "user_message_chunk":
			return "user";
		case "tool_call":
		case "tool_call_update":
			return "tool";
		case "plan":
			return "plan";
		default:
			return "info";
	}
}

function mergeTool(
	existing: Block | undefined,
	key: string,
	update: AcpToolCall | AcpToolCallUpdate,
): Block {
	const base = existing ?? { key, kind: "tool" as const, text: "" };
	if (update.sessionUpdate === "tool_call") {
		return {
			...base,
			toolCallId: update.toolCallId,
			title: update.title,
			toolKind: update.kind,
			status: update.status,
			content: update.content ?? base.content,
		};
	}
	return {
		...base,
		toolCallId: update.toolCallId,
		title: update.title ?? base.title,
		status: update.status ?? base.status,
		content: update.content ?? base.content,
	};
}

function snapshotBlock(existing: Block | undefined, item: SnapshotUpdate): Block {
	const update = item.update;
	switch (update.sessionUpdate) {
		case "agent_message_chunk":
		case "agent_thought_chunk":
		case "user_message_chunk": {
			const text = update.content.type === "text" ? update.content.text : "";
			return { key: item.key, kind: kindFor(update), text };
		}
		case "tool_call":
		case "tool_call_update":
			return mergeTool(existing, item.key, update);
		case "plan":
			return { key: item.key, kind: "plan", text: "", entries: update.entries };
		case "current_mode_update":
			return { key: item.key, kind: "info", text: "", mode: update.currentModeId };
		case "session_info_update":
			return { key: item.key, kind: "info", text: update.title ?? "" };
	}
}

function appendText(existing: Block | undefined, key: string, kind: BlockKind, text: string): Block {
	if (!existing) return { key, kind, text };
	return { ...existing, text: existing.text + text };
}

function reducer(state: TransportState, action: Action): TransportState {
	switch (action.type) {
		case "status":
			return { ...state, status: action.status };
		case "sessions":
			return { ...state, sessions: action.sessions };
		case "select":
			return {
				...state,
				activeAgentId: action.agentId,
				blocks: {},
				order: [],
				cursor: null,
				eof: false,
				loading: true,
				notice: null,
				pendingRuns: [],
			};
		case "loading":
			return { ...state, loading: action.loading };
		case "notice":
			return { ...state, notice: action.notice };
		case "error":
			return { ...state, notice: action.message, loading: false };
		case "history": {
			const dropPrefixes = action.refresh
				? state.pendingRuns.map((runId) => `run:${runId}:`)
				: [];
			const baseOrder = state.order.filter(
				(key) => !dropPrefixes.some((prefix) => key.startsWith(prefix)),
			);
			const blocks: Record<string, Block> = {};
			for (const key of baseOrder) {
				const block = state.blocks[key];
				if (block) blocks[key] = block;
			}
			for (const item of action.page.updates) {
				blocks[item.key] = snapshotBlock(blocks[item.key], item);
			}
			const keys = action.page.updates.map((item) => item.key);
			const order = action.refresh
				? [...baseOrder.filter((key) => !keys.includes(key)), ...keys]
				: [...new Set([...keys, ...baseOrder])];
			return {
				...state,
				blocks,
				order,
				cursor: action.page.cursor,
				eof: action.page.eof,
				loading: false,
				notice: null,
				pendingRuns: action.refresh ? [] : state.pendingRuns,
			};
		}
		case "delta": {
			const update = action.message.update;
			if (
				update.sessionUpdate === "agent_message_chunk" ||
				update.sessionUpdate === "agent_thought_chunk" ||
				update.sessionUpdate === "user_message_chunk"
			) {
				if (update.content.type !== "text") return state;
				const existing = state.blocks[action.message.key];
				const block = appendText(
					existing,
					action.message.key,
					kindFor(update),
					update.content.text,
				);
				const order = existing ? state.order : [...state.order, action.message.key];
				return { ...state, blocks: { ...state.blocks, [action.message.key]: block }, order };
			}
			const block = snapshotBlock(state.blocks[action.message.key], {
				key: action.message.key,
				update,
			});
			const order = state.blocks[action.message.key]
				? state.order
				: [...state.order, action.message.key];
			return { ...state, blocks: { ...state.blocks, [action.message.key]: block }, order };
		}
		case "snapshot": {
			const blocks = { ...state.blocks };
			const keys: string[] = [];
			for (const item of action.updates) {
				blocks[item.key] = snapshotBlock(blocks[item.key], item);
				if (!keys.includes(item.key)) keys.push(item.key);
			}
			return { ...state, blocks, order: [...new Set([...state.order, ...keys])] };
		}
		case "run_committed":
			return { ...state, pendingRuns: [...state.pendingRuns, action.runId] };
		case "interaction":
			return {
				...state,
				interactions: { ...state.interactions, [action.interaction.id]: action.interaction },
			};
		case "interaction_closed": {
			if (!state.interactions[action.id]) return state;
			const interactions = { ...state.interactions };
			delete interactions[action.id];
			return { ...state, interactions };
		}
	}
}

function socketUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/ws`;
}

export function useTransport() {
	const [state, dispatch] = useReducer(reducer, initialState);
	const socketRef = useRef<WebSocket | null>(null);
	const requestKinds = useRef(new Map<string, RequestKind>());
	const activeRef = useRef<string | null>(null);
	const activeSessionRef = useRef<string | null>(null);
	const sessionsRef = useRef<SessionInfo[]>([]);
	const retryRef = useRef(0);
	const timerRef = useRef<number | null>(null);
	const heartbeatRef = useRef<number | null>(null);
	const requestSeq = useRef(0);

	useEffect(() => {
		activeRef.current = state.activeAgentId;
	}, [state.activeAgentId]);

	useEffect(() => {
		sessionsRef.current = state.sessions;
	}, [state.sessions]);

	const send = useCallback((message: WebToRelay) => {
		const socket = socketRef.current;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(message));
		}
	}, []);

	const requestHistory = useCallback(
		(agentId: string, before: string | null, kind: RequestKind) => {
			requestSeq.current += 1;
			const requestId = `${kind}:${requestSeq.current}`;
			requestKinds.current.set(requestId, kind);
			send({ t: "history", agentId, requestId, limit: 20, before });
		},
		[send],
	);

	const refresh = useCallback(() => {
		const agentId = activeRef.current;
		if (!agentId) return;
		dispatch({ type: "loading", loading: true });
		requestHistory(agentId, null, "refresh");
	}, [requestHistory]);

	const handleMessage = useCallback(
		(event: MessageEvent<string>) => {
			let message: Record<string, unknown>;
			try {
				message = JSON.parse(event.data);
			} catch {
				return;
			}

			switch (message.t) {
				case "sessions": {
					const sessions = (message.sessions ?? []) as SessionInfo[];
					dispatch({ type: "sessions", sessions });
					if (sessions.length === 0) return;

					if (!activeRef.current) {
						const first = sessions[0];
						activeRef.current = first.agentId;
						activeSessionRef.current = first.sessionId;
						dispatch({ type: "select", agentId: first.agentId });
						requestHistory(first.agentId, null, "initial");
						return;
					}

					const active = sessions.find(
						(session) => session.agentId === activeRef.current,
					);
					if (active) {
						activeSessionRef.current = active.sessionId;
						return;
					}

					const replacement =
						sessions.find(
							(session) => session.sessionId === activeSessionRef.current,
						) ?? sessions[0];
					activeRef.current = replacement.agentId;
					activeSessionRef.current = replacement.sessionId;
					dispatch({ type: "select", agentId: replacement.agentId });
					requestHistory(replacement.agentId, null, "initial");
					return;
				}
				case "history_page": {
					const page = message as unknown as HistoryPage;
					const kind = requestKinds.current.get(page.requestId);
					requestKinds.current.delete(page.requestId);
					dispatch({ type: "history", page, refresh: kind === "refresh" });
					return;
				}
				case "update":
					dispatch({ type: "delta", message: message as unknown as UpdateMessage });
					return;
				case "replay":
					dispatch({
						type: "snapshot",
						updates: (message.updates ?? []) as SnapshotUpdate[],
					});
					return;
				case "run_committed":
					dispatch({ type: "run_committed", runId: String(message.runId) });
					refresh();
					return;
				case "interaction":
					dispatch({ type: "interaction", interaction: message as unknown as Interaction });
					return;
				case "interaction_closed":
					dispatch({ type: "interaction_closed", id: String(message.id) });
					return;
				case "gap":
					dispatch({
						type: "notice",
						notice: `${message.dropped} event terlewat, memuat ulang history.`,
					});
					refresh();
					return;
				case "error":
					dispatch({ type: "error", message: String(message.message ?? "Relay error") });
					return;
				default:
					return;
			}
		},
		[refresh, requestHistory],
	);

	useEffect(() => {
		let disposed = false;

		const connect = () => {
			if (disposed) return;
			dispatch({ type: "status", status: retryRef.current === 0 ? "connecting" : "closed" });
			const socket = new WebSocket(socketUrl());
			socketRef.current = socket;

			socket.addEventListener("open", () => {
				if (disposed) {
					socket.close();
					return;
				}
				retryRef.current = 0;
				dispatch({ type: "status", status: "open" });
				const agentId = activeRef.current;
				if (agentId) requestHistory(agentId, null, "refresh");
				if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
				heartbeatRef.current = window.setInterval(() => {
					if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "ping" }));
				}, 20000);
			});

			socket.addEventListener("message", (event) => handleMessage(event as MessageEvent<string>));

			socket.addEventListener("close", () => {
				if (disposed) return;
				if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
				dispatch({ type: "status", status: "closed" });
				retryRef.current += 1;
				const delay = Math.min(30000, 1000 * 2 ** Math.min(retryRef.current, 5));
				timerRef.current = window.setTimeout(connect, delay + Math.random() * 500);
			});

			socket.addEventListener("error", () => socket.close());
		};

		connect();

		return () => {
			disposed = true;
			if (timerRef.current) window.clearTimeout(timerRef.current);
			if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
			socketRef.current?.close();
			socketRef.current = null;
		};
	}, [handleMessage, requestHistory]);

	const selectSession = useCallback(
		(agentId: string) => {
			activeSessionRef.current =
				sessionsRef.current.find((session) => session.agentId === agentId)?.sessionId ?? null;
			dispatch({ type: "select", agentId });
			requestHistory(agentId, null, "initial");
		},
		[requestHistory],
	);

	const loadOlder = useCallback(() => {
		const agentId = activeRef.current;
		if (!agentId || !state.cursor || state.eof || state.loading) return;
		dispatch({ type: "loading", loading: true });
		requestHistory(agentId, state.cursor, "older");
	}, [requestHistory, state.cursor, state.eof, state.loading]);

	const sendPrompt = useCallback(
		(text: string, deliverAs: DeliverAs = "steer") => {
			const agentId = activeRef.current;
			if (!agentId || !text.trim()) return;
			send({ t: "prompt", agentId, text, deliverAs });
		},
		[send],
	);

	const answerPermission = useCallback(
		(id: string, decision: "allow" | "deny") => {
			const agentId = activeRef.current;
			if (!agentId) return;
			send({ t: "answer", agentId, id, decision });
			dispatch({ type: "interaction_closed", id });
		},
		[send],
	);

	const answerQuestion = useCallback(
		(id: string, answers: { questionIndex: number; selectedOptions: string[] }[]) => {
			const agentId = activeRef.current;
			if (!agentId) return;
			send({ t: "answer", agentId, id, answers });
			dispatch({ type: "interaction_closed", id });
		},
		[send],
	);

	return {
		state,
		selectSession,
		loadOlder,
		refresh,
		sendPrompt,
		answerPermission,
		answerQuestion,
	};
}
