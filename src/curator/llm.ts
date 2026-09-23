// Anthropic-API client for the curator.
//
// One Messages.create() call per curator run. The system prompt is the body
// of `agents/linear-state-curator.md` (loaded at runtime); the user content is
// the markdown snapshot from `snapshot.ts`. Response shape is parsed by
// `parseActionsJson`.

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

const DEFAULT_MODEL = "claude-sonnet-4-6";
// openrouter/auto is not the default: it routes this prompt to reasoning models
// that spend the whole output budget thinking and return no text. Set
// LINEAR_CURATOR_MODEL=openrouter/auto to opt in anyway.
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-5";
// Curator JSON response easily reaches 8-12k tokens for workspaces with
// hundreds of open issues; 4096 truncates mid-string at that scale.
const DEFAULT_MAX_TOKENS = 16384;

/** OPENROUTER_API_KEY wins when set; otherwise ANTHROPIC_API_KEY goes to Anthropic directly. */
export function resolveLlmProvider(): "openrouter" | "anthropic" | null {
	if (process.env.OPENROUTER_API_KEY) return "openrouter";
	if (process.env.ANTHROPIC_API_KEY) return "anthropic";
	return null;
}

/**
 * Run the curator LLM call. Returns the parsed response. Throws when neither
 * OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set (caller catches and
 * surfaces in the report).
 */
export async function callCuratorLlm(snapshot: string, opts: CuratorLlmOptions = {}): Promise<CuratorResponse> {
	const provider = resolveLlmProvider();
	if (!provider) {
		throw new Error(
			"Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set; cannot run the LLM phase of the curator.",
		);
	}
	const openrouter = provider === "openrouter";
	const apiKey = opts.apiKey ?? (openrouter ? process.env.OPENROUTER_API_KEY : process.env.ANTHROPIC_API_KEY);
	const model =
		opts.model ?? (process.env.LINEAR_CURATOR_MODEL || (openrouter ? DEFAULT_OPENROUTER_MODEL : DEFAULT_MODEL));
	const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
	const system = loadCuratorSystemPrompt({ agentPath: opts.agentPath });

	const Anthropic = (await import("@anthropic-ai/sdk")).default;
	const client = openrouter
		? // OpenRouter's Anthropic-compatible endpoint; the SDK appends /v1/messages.
			new Anthropic({
				apiKey,
				baseURL: "https://openrouter.ai/api",
				defaultHeaders: {
					"HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://github.com/Elnora-AI/elnora-linear",
					"X-Title": process.env.OPENROUTER_APP_NAME ?? "elnora-linear",
				},
			})
		: new Anthropic({ apiKey });
	// Append a hard JSON-only directive to the system prompt. Models that
	// support assistant-message prefill could enforce this structurally; for
	// models that don't (e.g. claude-sonnet-4-6), an explicit "first character
	// must be `{`" instruction combined with the brace-balanced fallback in
	// parseActionsJson keeps the success rate high.
	const enforcedSystem = `${system}\n\n---\n\nFINAL OUTPUT RULE: Your response MUST be a single JSON object and nothing else. The FIRST CHARACTER of your response MUST be the literal "{" and the LAST CHARACTER MUST be the literal "}". Do not include any preamble such as "Analyzing the snapshot…" or any trailing sentence. Do not wrap the JSON in markdown code fences. Do not narrate your reasoning — emit only the object.`;
	const res = await client.messages.create({
		model,
		max_tokens: maxTokens,
		system: enforcedSystem,
		messages: [{ role: "user", content: snapshot }],
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
	return parseActionsJson(textParts.join(""));
}

export const _internal = { stripFences, BUNDLED_AGENT_PATH };
