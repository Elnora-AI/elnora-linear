// LLM client for the curator. Any LLM key drives it.
//
// One model call per curator run. The system prompt is the body of
// `agents/linear-state-curator.md` (loaded at runtime); the user content is
// the markdown snapshot from `snapshot.ts`. Response shape is parsed by
// `parseActionsJson`. Anthropic goes through its SDK; every other provider
// speaks OpenAI Chat Completions over fetch.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/curator/llm.js → package root is two up; same for src/curator/llm.ts.
const PACKAGE_ROOT = resolve(HERE, "..", "..");
const BUNDLED_AGENT_PATH = join(PACKAGE_ROOT, "agents", "linear-state-curator.md");

export interface CuratorActionBase {
	issue_id: string;
	tier: "HIGH" | "MEDIUM" | "LOW";
	rule: string;
	rationale: string;
}

export interface CuratorHighAction extends CuratorActionBase {
	tier: "HIGH";
	decision: "set_state";
	from_state: string;
	to_state: string;
	signals_cited: string[];
}

export interface CuratorMediumAction extends CuratorActionBase {
	tier: "MEDIUM";
	decision: "ask_in_slack";
	proposed_action: { type: "set_state"; from: string; to: string };
	alternative_action?: { type: "set_state"; from: string; to: string };
	question_text: string;
	signals_cited: string[];
}

export interface CuratorLowAction extends CuratorActionBase {
	tier: "LOW";
	decision: "report_only";
}

export type CuratorAction = CuratorHighAction | CuratorMediumAction | CuratorLowAction;

export interface CuratorResponse {
	actions: CuratorAction[];
	summary: {
		total_issues_reviewed?: number;
		high_count?: number;
		medium_count?: number;
		low_count?: number;
		skipped_no_signal?: number;
		notes?: string;
	};
}

export function loadCuratorSystemPrompt(opts: { agentPath?: string } = {}): string {
	const candidates: string[] = [];
	if (opts.agentPath) candidates.push(opts.agentPath);
	candidates.push(BUNDLED_AGENT_PATH);
	for (const path of candidates) {
		try {
			if (existsSync(path)) {
				const raw = readFileSync(path, "utf-8");
				// Strip the YAML frontmatter; the body is the prompt.
				const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
				return (match ? match[1] : raw).trim();
			}
		} catch {
			// Try next candidate.
		}
	}
	throw new Error(
		"Could not locate agents/linear-state-curator.md for curator system prompt. Pass agentPath explicitly.",
	);
}

/**
 * Strip ```json fences (the LLM sometimes adds them despite the contract).
 */
function stripFences(text: string): string {
	const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
	return fenced ? fenced[1].trim() : text.trim();
}

/**
 * Extract the first complete top-level `{...}` object from text. Used as a
 * fallback when the model prepends prose ("I'll analyze...") or appends a
 * trailing sentence despite the prompt forbidding it. Returns null if no
 * brace-balanced object can be found.
 */
function extractFirstJsonObject(text: string): string | null {
	const start = text.indexOf("{");
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}

