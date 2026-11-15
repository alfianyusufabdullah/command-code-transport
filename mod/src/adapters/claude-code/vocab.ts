import { truncate } from "../../core";
import type { SessionUpdate, ToolContent } from "../../core";

const KINDS: Record<string, string> = {
	Read: "read",
	Glob: "search",
	Grep: "search",
	Edit: "edit",
	Write: "edit",
	NotebookEdit: "edit",
	Bash: "execute",
	WebFetch: "fetch",
	WebSearch: "fetch",
	TodoWrite: "think",
	Agent: "think",
	Task: "think",
	AskUserQuestion: "think",
	ExitPlanMode: "switch_mode",
	EnterPlanMode: "switch_mode",
};

export const AGENT_TOOLS = new Set(["Agent", "Task"]);

export const PERSON_ONLY = new Set(["ExitPlanMode", "EnterPlanMode"]);

const ENVELOPE = new Set(["tool", "tool_use_id", "consent", "agentId"]);

export function toolInput(e: Record<string, unknown>): Record<string, unknown> {
	const input: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(e)) if (!ENVELOPE.has(key)) input[key] = value;
	return input;
}

export function toolTitle(name: string, input: Record<string, unknown>): string {
	const detail = ["file_path", "path", "command", "pattern", "url", "query", "description"]
		.map((key) => input[key])
		.find((value): value is string => typeof value === "string");
	return detail ? `${name}: ${detail.length > 80 ? `${detail.slice(0, 80)}…` : detail}` : name;
}

export function toolDiff(name: string, input: Record<string, unknown>): ToolContent[] {
	const path = typeof input.file_path === "string" ? input.file_path : undefined;
	if (!path) return [];
	if (name === "Write" && typeof input.content === "string") {
		return [{ type: "diff", path, oldText: null, newText: truncate(input.content, 8 * 1024) }];
	}
	if (name === "Edit" && typeof input.old_string === "string" && typeof input.new_string === "string") {
		return [
			{
				type: "diff",
				path,
				oldText: truncate(input.old_string, 8 * 1024),
				newText: truncate(input.new_string, 8 * 1024),
			},
		];
	}
	return [];
}

export function textContent(text: string | undefined): ToolContent[] {
	return text?.trim() ? [{ type: "content", content: { type: "text", text: truncate(text) } }] : [];
}

export function toolCallUpdate(
	id: string,
	name: string,
	input: Record<string, unknown>,
	status: string,
	extra: Record<string, unknown> = {},
): SessionUpdate {
	return {
		sessionUpdate: "tool_call",
		toolCallId: id,
		title: toolTitle(name, input),
		kind: KINDS[name] ?? "other",
		status,
		rawInput: input,
		content: toolDiff(name, input),
		locations: typeof input.file_path === "string" ? [{ path: input.file_path }] : [],
		...extra,
	};
}

export function planFromTodos(input: Record<string, unknown>): SessionUpdate | null {
	if (!Array.isArray(input.todos)) return null;
	return {
		sessionUpdate: "plan",
		entries: input.todos.map((todo: { content?: unknown; status?: unknown } | null) => ({
			content: String(todo?.content ?? ""),
			priority: "medium",
			status: todo?.status === "in_progress" || todo?.status === "completed" ? todo.status : "pending",
		})),
	};
}

export function resultText(result: unknown): string {
	const value = result as { deny?: unknown; text?: unknown; result?: unknown } | undefined;
	const text = value?.deny ?? value?.text ?? (value?.result !== undefined ? JSON.stringify(value.result) : "");
	return typeof text === "string" ? text : "";
}

export function parseTaskNotification(text: string) {
	if (!text.startsWith("<task-notification>")) return null;
	const tag = (name: string) =>
		new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? "";
	return {
		taskId: tag("task-id"),
		toolUseId: tag("tool-use-id"),
		status: tag("status"),
		summary: tag("summary").slice(0, 200),
	};
}
