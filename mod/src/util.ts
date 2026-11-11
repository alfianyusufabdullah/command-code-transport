export const TEXT_LIMIT = 32 * 1024;

export function randomId(length: number): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	let value = "";
	for (let index = 0; index < length; index += 1) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

export function truncate(value: string, limit = TEXT_LIMIT): string {
	return value.length <= limit
		? value
		: `${value.slice(0, limit)}\n… [truncated ${value.length - limit} bytes]`;
}

export function readString(
	input: Record<string, unknown> | undefined,
	...keys: string[]
): string | undefined {
	if (!input) return undefined;
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

export function parseHost(raw: string): string | null {
	const value = raw.trim();
	if (!value) return null;
	const explicit = /^[a-z]+:\/\//i.test(value);
	const withScheme = explicit ? value : `https://${value}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return null;
	}
	const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
	const secure = local && !explicit ? false : url.protocol === "wss:" || url.protocol === "https:";
	if (!secure && !local) return null;
	const protocol = secure ? "wss" : "ws";
	return `${protocol}://${url.host}/agent`;
}
