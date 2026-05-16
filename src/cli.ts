#!/usr/bin/env node
// elnora-linear CLI entrypoint.
//
// Commander-based subcommand dispatcher. Each subcommand is a thin wrapper
// over a function in src/commands/*; the heavy lifting (auth, API calls,
// formatting) happens there.

import { Command } from "commander";
import { runMyIssues } from "./commands/my-issues.js";
import { runSearch } from "./commands/search.js";

const VERSION = "0.0.0";

const program = new Command()
	.name("elnora-linear")
	.description("Linear workspace CLI for Claude Code — search, bulk edit, agents, config-driven curator.")
	.version(VERSION, "-v, --version", "Print version")
	.helpOption("-h, --help", "Show this help");

program
	.command("search")
	.description("Search Linear issues")
	.option("-q, --query <text>", "Search text (matches issue title + description)")
	.option("-t, --team <key>", "Restrict to team key, e.g. ENG")
	.option("-a, --assignee <name>", "Assignee name, email, or 'me'")
	.option("-s, --state <name>", "Workflow state name, e.g. 'In Progress'")
	.option("-l, --limit <n>", "Max results", (v) => Number.parseInt(v, 10), 25)
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action(async (opts) => {
		await runSearch(opts);
	});

program
	.command("my-issues")
	.description("List issues assigned to you")
	.option("-l, --limit <n>", "Max results", (v) => Number.parseInt(v, 10), 25)
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action(async (opts) => {
		await runMyIssues(opts);
	});

try {
	await program.parseAsync(process.argv);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`${message}\n`);
	process.exit(1);
}
