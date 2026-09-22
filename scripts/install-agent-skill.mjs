#!/usr/bin/env node

import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(repositoryRoot, ".agents", "skills", "geopanel-agent");
const userHome = homedir();
const targets = [
	{
		agent: "Codex",
		path: join(
			process.env.CODEX_HOME || join(userHome, ".codex"),
			"skills",
			"geopanel-agent",
		),
	},
	{
		agent: "Claude Code",
		path: join(
			process.env.CLAUDE_CONFIG_DIR || join(userHome, ".claude"),
			"skills",
			"geopanel-agent",
		),
	},
];

for (const target of targets) {
	mkdirSync(dirname(target.path), { recursive: true });
	cpSync(source, target.path, { recursive: true, force: true });
	console.log(`${target.agent}: installed geopanel-agent at ${target.path}`);
}

console.log("Restart your agent to load the skill.");
