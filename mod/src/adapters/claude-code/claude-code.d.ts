declare module "claude-code" {
	type Hook = (...args: any[]) => any;
	export type Register = (on: (event: string, ...args: [Hook] | [object, Hook]) => unknown, options?: unknown) => void;
}

declare class URL {
	constructor(url: string, base?: string);
	readonly host: string;
	readonly hostname: string;
	readonly port: string;
	readonly protocol: string;
}
