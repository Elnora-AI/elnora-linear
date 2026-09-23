import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	_internal,
	callCuratorLlm,
	loadCuratorSystemPrompt,
	parseActionsJson,
	resolveLlmProvider,
} from "../../src/curator/llm.js";

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

	it("recovers when the model prepends a prose preamble", () => {
		const raw =
			'I\'ll analyze the snapshot now.\n\n{"actions":[{"issue_id":"ENG-1","tier":"LOW","rule":"L1","rationale":"stale"}],"summary":{}}';
		expect(parseActionsJson(raw).actions).toHaveLength(1);
	});

	it("recovers when the model appends a trailing sentence", () => {
		const raw =
			'{"actions":[{"issue_id":"ENG-1","tier":"HIGH","rule":"H1","rationale":"ok"}],"summary":{}}\n\nLet me know if you need clarification.';
		expect(parseActionsJson(raw).actions).toHaveLength(1);
	});

	it("handles braces inside string values without false-closing the object", () => {
		const raw =
			'Prelude.\n{"actions":[{"issue_id":"ENG-1","tier":"LOW","rule":"L1","rationale":"contains } closing brace in text"}],"summary":{}}';
		const parsed = parseActionsJson(raw);
		expect(parsed.actions).toHaveLength(1);
		expect(parsed.actions[0].rationale).toContain("} closing brace");
	});
});

const sdk = vi.hoisted(() => ({
	ctorOpts: [] as Record<string, unknown>[],
	createArgs: [] as Record<string, unknown>[],
}));
vi.mock("@anthropic-ai/sdk", () => ({
	default: class {
		messages = {
			create: async (args: Record<string, unknown>) => {
				sdk.createArgs.push(args);
				return { content: [{ type: "text", text: '{"actions":[]}' }] };
			},
		};
		constructor(opts: Record<string, unknown>) {
			sdk.ctorOpts.push(opts);
		}
	},
}));

describe("LLM provider selection", () => {
	const keys = ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "LINEAR_CURATOR_MODEL"] as const;
	const saved: Record<string, string | undefined> = {};
	beforeEach(() => {
		for (const k of keys) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
		sdk.ctorOpts.length = 0;
		sdk.createArgs.length = 0;
	});
	afterEach(() => {
		for (const k of keys) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it("uses OpenRouter when only OPENROUTER_API_KEY is set", async () => {
		process.env.OPENROUTER_API_KEY = "or-key";
		expect(resolveLlmProvider()).toBe("openrouter");
		await callCuratorLlm("snapshot");
		expect(sdk.ctorOpts[0]).toMatchObject({ apiKey: "or-key", baseURL: "https://openrouter.ai/api" });
		expect(sdk.createArgs[0].model).toBe("anthropic/claude-sonnet-5");
	});

	it("uses Anthropic directly when only ANTHROPIC_API_KEY is set", async () => {
		process.env.ANTHROPIC_API_KEY = "ant-key";
		expect(resolveLlmProvider()).toBe("anthropic");
		await callCuratorLlm("snapshot");
		expect(sdk.ctorOpts[0]).toEqual({ apiKey: "ant-key" });
		expect(sdk.createArgs[0].model).toBe("claude-sonnet-4-6");
	});

	it("prefers OpenRouter when both keys are set", async () => {
		process.env.OPENROUTER_API_KEY = "or-key";
		process.env.ANTHROPIC_API_KEY = "ant-key";
		expect(resolveLlmProvider()).toBe("openrouter");
		await callCuratorLlm("snapshot");
		expect(sdk.ctorOpts[0]).toMatchObject({ apiKey: "or-key", baseURL: "https://openrouter.ai/api" });
	});

	it("honours LINEAR_CURATOR_MODEL, e.g. openrouter/auto", async () => {
		process.env.OPENROUTER_API_KEY = "or-key";
		process.env.LINEAR_CURATOR_MODEL = "openrouter/auto";
		await callCuratorLlm("snapshot");
		expect(sdk.createArgs[0].model).toBe("openrouter/auto");
	});

	it("throws when neither key is set", async () => {
		expect(resolveLlmProvider()).toBeNull();
		await expect(callCuratorLlm("snapshot")).rejects.toThrow(/Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY/);
	});
});
