import type { Harness, SessionInfo } from "../../workers/protocol";

const LABELS: Record<Harness, string> = {
	commandcode: "Command Code",
	"claude-code": "Claude Code",
};

export function harnessLabel(session: Pick<SessionInfo, "harness"> | undefined): string {
	return LABELS[session?.harness ?? "commandcode"];
}
