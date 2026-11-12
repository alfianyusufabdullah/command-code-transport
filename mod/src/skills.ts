import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { SkillInfo } from "./types";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DEPTH = 6;

function frontmatter(raw: string): Record<string, string> {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
	if (!match) return {};
	const values: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!entry) continue;
		let value = entry[2].trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		values[entry[1]] = value;
	}
	return values;
}

function readSkill(dir: string, source: SkillInfo["source"]): SkillInfo | null {
	for (const filename of ["SKILL.md", "skill.md"]) {
		const file = join(dir, filename);
		if (!existsSync(file)) continue;
		let raw: string;
		try {
			raw = readFileSync(file, "utf8");
		} catch {
			return null;
		}
		const meta = frontmatter(raw);
		const name = meta.name || basename(dir);
		const description = meta.description?.trim();
		if (!description || meta["user-invocable"] === "false" || !NAME_PATTERN.test(name)) {
			return null;
		}
		const skill: SkillInfo = { name, description, source };
		if (meta["argument-hint"]) skill.argumentHint = meta["argument-hint"];
		return skill;
	}
	return null;
}

function walk(
	dir: string,
	source: SkillInfo["source"],
	skills: SkillInfo[],
	depth: number,
): void {
	if (depth > MAX_DEPTH) return;
	const skill = readSkill(dir, source);
	if (skill) {
		skills.push(skill);
		return;
	}

	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		walk(join(dir, entry.name), source, skills, depth + 1);
	}
}

export function discoverSkills(cwd: string): SkillInfo[] {
	const project = resolve(cwd);
	const home = homedir();
	const roots: { path: string; source: SkillInfo["source"] }[] = [
		{ path: join(project, ".commandcode", "skills"), source: "project" },
		{ path: join(project, ".agents", "skills"), source: "project" },
		{ path: join(home, ".commandcode", "skills"), source: "user" },
		{ path: join(home, ".agents", "skills"), source: "user" },
	];

	const byName = new Map<string, SkillInfo>();
	for (const root of roots) {
		if (!existsSync(root.path)) continue;
		const found: SkillInfo[] = [];
		walk(root.path, root.source, found, 0);
		for (const skill of found) {
			if (!byName.has(skill.name)) byName.set(skill.name, skill);
		}
	}

	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
