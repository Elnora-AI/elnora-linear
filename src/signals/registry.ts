// Build a runtime SignalSource from a config entry.
//
// Only `external_command` is implemented in this PR. The other config types
// declared in schemas/signal-sources.json (github_commits, github_pr,
// slack_messages, linear_issues, mcp_tool) throw a "not yet implemented"
// error so they surface clearly in curator reports rather than silently
// being skipped. Adding a new type means: implement a SignalSourceImpl,
// register it here, and add it to IMPLEMENTED_SIGNAL_SOURCE_TYPES.

import type { SignalSource as ConfigSignalSource } from "../config/types.js";

import { type ExternalCommandConfig, ExternalCommandSource } from "./external-command.js";
import type { SignalSourceImpl } from "./types.js";

export const IMPLEMENTED_SIGNAL_SOURCE_TYPES = ["external_command"] as const;

const DECLARED_BUT_NOT_IMPLEMENTED: ReadonlySet<string> = new Set([
	"github_commits",
	"github_pr",
	"slack_messages",
	"linear_issues",
	"mcp_tool",
]);

export function buildSignalSource(config: ConfigSignalSource): SignalSourceImpl {
	switch (config.type) {
		case "external_command":
			return new ExternalCommandSource(config as ExternalCommandConfig);
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
