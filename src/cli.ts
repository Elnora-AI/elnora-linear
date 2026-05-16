#!/usr/bin/env node
// elnora-linear CLI entrypoint.
// Real commands ship in subsequent commits. This skeleton handles --version and --help
// so that CI's `node dist/cli.js --version|--help` smoke check passes on the empty repo.

const VERSION = "0.0.0";

const arg = process.argv[2];

if (arg === "--version" || arg === "-v") {
	console.log(VERSION);
	process.exit(0);
}

if (!arg || arg === "--help" || arg === "-h") {
	process.stdout.write(
		[
			"elnora-linear — Linear workspace for Claude Code",
			"",
			"Usage:",
			"  elnora-linear <command> [options]",
			"",
			"Commands are being added incrementally. See the repository for status.",
			"",
		].join("\n"),
	);
	process.exit(0);
}

console.error(`Unknown command: ${arg}`);
console.error("Run `elnora-linear --help` for usage.");
process.exit(1);
