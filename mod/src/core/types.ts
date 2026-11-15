export interface ToolContentItem {
	type: "content";
	content: { type: "text"; text: string };
}

export interface DiffContentItem {
	type: "diff";
	path: string;
	oldText: string | null;
	newText: string;
}

export type ToolContent = ToolContentItem | DiffContentItem;

export interface SessionUpdate {
	sessionUpdate: string;
	[key: string]: unknown;
}

export interface Snapshot {
	key: string;
	update: SessionUpdate;
}

export interface RunBlock {
	key: string;
	update: SessionUpdate;
	text: string;
}

export interface SkillInfo {
	name: string;
	description: string;
	argumentHint?: string;
	source: "project" | "user";
}

export type CloseReason = "answered" | "timeout" | "disconnected" | "superseded";

export type Message = Record<string, unknown>;
