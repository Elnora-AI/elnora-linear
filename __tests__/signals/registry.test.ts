import { describe, expect, it } from "vitest";

import { ExternalCommandSource } from "../../src/signals/external-command.js";
import { buildSignalSource, IMPLEMENTED_SIGNAL_SOURCE_TYPES } from "../../src/signals/registry.js";

describe("buildSignalSource", () => {
	it("returns an ExternalCommandSource for external_command", () => {
		const source = buildSignalSource({
			type: "external_command",
			name: "test",
			command: "echo hi",
		});
		expect(source).toBeInstanceOf(ExternalCommandSource);
		expect(source.config.name).toBe("test");
	});

	it.each([
		"github_commits",
		"github_pr",
		"slack_messages",
		"linear_issues",
		"mcp_tool",
	])("throws a 'not yet implemented' error for declared-but-unimplemented type %s", (type) => {
		expect(() => buildSignalSource({ type, name: "x" } as never)).toThrow(/not yet implemented/);
	});

	it("throws an 'unknown' error for completely unknown types", () => {
		expect(() => buildSignalSource({ type: "made_up", name: "x" } as never)).toThrow(/Unknown signal source type/);
	});

	it("exposes the list of currently implemented types", () => {
		expect(IMPLEMENTED_SIGNAL_SOURCE_TYPES).toContain("external_command");
	});
});
