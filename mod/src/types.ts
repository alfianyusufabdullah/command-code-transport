export interface Disposable {
	dispose(): void;
}

export interface ModUi {
	notify(message: string): void;
}

export interface CommandContext {
	args: string;
	ui: ModUi;
	cwd: string;
}

export interface ModClock {
	every(ms: number, callback: () => void): Disposable;
	after(ms: number, callback: () => void): Disposable;
}

export interface PermissionInput {
	toolName: string;
	input: unknown;
	description?: string;
	isSafetyPrompt?: boolean;
}

export interface ToolCallInput {
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	state: unknown;
}

export interface ToolCallResult {
	result?: unknown;
	block?: boolean;
	additionalContext?: string;
}

export interface AgentMessageShape {
	role: string;
	content?: unknown;
	meta?: { isMeta?: boolean };
}

export interface ModHooks {
	onPermissionRequest?(input: PermissionInput): "allow" | "deny" | undefined | Promise<"allow" | "deny" | undefined>;
	beforeToolCall?(
		input: ToolCallInput,
		ctx?: unknown,
	): ToolCallResult | undefined | Promise<ToolCallResult | undefined>;
	transformMessage?(input: {
		message: AgentMessageShape;
		state: unknown;
	}): AgentMessageShape | Promise<AgentMessageShape>;
	onSessionStart?(input: { source: string; sessionId?: string }): void;
	onSessionEnd?(input: { reason: string }): void;
}

export interface ModApi {
	name: string;
	cwd: string;
	addCommand(command: {
		name: string;
		description?: string;
		argumentHint?: string;
		handler: (context: CommandContext) => unknown;
	}): Disposable;
	on(event: string, handler: (payload: Record<string, unknown>) => void): Disposable;
	hooks(hooks: ModHooks): Disposable;
	sessions: { leafId(): string | undefined };
	sendUserMessage(text: string, options?: { deliverAs?: "steer" | "follow-up" }): void;
	getSessionName(): string | undefined;
	getModel(): string | undefined;
	isIdle(): boolean;
	ui: ModUi;
	clock?: ModClock;
	state?: {
		get<T>(key: string): T | undefined;
		set<T>(key: string, value: T): void;
	};
}

export type Role = "user" | "assistant";

export type CloseReason = "answered" | "timeout" | "disconnected" | "superseded";

export interface EntryBlock {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	content?: unknown;
	tool_use_id?: string;
}

export interface Entry {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
	name?: string;
	message?: { role: Role; content: EntryBlock[]; meta?: { isMeta?: boolean } };
}

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

export interface AnswerEntry {
	questionIndex: number;
	selectedOptions: string[];
}

export interface Pending {
	finish(value: unknown, reason: CloseReason): void;
	scheduleDisconnect(): void;
}
