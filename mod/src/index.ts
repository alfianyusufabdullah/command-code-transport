import { TransportClient } from "./client";
import type { ModApi } from "./types";
import { parseHost, randomId } from "./util";

const TARGET_KEY = "transport:target";
const AGENT_KEY = "transport:agentId";

export default function transport(cmd: ModApi): void {
	const agentId = cmd.state?.get<string>(AGENT_KEY) ?? randomId(10);
	cmd.state?.set(AGENT_KEY, agentId);

	const client = new TransportClient(cmd, agentId);
	const restored = cmd.state?.get<string>(TARGET_KEY);
	if (restored) client.start(restored);

	cmd.addCommand({
		name: "transport",
		description: "Expose this session to the transport web relay",
		argumentHint: "<host>",
		handler: ({ args, ui }) => {
			const parsed = parseHost(args);
			if (!parsed) {
				ui.notify("transport: usage /transport <host>");
				return { message: "Usage: /transport <host>" };
			}
			cmd.state?.set(TARGET_KEY, parsed);
			client.start(parsed);
			ui.notify(`transport: connecting to ${parsed}`);
			return { message: `Transport: ${parsed}` };
		},
	});

	cmd.hooks({
		onSessionStart: ({ sessionId }) => client.setSessionId(sessionId),
		onSessionEnd: ({ reason }) => {
			if (reason === "shutdown") client.shutdown();
			else if (reason === "reload") client.disconnect();
		},
		onPermissionRequest: (input) => client.answerPermission(input),
		beforeToolCall: (input) => client.answerQuestion(input),
		transformMessage: ({ message }) => {
			client.onMessageCommitted(message);
			return message;
		},
	});

	cmd.on("run_start", (event) => client.onRunStart(event));
	cmd.on("message_start", () => client.onMessageStart());
	cmd.on("thinking_start", () => client.onThinkingStart());
	cmd.on("thinking_delta", (event) => client.onThinkingDelta(event));
	cmd.on("thinking_end", () => client.onThinkingEnd());
	cmd.on("text_delta", (event) => client.onTextDelta(event));
	cmd.on("tool_queued", (event) => client.onToolQueued(event));
	cmd.on("tool_running", (event) => client.onToolRunning(event));
	cmd.on("tool_update", (event) => client.onToolUpdate(event));
	cmd.on("tool_completed", (event) => client.onToolCompleted(event));
	cmd.on("tool_errored", (event) => client.onToolFailed(event, "Tool failed"));
	cmd.on("tool_denied", (event) => client.onToolFailed(event, "Permission denied by the user."));
	cmd.on("tool_hook_blocked", (event) => client.onToolFailed(event, "Blocked by a hook."));
	cmd.on("permission_mode_changed", (event) => client.onModeChanged(event));
	cmd.on("session_titled", (event) => client.onSessionTitled(event));
	cmd.on("run_end", () => client.finishRun());
	cmd.on("interrupted", () => client.finishRun());
	cmd.on("run_error", () => client.finishRun());

	client.startHeartbeat();
}
