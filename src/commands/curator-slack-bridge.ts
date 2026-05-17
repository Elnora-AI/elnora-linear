// `curator-slack-bridge` subcommand.
//
// Thin Node-side wrapper that locates the bundled Python bridge at
// `bridges/slack/bridge.py` and spawns it with the user's args. The CLI
// hydrates ~/.config/elnora-linear/.env at startup (see cli.ts) so by the
// time we spawn python, SLACK_BOT_TOKEN, ANTHROPIC_API_KEY,
// LINEAR_REFERENCES_DIR, etc. are already in process.env and inherited by
// the child via stdio: "inherit".
//
// Why a wrapper and not just docs? Two reasons:
//   1. `bridges/` is bundled inside `node_modules/@elnora-ai/linear/` after
//      `npm install -g`. That path is unpredictable for users (it depends on
//      npm's global prefix). The wrapper computes it once from
//      `import.meta.url` and the user just types `elnora-linear curator-slack-bridge tick`.
//   2. It makes the subcommand discoverable via `elnora-linear --help`.
//
// The bridge still requires `pip install slack-sdk anthropic`. If those
// imports fail inside the bridge, it prints a clear error and exits non-zero
// — we forward that exit code as our own.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/commands/curator-slack-bridge.js → package root is two up; same for
// src/commands/curator-slack-bridge.ts.
const PACKAGE_ROOT = resolve(HERE, "..", "..");
const BRIDGE_PATH = join(PACKAGE_ROOT, "bridges", "slack", "bridge.py");

const PYTHON_CANDIDATES = ["python3", "python"];

function resolvePython(): string {
	const override = process.env.PYTHON_BIN;
	if (override) return override;
	return PYTHON_CANDIDATES[0];
}

export interface CuratorSlackBridgeOptions {
	dryRun?: boolean;
	verbose?: boolean;
}

/**
 * Run the bundled Python Slack bridge with the given mode + flags. Exits the
 * Node process with the bridge's exit code on completion.
 */
export async function runCuratorSlackBridge(
	mode: "post-pending" | "resolve" | "tick",
	opts: CuratorSlackBridgeOptions = {},
): Promise<never> {
	if (!existsSync(BRIDGE_PATH)) {
		process.stderr.write(
			`[error] Could not find the Slack bridge at ${BRIDGE_PATH}.\n` +
				"This usually means `bridges/` was not bundled in this install — try `npm install -g @elnora-ai/linear` again.\n",
		);
		process.exit(2);
	}

	const args = [BRIDGE_PATH, mode];
	if (opts.dryRun) args.push("--dry-run");
	if (opts.verbose) args.push("--verbose");

	const child = spawn(resolvePython(), args, {
		stdio: "inherit",
		env: process.env,
	});

	// The child owns the process exit code. We never resolve this Promise;
	// instead, one of the listeners below calls process.exit and the runtime
	// tears down. Resolving early would let the caller hit
	// `throw new Error("unreachable")` while the child is still running.
	await new Promise<never>((_, reject) => {
		child.on("error", (err) => {
			process.stderr.write(
				`[error] Could not spawn ${resolvePython()}: ${err.message}\n` +
					"Install Python 3.9+ (e.g. `brew install python3` on macOS) or override with PYTHON_BIN=/path/to/python.\n",
			);
			process.exit(127);
		});
		child.on("exit", (code, signal) => {
			if (signal) {
				process.kill(process.pid, signal);
				return;
			}
			process.exit(code ?? 1);
		});
		// reject is unused; kept so TS infers the second parameter.
		void reject;
	});

	// Unreachable — one of the listeners above always calls process.exit first.
	throw new Error("unreachable");
}

export function setupCuratorSlackBridgeCommand(program: Command): void {
	program
		.command("curator-slack-bridge <mode>")
		.description(
			"Run the bundled Slack bridge (Python). Modes: post-pending | resolve | tick. " +
				"Requires `pip install slack-sdk anthropic` and SLACK_BOT_TOKEN + ANTHROPIC_API_KEY in env (or ~/.config/elnora-linear/.env). " +
				"See bridges/slack/README.md.",
		)
		.option("--dry-run", "Log intended actions without posting to Slack or mutating Linear")
		.option("-v, --verbose", "More verbose progress output")
		.action(async (mode: string, opts: CuratorSlackBridgeOptions) => {
			if (mode !== "post-pending" && mode !== "resolve" && mode !== "tick") {
				process.stderr.write(`[error] Unknown bridge mode "${mode}". Expected one of: post-pending, resolve, tick.\n`);
				process.exit(2);
			}
			await runCuratorSlackBridge(mode, opts);
		});
}
