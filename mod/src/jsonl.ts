import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { toContent, toolDiff, toolKind, toolLocations, toolTitle } from "./acp";
import type { Entry, Snapshot } from "./types";
import { truncate } from "./util";

export const HISTORY_CHUNK_LIMIT = 512 * 1024;
export const LEGACY_PAGE_LIMIT = 1024 * 1024;

export function loadEntries(file: string): Entry[] {
	const raw = readFileSync(file, "utf8");
	const entries: Entry[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (!record || typeof record !== "object" || Array.isArray(record)) continue;
		const value = record as Record<string, unknown>;
		if (value.type === "session") {
			if (value.version !== 3) throw new Error("unsupported_session_file");
			continue;
		}
		if (typeof value.type !== "string" || typeof value.id !== "string") continue;
		if (typeof value.timestamp !== "string") continue;
		if (value.parentId !== null && typeof value.parentId !== "string") continue;
		entries.push(value as unknown as Entry);
	}
	return entries;
}

export function activePath(entries: Entry[], leafId: string | null | undefined): Entry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const path: Entry[] = [];
	const seen = new Set<string>();
	let current = leafId ? byId.get(leafId) : entries[entries.length - 1];
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		path.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path.reverse();
}

function isTurnStart(entry: Entry): boolean {
	if (entry.type !== "message" || entry.message?.role !== "user") return false;
	const content = entry.message.content;
	if (!Array.isArray(content)) return false;
	return content.some((block) => block?.type !== "tool_result");
}

export function groupTurns(path: Entry[]): Entry[][] {
	const turns: Entry[][] = [];
	let current: Entry[] = [];
	for (const entry of path) {
		if (isTurnStart(entry)) {
			if (current.length > 0) turns.push(current);
			current = [entry];
		} else {
			current.push(entry);
		}
	}
	if (current.length > 0) turns.push(current);
	return turns;
}

export function paginate(
	turns: Entry[][],
	limit: number,
	before: string | null,
): { turns: Entry[][]; cursor: string | null; eof: boolean } | { error: "stale_cursor" } {
	let end = turns.length;
	if (before) {
		const index = turns.findIndex((turn) => turn.some((entry) => entry.id === before));
		if (index < 0) return { error: "stale_cursor" };
		end = index;
	}
	const start = Math.max(0, end - Math.max(1, limit));
	const page = turns.slice(start, end);
	const first = page[0]?.[0];
	return { turns: page, cursor: first ? first.id : null, eof: start === 0 };
}

function collectToolResults(turns: Entry[][]): Map<string, unknown> {
	const results = new Map<string, unknown>();
	for (const turn of turns) {
		for (const entry of turn) {
			if (entry.type !== "message" || entry.message?.role !== "user") continue;
			for (const block of entry.message.content ?? []) {
				if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
					results.set(block.tool_use_id, block.content);
				}
			}
		}
	}
	return results;
}

export function entriesToUpdates(turns: Entry[][]): Snapshot[] {
	const results = collectToolResults(turns);
	const updates: Snapshot[] = [];
	for (const turn of turns) {
		for (const entry of turn) {
			if (entry.type === "session_info") {
				if (entry.name) {
					updates.push({
						key: `e:${entry.id}`,
						update: { sessionUpdate: "session_info_update", title: entry.name },
					});
				}
				continue;
			}
			if (entry.type !== "message" || !entry.message) continue;
			if (entry.message.role === "user" && entry.message.meta?.isMeta) continue;
			const blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
			if (entry.message.role === "user") {
				let index = 0;
				for (const block of blocks) {
					if (block.type !== "text" || typeof block.text !== "string" || !block.text.trim()) {
						continue;
					}
					updates.push({
						key: `e:${entry.id}:u${index}`,
						update: {
							sessionUpdate: "user_message_chunk",
							content: { type: "text", text: truncate(block.text) },
						},
					});
					index += 1;
				}
				continue;
			}
			blocks.forEach((block, index) => {
				if (
					block.type === "thinking" &&
					typeof block.thinking === "string" &&
					block.thinking.trim()
				) {
					updates.push({
						key: `e:${entry.id}:t${index}`,
						update: {
							sessionUpdate: "agent_thought_chunk",
							content: { type: "text", text: truncate(block.thinking) },
						},
					});
					return;
				}
				if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
					updates.push({
						key: `e:${entry.id}:t${index}`,
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: truncate(block.text) },
						},
					});
					return;
				}
				if (block.type !== "tool_use" || typeof block.id !== "string") return;
				const result = results.get(block.id);
				const name = typeof block.name === "string" ? block.name : "tool";
				const input = block.input ?? {};
				updates.push({
					key: `t:${block.id}`,
					update: {
						sessionUpdate: "tool_call",
						toolCallId: block.id,
						title: toolTitle(name, input as Record<string, unknown>),
						kind: toolKind(name),
						status: result === undefined ? "pending" : "completed",
						rawInput: input,
						content: [...toolDiff(name, input as Record<string, unknown>), ...toContent(result)],
						locations: toolLocations(name, input as Record<string, unknown>),
					},
				});
			});
		}
	}
	return updates;
}

export function capUpdates(
	updates: Snapshot[],
	limit = LEGACY_PAGE_LIMIT,
): Snapshot[] {
	const capped: Snapshot[] = [];
	let bytes = 0;
	for (const item of updates) {
		const size = JSON.stringify(item).length;
		if (bytes + size > limit && capped.length > 0) break;
		capped.push(item);
		bytes += size;
	}
	return capped;
}

export function chunkUpdates(
	updates: Snapshot[],
	limit = HISTORY_CHUNK_LIMIT,
): Snapshot[][] {
	const chunks: Snapshot[][] = [];
	let current: Snapshot[] = [];
	let bytes = 0;
	for (const item of updates) {
		const size = JSON.stringify(item).length;
		if (current.length > 0 && bytes + size > limit) {
			chunks.push(current);
			current = [];
			bytes = 0;
		}
		current.push(item);
		bytes += size;
	}
	if (current.length > 0 || chunks.length === 0) chunks.push(current);
	return chunks;
}

export function findSessionFile(id: string): string | null {
	const base = join(homedir(), ".commandcode", "projects");
	if (!existsSync(base)) return null;
	for (const directory of readdirSync(base)) {
		const candidate = join(base, directory, `${id}.jsonl`);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}
