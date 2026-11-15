import { truncate } from "../../core";
import type { Snapshot } from "../../core";

import { parseTaskNotification, textContent, toolCallUpdate, toolDiff } from "./vocab";

export interface SessionRow {
	role: "user" | "assistant";
	text: string;
	toolUses?: {
		tool_use_id: string;
		tool: string;
		input: Record<string, unknown>;
		text?: string;
		isError?: true;
		agentId?: string;
	}[];
	toolResults?: unknown[];
}

export interface Turn {
	start: number;
	updates: Snapshot[];
}

export function rowsToTurns(rows: SessionRow[]): Turn[] {
	const turns: Turn[] = [];
	rows.forEach((row, index) => {
		const isPrompt = row.role === "user" && Boolean(row.text?.trim()) && !row.toolResults?.length;
		if (isPrompt || turns.length === 0) turns.push({ start: index, updates: [] });
		const turn = turns[turns.length - 1]!;
		if (isPrompt) {
			const note = parseTaskNotification(row.text);
			const text = note ? `↩ ${note.summary || "Background task finished"}` : truncate(row.text);
			turn.updates.push({
				key: `h:${index}:u`,
				update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } },
			});
		}
		if (row.role !== "assistant") return;
		if (row.text?.trim()) {
			turn.updates.push({
				key: `h:${index}:a`,
				update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: truncate(row.text) } },
			});
		}
		for (const use of row.toolUses ?? []) {
			if (use.agentId) continue;
			const input = use.input ?? {};
			turn.updates.push({
				key: `h:${index}:t:${use.tool_use_id}`,
				update: toolCallUpdate(use.tool_use_id, use.tool, input, use.isError ? "failed" : "completed", {
					content: [...toolDiff(use.tool, input), ...textContent(use.text)],
				}),
			});
		}
	});
	return turns;
}

export function pageTurns(turns: Turn[], limit: number, before: number | null) {
	const earlier = before === null ? turns : turns.filter((turn) => turn.start < before);
	const page = earlier.slice(-limit);
	const more = earlier.length > page.length;
	return {
		updates: page.flatMap((turn) => turn.updates),
		cursor: more && page[0] ? String(page[0].start) : null,
		eof: !more,
	};
}
