import { describe, expect, it } from "vitest";

import { _internal, loadCuratorSystemPrompt, parseActionsJson } from "../../src/curator/llm.js";

describe("loadCuratorSystemPrompt", () => {
	it("loads the bundled agent prompt and strips YAML frontmatter", () => {
		const prompt = loadCuratorSystemPrompt();
		expect(prompt).not.toMatch(/^---/);
		expect(prompt).toContain("Linear State Curator");
	});

	it("falls back to the bundled default when explicit agentPath doesn't exist", () => {
		// The bundled agents/linear-state-curator.md is always available, so a bad explicit path
		// shouldn't break the load.
		const prompt = loadCuratorSystemPrompt({ agentPath: "/definitely-nonexistent.md" });
		expect(prompt).toContain("Linear State Curator");
	});
});

describe("_internal.stripFences", () => {
	it("strips ```json fences", () => {
		expect(_internal.stripFences('```json\n{"x":1}\n```')).toBe('{"x":1}');
	});
	it("strips plain ``` fences", () => {
		expect(_internal.stripFences('```\n{"y":2}\n```')).toBe('{"y":2}');
	});
	it("leaves unfenced text alone", () => {
		expect(_internal.stripFences('  {"x":1}  ')).toBe('{"x":1}');
	});
});

describe("parseActionsJson", () => {
	it("parses a valid response", () => {
		const raw = JSON.stringify({
			actions: [
				{
					issue_id: "ENG-1",
					tier: "HIGH",
					rule: "H1",
					decision: "set_state",
					from_state: "Todo",
					to_state: "Done",
					rationale: "PR merged",
					signals_cited: ["x"],
				},
			],
			summary: { total_issues_reviewed: 1 },
		});
		const parsed = parseActionsJson(raw);
		expect(parsed.actions).toHaveLength(1);
		expect(parsed.actions[0].tier).toBe("HIGH");
		expect(parsed.summary.total_issues_reviewed).toBe(1);
	});

	it("drops actions with invalid tier", () => {
		const raw = JSON.stringify({
			actions: [
				{ issue_id: "ENG-1", tier: "URGENT", rule: "X", rationale: "?" },
				{ issue_id: "ENG-2", tier: "HIGH", rule: "H1", rationale: "ok" },
			],
		});
		const parsed = parseActionsJson(raw);
		expect(parsed.actions).toHaveLength(1);
		expect(parsed.actions[0].issue_id).toBe("ENG-2");
	});

	it("drops actions missing required fields", () => {
		const raw = JSON.stringify({
			actions: [{ tier: "HIGH" }, { issue_id: "ENG-1", tier: "HIGH", rule: "H1", rationale: "ok" }],
		});
		expect(parseActionsJson(raw).actions).toHaveLength(1);
	});

	it("strips ```json fence when present", () => {
		const raw = '```json\n{"actions":[{"issue_id":"ENG-1","tier":"LOW","rule":"L1","rationale":"stale"}]}\n```';
		expect(parseActionsJson(raw).actions).toHaveLength(1);
	});

	it("throws on non-JSON output", () => {
		expect(() => parseActionsJson("not json")).toThrow(/not valid JSON/);
	});

	it("throws when actions is missing", () => {
		expect(() => parseActionsJson(JSON.stringify({ summary: {} }))).toThrow(/missing/);
	});
});
