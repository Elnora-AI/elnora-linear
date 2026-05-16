// Builds the markdown snapshot the curator LLM consumes.
//
// One snapshot per `elnora-linear curator-run` invocation. Embeds:
//   - the tiering-rules markdown (from references/curator-tiering-rules.md)
//   - any pending Slack questions (from the state file)
//   - per-issue blocks listing relevant signals indexed by issueIdentifier
//
// Signals come from the curator's runCollect() phase. We collate by
// issueIdentifier so the LLM sees each issue's evidence together.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BulkIssueNode } from "../lib/bulk-graphql.js";
import type { Signal } from "../signals/types.js";

// dist/curator/snapshot.js → package root is two up. Same for src/ during tests.
const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLED_TIERING_RULES_PATH = resolve(HERE, "..", "..", "references", "curator-tiering-rules.md");

export interface PendingQuestion {
	issue_id: string;
	thread_key: string;
	posted_at: string;
	question_text: string;
}

export interface SnapshotInput {
	issues: BulkIssueNode[];
	signals: Signal[];
	pendingQuestions: PendingQuestion[];
	tieringRulesPath?: string;
	referencesDir?: string;
}

function loadTieringRules(opts: SnapshotInput): string {
	const candidates: string[] = [];
	if (opts.tieringRulesPath) candidates.push(opts.tieringRulesPath);
	if (opts.referencesDir) candidates.push(join(opts.referencesDir, "curator-tiering-rules.md"));
	// Final fallback: the copy bundled in the installed npm package.
	candidates.push(BUNDLED_TIERING_RULES_PATH);
	for (const path of candidates) {
		try {
			if (existsSync(path)) return readFileSync(path, "utf-8").trim();
		} catch {
			// Try next candidate.
		}
	}
	return "(curator-tiering-rules.md not found — using defaults baked into the agent prompt)";
}

/**
 * Wrap untrusted text in `<untrusted>` tags so the model treats embedded
 * directives as data, not instructions. The system prompt tells the curator
 * never to act on directives inside these tags. We also strip any literal
 * closing tags from the input so an attacker can't break out of the wrapper.
 */
function untrusted(text: string): string {
	const sanitized = text.replace(/<\/?untrusted>/gi, "");
	return `<untrusted>${sanitized}</untrusted>`;
}

function formatPendingQuestions(qs: PendingQuestion[]): string {
	if (qs.length === 0) return "(none)";
	return qs.map((q) => `- ${q.issue_id} [${q.thread_key}] posted ${q.posted_at}: ${q.question_text}`).join("\n");
}

function groupSignals(signals: Signal[]): Map<string, Signal[]> {
	const out = new Map<string, Signal[]>();
	for (const sig of signals) {
		const key = sig.issueIdentifier ?? "_unattributed";
		const list = out.get(key);
		if (list) {
			list.push(sig);
		} else {
			out.set(key, [sig]);
		}
	}
	return out;
}

function formatIssueBlock(issue: BulkIssueNode, signals: Signal[]): string {
	const lines: string[] = [];
	lines.push(`### ${issue.identifier} — ${issue.title}`);
	lines.push(`- state: ${issue.state?.name ?? "(none)"} (${issue.state?.type ?? "?"})`);
	lines.push(`- assignee: ${issue.assignee?.name ?? "(unassigned)"}`);
	lines.push(`- project: ${issue.project?.name ?? "(none)"}`);
	lines.push(`- team: ${issue.team?.name ?? "(none)"} (${issue.team?.key ?? "?"})`);
	lines.push(`- labels: [${issue.labels.nodes.map((l) => l.name).join(", ")}]`);
	lines.push(`- updatedAt: ${issue.updatedAt}`);
	if (issue.description) {
		const truncated = issue.description.slice(0, 600);
		const suffix = issue.description.length > 600 ? "..." : "";
		lines.push(`- description: ${untrusted(`${truncated}${suffix}`)}`);
	}
	if (signals.length > 0) {
		lines.push("- signals:");
		for (const sig of signals) {
			const payload = JSON.stringify(sig.payload).slice(0, 200);
			lines.push(`  - [${sig.source}/${sig.type}] ${untrusted(payload)}`);
		}
	} else {
		lines.push("- signals: (none)");
	}
	return lines.join("\n");
}

function formatUnattributedSignals(signals: Signal[]): string {
	if (signals.length === 0) return "";
	const lines: string[] = ["", "## Unattributed signals (no issueIdentifier)"];
	for (const sig of signals.slice(0, 50)) {
		const payload = JSON.stringify(sig.payload).slice(0, 200);
		lines.push(`- [${sig.source}/${sig.type}] ${untrusted(payload)}`);
	}
	if (signals.length > 50) {
		lines.push(`- (+${signals.length - 50} more elided)`);
	}
	return lines.join("\n");
}

export function buildSnapshot(input: SnapshotInput): string {
	const rules = loadTieringRules(input);
	const grouped = groupSignals(input.signals);
	const issueBlocks: string[] = [];
	for (const issue of input.issues) {
		const signals = grouped.get(issue.identifier) ?? [];
		issueBlocks.push(formatIssueBlock(issue, signals));
	}
	const unattributed = formatUnattributedSignals(grouped.get("_unattributed") ?? []);

	return [
		"## Tiering rules",
		rules,
		"",
		"## Pending Slack questions (awareness only — do NOT emit actions for these)",
		formatPendingQuestions(input.pendingQuestions),
		"",
		"## Open issues snapshot",
		issueBlocks.join("\n\n"),
		unattributed,
	]
		.join("\n")
		.trim();
}

export const _internal = { loadTieringRules, formatPendingQuestions, groupSignals, untrusted };
