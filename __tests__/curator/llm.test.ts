import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	_internal,
	callCuratorLlm,
	LLM_KEY_ENVS,
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
	const keys = [
		...LLM_KEY_ENVS,
		"LINEAR_CURATOR_MODEL",
		"LLM_PROVIDER",
		"LLM_BASE_URL",
		"LLM_API_KEY",
		"OPENROUTER_SITE_URL",
		"OPENROUTER_APP_NAME",
	];
	const saved: Record<string, string | undefined> = {};
	const fetchCalls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
	beforeEach(() => {
		for (const k of keys) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
		sdk.ctorOpts.length = 0;
		sdk.createArgs.length = 0;
		fetchCalls.length = 0;
		vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string>; body: string }) => {
			fetchCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
			return {
				ok: true,
				json: async () => ({ model: "m", choices: [{ message: { content: '{"actions":[]}' } }] }),
			};
		});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		for (const k of keys) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it("uses OpenRouter over chat completions when only OPENROUTER_API_KEY is set", async () => {
		process.env.OPENROUTER_API_KEY = "or-key";
		expect(resolveLlmProvider()).toMatchObject({ name: "openrouter", keyEnv: "OPENROUTER_API_KEY" });
		await callCuratorLlm("snapshot");
		expect(sdk.ctorOpts).toHaveLength(0);
		expect(fetchCalls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(fetchCalls[0].headers.Authorization).toBe("Bearer or-key");
		expect(fetchCalls[0].headers["X-Title"]).toBe("elnora-linear");
		expect(fetchCalls[0].body.model).toBe("anthropic/claude-sonnet-5");
		expect(fetchCalls[0].body.max_tokens).toBe(16384);
		// OpenRouter would otherwise let the model think through the whole output budget.
		expect(fetchCalls[0].body.reasoning).toEqual({ enabled: false });
	});

	it("uses the Anthropic SDK when only ANTHROPIC_API_KEY is set", async () => {
		process.env.ANTHROPIC_API_KEY = "ant-key";
		expect(resolveLlmProvider()).toMatchObject({ name: "anthropic", baseURL: undefined });
		await callCuratorLlm("snapshot");
		expect(fetchCalls).toHaveLength(0);
		expect(sdk.ctorOpts[0]).toEqual({ apiKey: "ant-key" });
		expect(sdk.createArgs[0].model).toBe("claude-sonnet-4-6");
	});

	it("prefers OpenRouter when both keys are set", async () => {
		process.env.OPENROUTER_API_KEY = "or-key";
		process.env.ANTHROPIC_API_KEY = "ant-key";
		expect(resolveLlmProvider().name).toBe("openrouter");
	});

	it.each([
		["OPENAI_API_KEY", "openai", "https://api.openai.com/v1", "gpt-5"],
		["GEMINI_API_KEY", "google", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-flash-latest"],
		["GROQ_API_KEY", "groq", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b"],
		["DEEPSEEK_API_KEY", "deepseek", "https://api.deepseek.com/v1", "deepseek-chat"],
		["XAI_API_KEY", "xai", "https://api.x.ai/v1", "grok-4.7"],
		["MISTRAL_API_KEY", "mistral", "https://api.mistral.ai/v1", "mistral-large-latest"],
	])("%s alone selects %s", async (keyEnv, name, baseURL, model) => {
		process.env[keyEnv] = "k";
		expect(resolveLlmProvider()).toMatchObject({ name, keyEnv, baseURL, model, problem: undefined });
		await callCuratorLlm("snapshot");
		expect(fetchCalls[0].url).toBe(`${baseURL}/chat/completions`);
		expect(fetchCalls[0].body.model).toBe(model);
	});

	it("sends max_completion_tokens to OpenAI, whose reasoning models reject max_tokens", async () => {
		process.env.OPENAI_API_KEY = "k";
		await callCuratorLlm("snapshot");
		expect(fetchCalls[0].body.max_completion_tokens).toBe(16384);
		expect(fetchCalls[0].body.max_tokens).toBeUndefined();
		expect(fetchCalls[0].body.reasoning).toBeUndefined();
	});

	it("LLM_PROVIDER picks between several keys", () => {
		process.env.OPENROUTER_API_KEY = "or-key";
		process.env.OPENAI_API_KEY = "oa-key";
		process.env.LLM_PROVIDER = "openai";
		expect(resolveLlmProvider()).toMatchObject({ name: "openai", apiKey: "oa-key" });
		process.env.LLM_PROVIDER = "gemini";
		expect(resolveLlmProvider()).toMatchObject({ name: "google", problem: "GOOGLE_GENERATIVE_AI_API_KEY not set" });
		process.env.LLM_PROVIDER = "nope";
		expect(resolveLlmProvider().problem).toMatch(/unknown LLM_PROVIDER "nope"/);
	});

	it("LLM_BASE_URL drives any OpenAI-compatible endpoint", async () => {
		process.env.LLM_BASE_URL = "http://localhost:11434/v1/";
		process.env.LLM_API_KEY = "local";
		expect(resolveLlmProvider().problem).toBe("custom provider needs LINEAR_CURATOR_MODEL");
		process.env.LINEAR_CURATOR_MODEL = "llama3";
		expect(resolveLlmProvider()).toMatchObject({ name: "custom", model: "llama3", problem: undefined });
		await callCuratorLlm("snapshot");
		expect(fetchCalls[0].url).toBe("http://localhost:11434/v1/chat/completions");
		expect(fetchCalls[0].body.model).toBe("llama3");
	});

	it("honours LINEAR_CURATOR_MODEL, e.g. openrouter/auto", async () => {
		process.env.OPENROUTER_API_KEY = "or-key";
		process.env.LINEAR_CURATOR_MODEL = "openrouter/auto";
		await callCuratorLlm("snapshot");
		expect(fetchCalls[0].body.model).toBe("openrouter/auto");
	});

	it("surfaces an HTTP error with the provider name", async () => {
		process.env.OPENAI_API_KEY = "k";
		vi.stubGlobal("fetch", async () => ({ ok: false, status: 401, text: async () => "bad key" }));
		await expect(callCuratorLlm("snapshot")).rejects.toThrow(/Curator LLM \(openai\) returned HTTP 401: bad key/);
	});

	it("reports the missing key when nothing is set", async () => {
		expect(resolveLlmProvider().problem).toMatch(/^no LLM key set; set one of OPENROUTER_API_KEY, ANTHROPIC_API_KEY/);
		await expect(callCuratorLlm("snapshot")).rejects.toThrow(/no LLM key set/);
	});
});
