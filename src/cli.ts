#!/usr/bin/env node
// elnora-linear CLI entrypoint.
//
// Commander-based subcommand dispatcher. Each subcommand is a thin wrapper
// over a function in src/commands/*; the heavy lifting (auth, API calls,
// formatting) happens there.

import { Command, Option } from "commander";
import { runBulk } from "./commands/bulk.js";
import { runCleanup } from "./commands/cleanup.js";
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

program
	.command("bulk")
	.description("Apply the same change to many issues. Default is dry-run; pass --yes to commit.")
	.option("-q, --query <text>", "Filter: search text")
	.option("-t, --team <key>", "Filter: team key")
	.option("-a, --assignee <name>", "Filter: assignee name, email, or 'me'")
	.option("-s, --state <name>", "Filter: workflow state name")
	.option("--set-state <name>", "Mutation: move matching issues to this state")
	.option("--add-comment <text>", "Mutation: add this comment to each matching issue")
	.option("-l, --limit <n>", "Max issues to touch", (v) => Number.parseInt(v, 10), 100)
	.option("-y, --yes", "Commit the mutations (default is dry-run)", false)
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action(async (opts) => {
		await runBulk(opts);
	});

program
	.command("cleanup")
	.description("Find stale issues and act on them. Default is dry-run; pass --yes to commit.")
	.option("-t, --team <key>", "Filter: team key")
	.option("-s, --states <names>", 'Filter: comma-separated state names (default "Todo,Backlog")', (v: string) =>
		v.split(",").map((s) => s.trim()),
	)
	.option("--inactive-days <n>", "Issues with no activity for at least N days", (v) => Number.parseInt(v, 10), 30)
	.addOption(
		new Option("--action <action>", "What to do with stale issues")
			.choices(["close", "cancel", "comment"])
			.default("comment"),
	)
	.option("--message <text>", "Comment text (overrides default cleanup message)")
	.option("-l, --limit <n>", "Max issues to consider", (v) => Number.parseInt(v, 10), 100)
	.option("-y, --yes", "Commit the mutations (default is dry-run)", false)
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action(async (opts) => {
		await runCleanup(opts);
	});

try {
	await program.parseAsync(process.argv);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`${message}\n`);
	process.exit(1);
}
