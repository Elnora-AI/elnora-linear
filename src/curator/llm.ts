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

export function parseActionsJson(raw: string): CuratorResponse {
	const trimmed = stripFences(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (err) {
		throw new Error(`Curator LLM output is not valid JSON: ${(err as Error).message}`);
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
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Run the curator LLM call. Returns the parsed response. Throws on missing
 * ANTHROPIC_API_KEY (caller catches and surfaces in the report).
 */
export async function callCuratorLlm(snapshot: string, opts: CuratorLlmOptions = {}): Promise<CuratorResponse> {
	const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error("ANTHROPIC_API_KEY not set; cannot run the LLM phase of the curator.");
	}
	const model = opts.model ?? process.env.LINEAR_CURATOR_MODEL ?? DEFAULT_MODEL;
	const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
	const system = loadCuratorSystemPrompt({ agentPath: opts.agentPath });

	const Anthropic = (await import("@anthropic-ai/sdk")).default;
	const client = new Anthropic({ apiKey });
	const res = await client.messages.create({
		model,
		max_tokens: maxTokens,
		system,
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
		throw new Error("Curator LLM returned no text content.");
	}
	return parseActionsJson(textParts.join(""));
}

export const _internal = { stripFences, BUNDLED_AGENT_PATH };
