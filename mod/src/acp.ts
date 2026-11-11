import type { DiffContentItem, Snapshot, ToolContent } from "./types";
import { readString, truncate } from "./util";

const kinds: Record<string, string> = {
	read_file: "read",
	read_directory: "read",
	write_file: "edit",
	edit_file: "edit",
	grep: "search",
	glob: "search",
	shell_command: "execute",
	monitor_command: "execute",
	todo_write: "think",
	ask_user_question: "think",
	exit_plan_mode: "switch_mode",
	enter_plan_mode: "switch_mode",
};

export function toolKind(name: string): string {
	return kinds[name] ?? "other";
}

export function toolTitle(name: string, input: Record<string, unknown> | undefined): string {
	const detail =
		readString(input, "file_path", "path", "command", "pattern", "query") ??
		(typeof input?.url === "string" ? input.url : undefined);
	if (!detail) return name;
	return `${name}: ${detail.length > 80 ? `${detail.slice(0, 80)}…` : detail}`;
}

export function toolDiff(
	name: string,
	input: Record<string, unknown> | undefined,
): DiffContentItem[] {
	const path = readString(input, "file_path", "path");
	if (!path) return [];
	if (name === "write_file") {
		const content = readString(input, "content");
		if (content === undefined) return [];
		return [{ type: "diff", path, oldText: null, newText: truncate(content, 8 * 1024) }];
	}
	if (name === "edit_file") {
		const oldText = readString(input, "old_string");
		const newText = readString(input, "new_string");
		if (oldText === undefined || newText === undefined) return [];
		return [
			{
				type: "diff",
				path,
				oldText: truncate(oldText, 8 * 1024),
				newText: truncate(newText, 8 * 1024),
			},
		];
	}
	return [];
}

export function toolLocations(
	name: string,
	input: Record<string, unknown> | undefined,
): { path: string; line?: number }[] {
	const path = readString(input, "file_path", "path");
	if (!path) return [];
	if (name === "read_file" && typeof input?.offset === "number") {
		return [{ path, line: input.offset }];
	}
	return [{ path }];
}

export function toContent(value: unknown): ToolContent[] {
	if (typeof value === "string") {
		return value.trim()
			? [{ type: "content", content: { type: "text", text: truncate(value) } }]
			: [];
	}
	if (!Array.isArray(value)) return [];
	const parts: ToolContent[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const block = item as { type?: unknown; text?: unknown };
		if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
			parts.push({ type: "content", content: { type: "text", text: truncate(block.text) } });
		}
	}
	return parts;
}

export function planFromTodo(
	runId: string,
	input: Record<string, unknown> | undefined,
): Snapshot | null {
	const todos = input?.todos;
	if (!Array.isArray(todos)) return null;
	const entries = [];
	for (const todo of todos) {
		if (!todo || typeof todo !== "object") return null;
		const item = todo as { content?: unknown; status?: unknown };
		if (typeof item.content !== "string") return null;
		const status =
			item.status === "in_progress" || item.status === "completed" ? item.status : "pending";
		entries.push({ content: item.content, priority: "medium", status });
	}
	return { key: `run:${runId}:plan`, update: { sessionUpdate: "plan", entries } };
}