export function parseActionsJson(raw: string): CuratorResponse {
	const trimmed = stripFences(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (firstErr) {
		// Fallback: model added prose around the JSON. Extract the first balanced
		// {...} block and try again.
		const extracted = extractFirstJsonObject(trimmed);
		if (extracted === null) {
			throw new Error(`Curator LLM output is not valid JSON: ${(firstErr as Error).message}`);
		}
		try {
			parsed = JSON.parse(extracted);
		} catch (secondErr) {
			throw new Error(`Curator LLM output is not valid JSON: ${(secondErr as Error).message}`);
		}
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("Curator LLM output must be a JSON object.");
	}
	const obj = parsed as { actions?: unknown; summary?: unknown };
	if (!Array.isArray(obj.actions)) {
		throw new Error("Curator LLM output is missing `actions` array.");
	}
	const validActions: CuratorAction[] = [];
	for (const raw of obj.actions) {
		if (typeof raw !== "object" || raw === null) continue;
		const a = raw as Partial<CuratorAction>;
		if (!a.issue_id || !a.tier || !a.rule) continue;
		if (a.tier !== "HIGH" && a.tier !== "MEDIUM" && a.tier !== "LOW") continue;
		validActions.push(a as CuratorAction);
	}
	const summary =
		typeof obj.summary === "object" && obj.summary !== null ? (obj.summary as CuratorResponse["summary"]) : {};
	return { actions: validActions, summary };
}

export interface CuratorLlmOptions {
	model?: string;
	apiKey?: string;
	maxTokens?: number;
	agentPath?: string;
}

// Curator JSON response easily reaches 8-12k tokens for workspaces with
// hundreds of open issues; 4096 truncates mid-string at that scale.
const DEFAULT_MAX_TOKENS = 16384;

/**
 * The provider is picked in this order:
 *
 *   1. LLM_PROVIDER, when set (openrouter | anthropic | openai | google | groq |
 *      deepseek | xai | mistral | custom)
 *   2. LLM_BASE_URL, when set → custom: any OpenAI-compatible endpoint (Azure
 *      OpenAI, Together, Fireworks, LiteLLM, a self-hosted vLLM/Ollama, …) with
 *      LLM_API_KEY and LINEAR_CURATOR_MODEL
 *   3. the first provider below whose API key is set
 *
 * LINEAR_CURATOR_MODEL overrides the provider's default model. OpenRouter
 * comes first because the Jev check before a HIGH action needs that key
 * anyway. openrouter/auto is not its default: it routes this prompt to
 * reasoning models that spend the whole output budget thinking and return
 * no text. Set LINEAR_CURATOR_MODEL=openrouter/auto to opt in anyway.
 */
interface Provider {
	/** Env vars that may hold the key; the first one set wins. */
	keys: string[];
	model: string;
	/** OpenAI-compatible endpoint. Absent = the Anthropic SDK. */
	baseURL?: string;
}

export const PROVIDERS: Record<string, Provider> = {
	openrouter: {
		keys: ["OPENROUTER_API_KEY"],
		model: "anthropic/claude-sonnet-5",
		baseURL: "https://openrouter.ai/api/v1",
	},
	anthropic: { keys: ["ANTHROPIC_API_KEY"], model: "claude-sonnet-4-6" },
	openai: { keys: ["OPENAI_API_KEY"], model: "gpt-5", baseURL: "https://api.openai.com/v1" },
	google: {
		keys: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
		model: "gemini-flash-latest",
		baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
	},
	groq: { keys: ["GROQ_API_KEY"], model: "openai/gpt-oss-120b", baseURL: "https://api.groq.com/openai/v1" },
	deepseek: { keys: ["DEEPSEEK_API_KEY"], model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1" },
	xai: { keys: ["XAI_API_KEY"], model: "grok-4.7", baseURL: "https://api.x.ai/v1" },
	mistral: { keys: ["MISTRAL_API_KEY"], model: "mistral-large-latest", baseURL: "https://api.mistral.ai/v1" },
};

const ALIASES: Record<string, string> = { gemini: "google", grok: "xai", "openai-compatible": "custom" };

export const LLM_KEY_ENVS = Object.values(PROVIDERS).flatMap((p) => p.keys);

export interface ResolvedLlmProvider {
	name: string;
	model: string;
	apiKey?: string;
	/** Env var the key came from, for reports. Never the value. */
	keyEnv?: string;
	baseURL?: string;
	/** Why the curator can't call a model as configured; undefined when it can. */
	problem?: string;
}

function env(name: string): string | undefined {
	return process.env[name]?.trim() || undefined;
}

export function resolveLlmProvider(): ResolvedLlmProvider {
	const requested = env("LLM_PROVIDER")?.toLowerCase();
	const name = requested ? (ALIASES[requested] ?? requested) : undefined;
	const modelOverride = env("LINEAR_CURATOR_MODEL");

	if (name === "custom" || (!name && env("LLM_BASE_URL"))) {
		const baseURL = env("LLM_BASE_URL");
		const model = modelOverride ?? "";
		const missing = [!baseURL && "LLM_BASE_URL", !model && "LINEAR_CURATOR_MODEL"].filter(Boolean);
		return {
			name: "custom",
			model,
			baseURL,
			apiKey: env("LLM_API_KEY"),
			keyEnv: "LLM_API_KEY",
			problem: missing.length ? `custom provider needs ${missing.join(" and ")}` : undefined,
		};
	}

	if (name && !PROVIDERS[name]) {
		return {
			name,
			model: modelOverride ?? "",
			problem: `unknown LLM_PROVIDER "${name}"; use one of ${[...Object.keys(PROVIDERS), "custom"].join(", ")}`,
		};
	}

	const detected = name ?? Object.keys(PROVIDERS).find((p) => PROVIDERS[p].keys.some((k) => env(k)));
	if (!detected) {
		return {
			name: "anthropic",
			model: modelOverride ?? PROVIDERS.anthropic.model,
			keyEnv: "ANTHROPIC_API_KEY",
			problem: `no LLM key set; set one of ${LLM_KEY_ENVS.join(", ")}, or LLM_BASE_URL for an OpenAI-compatible endpoint`,
		};
	}

	const provider = PROVIDERS[detected];
	const keyEnv = provider.keys.find((k) => env(k)) ?? provider.keys[0];
	const apiKey = env(keyEnv);
	return {
		name: detected,
		model: modelOverride ?? provider.model,
		apiKey,
		keyEnv,
		baseURL: provider.baseURL,
		problem: apiKey ? undefined : `${keyEnv} not set`,
	};
}

async function anthropicText(p: ResolvedLlmProvider, system: string, user: string, maxTokens: number): Promise<string> {
	const Anthropic = (await import("@anthropic-ai/sdk")).default;
	const client = new Anthropic({ apiKey: p.apiKey });
	const res = await client.messages.create({
		model: p.model,
		max_tokens: maxTokens,
		system,
		messages: [{ role: "user", content: user }],
	});
	const textParts: string[] = [];
	for (const block of res.content ?? []) {
		if ((block as { type?: string }).type === "text") {
			const t = (block as { text?: unknown }).text;
			if (typeof t === "string") textParts.push(t);
		}
	}
	if (textParts.length === 0) {
		const blocks = (res.content ?? []).map((b) => (b as { type?: string }).type).join(",") || "none";
		throw new Error(
			`Curator LLM returned no text content (model=${res.model}, stop_reason=${res.stop_reason}, blocks=${blocks}).`,
		);
	}
	return textParts.join("");
}

/** OpenAI Chat Completions, which every non-Anthropic provider above serves. */
async function chatCompletionsText(
	p: ResolvedLlmProvider,
	system: string,
	user: string,
	maxTokens: number,
): Promise<string> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${p.apiKey ?? ""}`,
		"Content-Type": "application/json",
	};
	if (p.name === "openrouter") {
		headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL ?? "https://github.com/Elnora-AI/elnora-linear";
		headers["X-Title"] = process.env.OPENROUTER_APP_NAME ?? "elnora-linear";
	}
	// OpenAI's reasoning models reject max_tokens; everyone else still expects it.
	const budget = p.name === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
	// OpenRouter switches reasoning on for models that support it. The snapshot runs to
	// 200k tokens, and on 2026-09-24 anthropic/claude-sonnet-5 spent the whole 16k output
	// budget thinking about it and returned no text. The curator wants the JSON, not the
	// deliberation, so reasoning is off for every model on that route.
	const reasoning = p.name === "openrouter" ? { reasoning: { enabled: false } } : {};
	const res = await fetch(`${(p.baseURL ?? "").replace(/\/+$/, "")}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: p.model,
			...budget,
			...reasoning,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
		}),
	});
	if (!res.ok) {
		throw new Error(`Curator LLM (${p.name}) returned HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
	}
	const body = (await res.json()) as {
		model?: string;
		choices?: { message?: { content?: unknown }; finish_reason?: string }[];
	};
	const content = body.choices?.[0]?.message?.content;
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.map((part) =>
							typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "",
						)
						.join("")
				: "";
	if (!text) {
		throw new Error(
			`Curator LLM returned no text content (model=${body.model ?? p.model}, finish_reason=${body.choices?.[0]?.finish_reason ?? "none"}).`,
		);
	}
	return text;
}

/**
 * Run the curator LLM call. Returns the parsed response. Throws when no
 * usable LLM provider is configured (caller catches and surfaces in the
 * report).
 */
export async function callCuratorLlm(snapshot: string, opts: CuratorLlmOptions = {}): Promise<CuratorResponse> {
	const resolved = resolveLlmProvider();
	if (resolved.problem) {
		throw new Error(`Cannot run the LLM phase of the curator: ${resolved.problem}.`);
	}
	const p: ResolvedLlmProvider = {
		...resolved,
		model: opts.model ?? resolved.model,
		apiKey: opts.apiKey ?? resolved.apiKey,
	};
	const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
	const system = loadCuratorSystemPrompt({ agentPath: opts.agentPath });
	// Append a hard JSON-only directive to the system prompt. Models that
	// support assistant-message prefill could enforce this structurally; for
	// models that don't (e.g. claude-sonnet-4-6), an explicit "first character
	// must be `{`" instruction combined with the brace-balanced fallback in
	// parseActionsJson keeps the success rate high.
	const enforcedSystem = `${system}\n\n---\n\nFINAL OUTPUT RULE: Your response MUST be a single JSON object and nothing else. The FIRST CHARACTER of your response MUST be the literal "{" and the LAST CHARACTER MUST be the literal "}". Do not include any preamble such as "Analyzing the snapshot…" or any trailing sentence. Do not wrap the JSON in markdown code fences. Do not narrate your reasoning — emit only the object.`;
	const text = p.baseURL
		? await chatCompletionsText(p, enforcedSystem, snapshot, maxTokens)
		: await anthropicText(p, enforcedSystem, snapshot, maxTokens);
	return parseActionsJson(text);
}

export const _internal = { stripFences, BUNDLED_AGENT_PATH };
