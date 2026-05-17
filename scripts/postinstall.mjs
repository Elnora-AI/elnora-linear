#!/usr/bin/env node
// Postinstall hook for @elnora-ai/linear.
//
// Goal: after the user installs the package, automatically populate the
// reference files (teams/projects/users/workflows) from their Linear workspace
// so the agents and slash commands are personalised on first use — without
// requiring a manual `elnora-linear sync all` step.
//
// Behaviour:
//   - If no API key is reachable, print a friendly notice telling the user how
//     to enable the sync. Never block the install.
//   - If a key is reachable (LINEAR_API_KEY env var, or already saved in
//     ~/.config/elnora-linear/.env), run `sync all` with a hard timeout.
//     Network/API failures degrade to a printed notice.
//   - Always exits 0. A postinstall hook that fails the install is worse than
//     no postinstall hook at all.
//
// Escape hatches (set any of these to skip the auto-sync entirely):
//   - ELNORA_LINEAR_SKIP_POSTINSTALL=1
//   - CI=true                            (most CI systems set this)
//   - npm_config_global=false            (local installs in a project)
//
// The "local install" skip prevents this from firing on every fresh
// node_modules in CI builds, monorepo workspaces, Docker layer caches, etc.
// Global installs (`npm install -g @elnora-ai/linear`) are the user-facing
// path we want to personalise.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = dirname(__dirname);
const CLI_ENTRY = join(PACKAGE_ROOT, "dist", "cli.js");
const ENV_FILE = join(homedir(), ".config", "elnora-linear", ".env");

const SYNC_TIMEOUT_MS = 60_000;

const ESC = "\x1b[";
const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const COLORS = {
	dim: (s) => (useColor() ? `${ESC}2m${s}${ESC}0m` : s),
	yellow: (s) => (useColor() ? `${ESC}33m${s}${ESC}0m` : s),
	green: (s) => (useColor() ? `${ESC}32m${s}${ESC}0m` : s),
	cyan: (s) => (useColor() ? `${ESC}36m${s}${ESC}0m` : s),
};

function log(line) {
	process.stdout.write(`${line}\n`);
}

export function shouldSkip(env = process.env) {
	if (env.ELNORA_LINEAR_SKIP_POSTINSTALL === "1") {
		return "ELNORA_LINEAR_SKIP_POSTINSTALL=1 is set";
	}
	if (env.CI === "true" || env.CI === "1") {
		return "running in CI";
	}
	// npm sets npm_config_global=true for `-g` installs. Anything else (a local
	// install, a yarn workspace, a pnpm dep resolution) skips. Note: npm sets
	// the env var as a literal string.
	if (env.npm_config_global !== undefined && env.npm_config_global !== "true") {
		return "not a global install";
	}
	return null;
}

export function findApiKey(env = process.env, envFile = ENV_FILE) {
	const raw = env.LINEAR_API_KEY?.trim().replace(/^["']|["']$/g, "");
	if (raw?.startsWith("lin_api_")) {
		return { source: "env", value: raw };
	}
	if (existsSync(envFile)) {
		try {
			const content = readFileSync(envFile, "utf8");
			for (const line of content.split("\n")) {
				const match = line.match(/^LINEAR_API_KEY\s*=\s*(.+?)\s*$/);
				if (match) {
					const value = match[1].replace(/^["']|["']$/g, "");
					if (value.startsWith("lin_api_")) {
						return { source: envFile, value };
					}
				}
			}
		} catch {
			// Unreadable env file — fall through to no-key.
		}
	}
	return null;
}

function printAgentPointer() {
	log(
		COLORS.dim(
			"  Agents: see INSTALL_FOR_AGENTS.md in this package for a guided multi-step setup.",
		),
	);
}

function printNoKeyNotice() {
	log("");
	log(COLORS.yellow("⚠  elnora-linear: could not personalise your Linear agents."));
	log("");
	log("   No Linear API key was found, so the reference files");
	log("   (teams, projects, users, workflows) were not populated from");
	log("   your Linear workspace.");
	log("");
	log("   To finish setup:");
	log(`     1. Get a key at ${COLORS.cyan("https://linear.app/settings/api")}`);
	log(`     2. ${COLORS.cyan("export LINEAR_API_KEY=lin_api_...")}`);
	log(`     3. ${COLORS.cyan("elnora-linear sync all")}`);
	log("");
	printAgentPointer();
	log(COLORS.dim("   (Skip this notice with ELNORA_LINEAR_SKIP_POSTINSTALL=1.)"));
	log("");
}

function printFailureNotice(reason) {
	log("");
	log(COLORS.yellow("⚠  elnora-linear: auto-sync did not complete."));
	log(`   ${reason}`);
	log("");
	log(`   You can rerun it any time: ${COLORS.cyan("elnora-linear sync all")}`);
	printAgentPointer();
	log("");
}

function printSuccessNotice() {
	log("");
	log(COLORS.green("✓ elnora-linear: reference files populated from your Linear workspace."));
	log(COLORS.dim("  (teams, projects, users, workflows — refresh any time with `elnora-linear sync all`.)"));
	printAgentPointer();
	log("");
}

function runSync(apiKey, cliEntry = CLI_ENTRY, timeoutMs = SYNC_TIMEOUT_MS) {
	return new Promise((resolve) => {
		if (!existsSync(cliEntry)) {
			resolve({ ok: false, reason: `CLI entry not found at ${cliEntry}` });
			return;
		}
		const child = spawn(process.execPath, [cliEntry, "sync", "all", "--output", "json"], {
			env: { ...process.env, LINEAR_API_KEY: apiKey },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		// Drain stdout so the child doesn't block on a full pipe buffer.
		child.stdout.on("data", () => {});

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			resolve({ ok: false, reason: `sync timed out after ${timeoutMs / 1000}s` });
		}, timeoutMs);

		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ ok: false, reason: err.message });
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve({ ok: true });
			} else {
				const tail = stderr.trim().split("\n").slice(-3).join(" | ") || `exit ${code}`;
				resolve({ ok: false, reason: tail });
			}
		});
	});
}

async function main() {
	if (shouldSkip()) {
		// Silent on skip — postinstall noise during CI/local installs is annoying.
		return;
	}

	const key = findApiKey();
	if (!key) {
		printNoKeyNotice();
		return;
	}

	const result = await runSync(key.value);
	if (result.ok) {
		printSuccessNotice();
	} else {
		printFailureNotice(result.reason);
	}
}

// Only run when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
	main().catch((err) => {
		// Truly defensive: any uncaught error must not fail the install.
		printFailureNotice(err?.message ?? String(err));
	});
}

export const _internal = { runSync, ENV_FILE, CLI_ENTRY };
