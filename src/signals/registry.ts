// Build a runtime SignalSource from a config entry.
//
// Implementations are:
//   external_command   — generic shell extension point
//   github_commits     — git log on configured local repos
//   github_pr          — gh CLI against the configured GitHub repos
//   slack_messages     — Slack conversations.history via SLACK_TOKEN
//   linear_issues      — cross-issue scans (near-dup, x-ref, orphans)
//
// `mcp_tool` is declared in the schema but deferred to a future release.

import type { SignalSource as ConfigSignalSource, LinearConfig } from "../config/types.js";

import { type ExternalCommandConfig, ExternalCommandSource } from "./external-command.js";
import { type GithubCommitsConfig, GithubCommitsSource } from "./github-commits.js";
import { type GithubPrConfig, GithubPrSource } from "./github-pr.js";
import { type LinearIssuesConfig, LinearIssuesSource } from "./linear-issues.js";
import { type SlackMessagesConfig, SlackMessagesSource } from "./slack-messages.js";
import type { SignalSourceImpl } from "./types.js";

export const IMPLEMENTED_SIGNAL_SOURCE_TYPES = [
	"external_command",
	"github_commits",
	"github_pr",
	"slack_messages",
	"linear_issues",
] as const;

const DECLARED_BUT_NOT_IMPLEMENTED: ReadonlySet<string> = new Set(["mcp_tool"]);

export const EXTERNAL_COMMAND_ENV_FLAG = "LINEAR_ALLOW_EXTERNAL_COMMAND";

function externalCommandAllowed(): boolean {
	const v = process.env[EXTERNAL_COMMAND_ENV_FLAG];
	return v === "1" || v === "true";
}

export function buildSignalSource(config: ConfigSignalSource, linearConfig: LinearConfig): SignalSourceImpl {
	switch (config.type) {
		case "external_command":
			if (!externalCommandAllowed()) {
				throw new Error(
					`Signal source "${config.name}" is type "external_command" which executes arbitrary commands from references/signal-sources.json. Refusing to load: set ${EXTERNAL_COMMAND_ENV_FLAG}=1 to opt in. See SAFETY.md for details.`,
				);
			}
			return new ExternalCommandSource(config as ExternalCommandConfig);
		case "github_commits":
			return new GithubCommitsSource(config as GithubCommitsConfig, linearConfig);
		case "github_pr":
			return new GithubPrSource(config as GithubPrConfig, linearConfig);
		case "slack_messages":
			return new SlackMessagesSource(config as SlackMessagesConfig, linearConfig);
		case "linear_issues":
			return new LinearIssuesSource(config as LinearIssuesConfig);
		default:
			if (DECLARED_BUT_NOT_IMPLEMENTED.has(config.type)) {
				throw new Error(
					`Signal source type "${config.type}" is declared in the schema but not yet implemented in this version. Currently supported: ${IMPLEMENTED_SIGNAL_SOURCE_TYPES.join(", ")}.`,
				);
			}
			throw new Error(
				`Unknown signal source type "${config.type}". Supported: ${IMPLEMENTED_SIGNAL_SOURCE_TYPES.join(", ")}.`,
			);
	}
}
