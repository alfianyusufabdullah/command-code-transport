import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "dist", "claude-code");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "mod", "claude-code"), out, { recursive: true });

const result = await build({
	entryPoints: [join(root, "mod", "src", "adapters", "claude-code", "register.ts")],
	bundle: true,
	write: false,
	format: "esm",
	platform: "neutral",
	target: "es2022",
	external: ["claude-code"],
	logLevel: "warning",
});

// Claude Code only loads a module whose `register` is declared as an export.
let code = result.outputFiles[0].text;
const declared = /^var register = /m;
const trailer = /^export \{\n {2}register\n\};\n$/m;
if (!declared.test(code) || !trailer.test(code)) {
	console.error("unexpected esbuild output: cannot find `var register` / `export { register }`");
	process.exit(1);
}
code = code.replace(declared, "export const register = ").replace(trailer, "");
writeFileSync(join(out, "hooks", "register.js"), code);

console.log(`built ${out}`);
