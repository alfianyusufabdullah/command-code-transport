import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "dist", "transport.ts");

if (!existsSync(source)) {
	console.error(`missing ${source}`);
	console.error("run `npm run mod:build` first");
	process.exit(1);
}

const directory = join(homedir(), ".commandcode", "mods");
mkdirSync(directory, { recursive: true });

const target = join(directory, "transport.ts");
copyFileSync(source, target);

console.log(`installed ${target}`);
console.log("mod loads automatically in new cmd sessions; run /transport <host>");
