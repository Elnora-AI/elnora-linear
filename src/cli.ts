#!/usr/bin/env node
// elnora-linear CLI entrypoint.
//
// Commander-based subcommand dispatcher. Each subcommand is a thin wrapper
// over a function in src/commands/*; the heavy lifting (auth, API calls,
// formatting) happens there.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { runBulk } from "./commands/bulk.js";
import { runCleanup } from "./commands/cleanup.js";
import { setupCompletionCommand } from "./commands/completion.js";
import { runCurator } from "./commands/curator.js";
import { setupCyclesCommand } from "./commands/cycles.js";
import { runMyIssues } from "./commands/my-issues.js";
import { setupQuotaCommand } from "./commands/quota.js";
import { runSearch } from "./commands/search.js";
import { setupStatesCommand } from "./commands/states.js";
import {
	AUTO_SYNC_TARGETS,
	type AutoSyncTarget,
	runSyncAll,
	runSyncImport,
	runSyncTarget,
	runSyncVerify,
} from "./commands/sync.js";
import { setupUsersCommand } from "./commands/users.js";

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as {
	version: string;
};
const VERSION = pkg.version;

function positiveInt(name: string): (raw: string) => number {
	return (raw: string) => {
		const n = Number.parseInt(raw, 10);
		if (!Number.isFinite(n) || n < 1) {
			throw new Error(`${name} must be a positive integer (got "${raw}")`);
		}
		return n;
	};
}

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
	.option("-l, --limit <n>", "Max results", positiveInt("--limit"), 25)
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action(async (opts) => {
		await runSearch(opts);
	});

program
	.command("my-issues")
	.description("List issues assigned to you")
	.option("-l, --limit <n>", "Max results", positiveInt("--limit"), 25)
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
	.option("-l, --limit <n>", "Max issues to touch", positiveInt("--limit"), 100)
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
	.option("--inactive-days <n>", "Issues with no activity for at least N days", positiveInt("--inactive-days"), 30)
	.addOption(
		new Option("--action <action>", "What to do with stale issues")
			.choices(["close", "cancel", "comment"])
			.default("comment"),
	)
	.option("--message <text>", "Comment text (overrides default cleanup message)")
	.option("-l, --limit <n>", "Max issues to consider", positiveInt("--limit"), 100)
	.option("-y, --yes", "Commit the mutations (default is dry-run)", false)
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action(async (opts) => {
		await runCleanup(opts);
	});

const sync = program
	.command("sync")
	.description("Populate or refresh reference files. Run `elnora-linear sync --help` for subcommands.");

sync
	.command("all")
	.description("Refresh every auto-discoverable target (teams, projects, users, workflows)")
	.option("--references-dir <path>", "Override default references directory")
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action(async (opts) => {
		await runSyncAll(opts);
	});

for (const target of AUTO_SYNC_TARGETS) {
	sync
		.command(target)
		.description(`Fetch ${target} from the Linear API and write references/${target}.json`)
		.option("--references-dir <path>", "Override default references directory")
		.option("-o, --output <mode>", "Output mode: text or json", "text")
		.action(async (opts) => {
			await runSyncTarget(target as AutoSyncTarget, opts);
		});
}

sync
	.command("verify")
	.description("Validate every reference file against its schema; report which are user-populated vs placeholder.")
	.option("--references-dir <path>", "Override default references directory")
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action((opts) => {
		runSyncVerify(opts);
	});

sync
	.command("import")
	.description("Import a JSON bundle (top-level keys = reference names) into individual reference files.")
	.requiredOption("--from <path>", "Path to the bundle JSON file")
	.option("--references-dir <path>", "Override default references directory")
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action((opts) => {
		runSyncImport(opts);
	});

program
	.command("curator-run")
	.description("Collect signals from configured signal sources and report. (Rule engine coming in a follow-up.)")
	.option("--source <name>", "Run only the named source (matches signal_sources[].name)")
	.option("--references-dir <path>", "Override default references directory")
	.option("-o, --output <mode>", "Output mode: text or json", "text")
	.action(async (opts) => {
		await runCurator(opts);
	});

setupUsersCommand(program);
setupStatesCommand(program);
setupCyclesCommand(program);
setupQuotaCommand(program);
setupCompletionCommand(program);

try {
	await program.parseAsync(process.argv);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`${message}\n`);
	process.exit(1);
}
