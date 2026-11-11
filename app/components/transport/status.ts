import {
	Brain,
	FilePen,
	FileText,
	Search,
	Terminal,
	Wrench,
} from "lucide-react";

import type { AcpToolContent, ToolStatus } from "../../../workers/protocol";

export function toolLabel(status: ToolStatus | undefined): string {
	switch (status) {
		case "completed":
			return "Ran";
		case "failed":
			return "Failed";
		case "in_progress":
			return "Running";
		default:
			return "Queued";
	}
}

export function toolIcon(kind: string | undefined) {
	switch (kind) {
		case "read":
			return FileText;
		case "edit":
			return FilePen;
		case "search":
			return Search;
		case "execute":
			return Terminal;
		case "think":
			return Brain;
		default:
			return Wrench;
	}
}

export function contentText(content?: AcpToolContent[]): string {
	if (!content || content.length === 0) return "";
	const parts: string[] = [];
	for (const item of content) {
		if (item.type === "content" && item.content.type === "text") parts.push(item.content.text);
		if (item.type === "diff") parts.push(`${item.path} · ${item.newText.split("\n").length} lines`);
	}
	return parts.join("\n\n");
}
