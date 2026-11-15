export type RelayHost = string;

declare module "claude-code" {
	interface PluginState {
		transport: { target: RelayHost; agentId: string };
	}
}
