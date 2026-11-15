import type { Snapshot } from "./types";

export const HISTORY_CHUNK_LIMIT = 512 * 1024;
export const LEGACY_PAGE_LIMIT = 1024 * 1024;

export function capUpdates(updates: Snapshot[], limit = LEGACY_PAGE_LIMIT): Snapshot[] {
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

export function chunkUpdates(updates: Snapshot[], limit = HISTORY_CHUNK_LIMIT): Snapshot[][] {
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
