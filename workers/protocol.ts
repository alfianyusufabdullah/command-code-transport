export const PROTOCOL_VERSION = 1;

export type DeliverAs = "steer" | "follow-up";

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AcpTextBlock {
	type: "text";
	text: string;
}

export interface AcpImageBlock {
	type: "image";
	data: string;
	mimeType: string;
}

export type AcpContentBlock = AcpTextBlock | AcpImageBlock;

export interface AcpDiffContent {
	type: "diff";
	path: string;
	oldText: string | null;
	newText: string;
}

export interface AcpTextContent {
	type: "content";
	content: AcpTextBlock;
}

export type AcpToolContent = AcpDiffContent | AcpTextContent;

export interface AcpLocation {
	path: string;
	line?: number;
}

export interface AcpToolCall {
	sessionUpdate: "tool_call";
	toolCallId: string;
	title: string;
	kind: string;
	status: ToolStatus;
	rawInput?: unknown;
	content?: AcpToolContent[];
	locations?: AcpLocation[];
}

export interface AcpToolCallUpdate {
	sessionUpdate: "tool_call_update";
	toolCallId: string;
	status?: ToolStatus;
	title?: string;
	content?: AcpToolContent[];
}

export interface AcpMessageChunk {
	sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk";
	content: AcpContentBlock;
}

export interface AcpPlanEntry {
	content: string;
	priority: "high" | "medium" | "low";
	status: "pending" | "in_progress" | "completed";
}

export interface AcpPlan {
	sessionUpdate: "plan";
	entries: AcpPlanEntry[];
}

export interface AcpCurrentMode {
	sessionUpdate: "current_mode_update";
	currentModeId: string;
}

export interface AcpSessionInfoUpdate {
	sessionUpdate: "session_info_update";
	title?: string;
}

export type SessionUpdate =
	| AcpToolCall
	| AcpToolCallUpdate
	| AcpMessageChunk
	| AcpPlan
	| AcpCurrentMode
	| AcpSessionInfoUpdate;

export interface SnapshotUpdate {
	key: string;
	update: SessionUpdate;
}

export interface SessionInfo {
	agentId: string;
	sessionId: string;
	name: string;
	cwd: string;
	model: string;
	busy: boolean;
	pending?: string;
}

export interface Hello {
	t: "hello";
	v: number;
	agentId: string;
	sessionId: string;
	name: string;
	cwd: string;
	model: string;
	busy: boolean;
	token?: string;
}

export interface StateMessage {
	t: "state";
	agentId: string;
	busy: boolean;
	name?: string;
	model?: string;
}

export interface UpdateMessage {
	t: "update";
	agentId: string;
	seq: number;
	key: string;
	update: SessionUpdate;
}

export interface HistoryPage {
	t: "history_page";
	agentId: string;
	requestId: string;
	updates: SnapshotUpdate[];
	cursor: string | null;
	eof: boolean;
	uptoSeq: number;
}

export interface SkillInfo {
	name: string;
	description: string;
	argumentHint?: string;
	source: "project" | "user";
}

export interface SkillsMessage {
	t: "skills";
	agentId: string;
	skills: SkillInfo[];
}

export interface HistoryChunk {
	t: "history_chunk";
	agentId: string;
	requestId: string;
	updates: SnapshotUpdate[];
	cursor: string | null;
	eof: boolean;
	uptoSeq: number;
	final: boolean;
}

export interface ReplayMessage {
	t: "replay";
	agentId: string;
	updates: SnapshotUpdate[];
}

export interface RunCommitted {
	t: "run_committed";
	agentId: string;
	runId: string;
}

export interface PermissionInteraction {
	t: "interaction";
	agentId: string;
	id: string;
	kind: "permission";
	toolName: string;
	input: unknown;
	description?: string;
	safety: boolean;
}

export interface QuestionOption {
	label: string;
	description?: string;
	preview?: string;
}

export interface Question {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect?: boolean;
}

export interface QuestionInteraction {
	t: "interaction";
	agentId: string;
	id: string;
	kind: "question";
	questions: Question[];
}

export type Interaction = PermissionInteraction | QuestionInteraction;

export type CloseReason = "answered" | "timeout" | "disconnected" | "superseded";

export interface InteractionClosed {
	t: "interaction_closed";
	agentId: string;
	id: string;
	reason: CloseReason;
}

export interface GapMessage {
	t: "gap";
	agentId: string;
	dropped: number;
}

export interface ByeMessage {
	t: "bye";
	agentId: string;
}

export interface PingMessage {
	t: "ping";
}

export interface PongMessage {
	t: "pong";
}

export interface PresenceMessage {
	t: "presence";
	agentId: string;
	browsers: number;
}

export interface PromptMessage {
	t: "prompt";
	agentId: string;
	text: string;
	deliverAs?: DeliverAs;
}

export interface HistoryRequest {
	t: "history";
	agentId: string;
	requestId: string;
	limit: number;
	before: string | null;
	chunks?: boolean;
}

export interface PermissionAnswer {
	t: "answer";
	agentId: string;
	id: string;
	decision: "allow" | "deny";
}

export interface QuestionAnswerEntry {
	questionIndex: number;
	selectedOptions: string[];
}

export interface QuestionAnswer {
	t: "answer";
	agentId: string;
	id: string;
	answers: QuestionAnswerEntry[];
}

export type AnswerMessage = PermissionAnswer | QuestionAnswer;

export interface RelayError {
	t: "error";
	code: string;
	message: string;
	requestId?: string;
}

export interface HelloAck {
	t: "hello_ack";
	v: number;
}

export interface SessionsMessage {
	t: "sessions";
	sessions: SessionInfo[];
}

export type AgentToRelay =
	| Hello
	| StateMessage
	| UpdateMessage
	| SkillsMessage
	| HistoryPage
	| HistoryChunk
	| ReplayMessage
	| RunCommitted
	| Interaction
	| InteractionClosed
	| GapMessage
	| ByeMessage
	| PingMessage;

export type RelayToAgent =
	| HelloAck
	| PromptMessage
	| HistoryRequest
	| AnswerMessage
	| PresenceMessage
	| RelayError
	| PongMessage;

export type WebToRelay = PromptMessage | HistoryRequest | AnswerMessage | PingMessage;

export type RelayToWeb =
	| SessionsMessage
	| UpdateMessage
	| SkillsMessage
	| HistoryPage
	| HistoryChunk
	| ReplayMessage
	| RunCommitted
	| Interaction
	| InteractionClosed
	| GapMessage
	| RelayError;

export type WireMessage = AgentToRelay | RelayToAgent | RelayToWeb | PongMessage;
