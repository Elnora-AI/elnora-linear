import { describe, expect, it } from "vitest";

import type { LinearConfig } from "../../src/config/types.js";
import { ExternalCommandSource } from "../../src/signals/external-command.js";
import { GithubCommitsSource } from "../../src/signals/github-commits.js";
import { GithubPrSource } from "../../src/signals/github-pr.js";
import { LinearIssuesSource } from "../../src/signals/linear-issues.js";
import { buildSignalSource, IMPLEMENTED_SIGNAL_SOURCE_TYPES } from "../../src/signals/registry.js";
import { SlackMessagesSource } from "../../src/signals/slack-messages.js";

const EMPTY_LINEAR_CONFIG: LinearConfig = {
	teams: { teams: [] },
	projects: { projects: [] },
	users: { users: [] },
	slack: { channels: [], allowed_channels: [], allowed_dm_users: [] },
	repos: { repos: [] },
	signalSources: { sources: [] },
	workflows: { states: [], rules: [] },
	labelPolicy: { policies: {} },
	meta: {
		referencesDir: "/tmp/test",
		bundledReferencesDir: "/tmp/test",
		sources: {
			teams: "placeholder",
			projects: "placeholder",
			users: "placeholder",
			slack: "placeholder",
			repos: "placeholder",
			"signal-sources": "placeholder",
			workflows: "placeholder",
			"label-policy": "placeholder",
		},
	},
};

describe("buildSignalSource", () => {
	it("returns an ExternalCommandSource for external_command", () => {
		const source = buildSignalSource(
			{ type: "external_command", name: "test", command: "echo hi" },
			EMPTY_LINEAR_CONFIG,
		);
		expect(source).toBeInstanceOf(ExternalCommandSource);
		expect(source.config.name).toBe("test");
	});

	it("returns a GithubCommitsSource for github_commits", () => {
		const source = buildSignalSource({ type: "github_commits", name: "ci-commits" }, EMPTY_LINEAR_CONFIG);
		expect(source).toBeInstanceOf(GithubCommitsSource);
	});

	it("returns a GithubPrSource for github_pr", () => {
		const source = buildSignalSource({ type: "github_pr", name: "prs" }, EMPTY_LINEAR_CONFIG);
		expect(source).toBeInstanceOf(GithubPrSource);
	});

	it("returns a SlackMessagesSource for slack_messages", () => {
		const source = buildSignalSource({ type: "slack_messages", name: "slack" }, EMPTY_LINEAR_CONFIG);
		expect(source).toBeInstanceOf(SlackMessagesSource);
	});

	it("returns a LinearIssuesSource for linear_issues", () => {
		const source = buildSignalSource({ type: "linear_issues", name: "linear" }, EMPTY_LINEAR_CONFIG);
		expect(source).toBeInstanceOf(LinearIssuesSource);
	});

	it("throws a 'not yet implemented' error for mcp_tool", () => {
		expect(() =>
			buildSignalSource({ type: "mcp_tool", name: "x", server: "s", tool: "t" }, EMPTY_LINEAR_CONFIG),
		).toThrow(/not yet implemented/);
	});

	it("throws an 'unknown' error for completely unknown types", () => {
		expect(() => buildSignalSource({ type: "made_up", name: "x" } as never, EMPTY_LINEAR_CONFIG)).toThrow(
			/Unknown signal source type/,
		);
	});

	it("exposes the list of currently implemented types", () => {
		expect(IMPLEMENTED_SIGNAL_SOURCE_TYPES).toContain("external_command");
		expect(IMPLEMENTED_SIGNAL_SOURCE_TYPES).toContain("github_commits");
		expect(IMPLEMENTED_SIGNAL_SOURCE_TYPES).toContain("github_pr");
		expect(IMPLEMENTED_SIGNAL_SOURCE_TYPES).toContain("slack_messages");
		expect(IMPLEMENTED_SIGNAL_SOURCE_TYPES).toContain("linear_issues");
	});
});
