// Curator action dispatcher.
//
// HIGH actions auto-apply (state change + rationale comment) up to MAX_MUTATIONS.
// MEDIUM actions queue as pending questions in the state file — the Slack
// integration (or a bot) is responsible for actually posting them; the
// dispatcher just stages the question + sets the debounce key.
// LOW actions go straight to the report (no side effects).
//
// All applied actions are recorded in `curator-report.jsonl` for audit.

import type { LinearClient } from "@linear/sdk";
import { resolveStateId } from "../lib/bulk-graphql.js";
import { withRateLimit } from "../utils/rate-limit.js";
import type { CuratorAction, CuratorHighAction, CuratorMediumAction } from "./llm.js";
import { appendReportLine, type CuratorState, debounceKey } from "./state.js";

export const MAX_MUTATIONS = 20;
export const MAX_MEDIUM_QUEUED = 10;

export interface DispatchOptions {
	dryRun?: boolean;
	stateDir?: string;
	maxMutations?: number;
	maxMedium?: number;
	now?: Date;
	/** Test hook: override the actual Linear mutation path. */
	applyHigh?: (client: LinearClient, action: CuratorHighAction) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface DispatchResult {
	applied: { issue_id: string; rule: string; from: string; to: string }[];
	queued: { issue_id: string; rule: string; thread_key: string }[];
	reported: { issue_id: string; rule: string; rationale: string }[];
	skipped: { issue_id: string; rule: string; reason: string }[];
}

/**
 * Has this action been queued or applied within the debounce window?
 */
function isDebounced(state: CuratorState, action: CuratorAction, _now: Date): boolean {
	if (action.tier === "HIGH") {
		const key = debounceKey(action.issue_id, {
			from: action.from_state,
			to: action.to_state,
		});
		return state.pending_questions.some((q) => q.thread_key === key) || state.processed_thread_keys.includes(key);
	}
	if (action.tier === "MEDIUM") {
		const proposed = action.proposed_action;
		const key = debounceKey(action.issue_id, { type: proposed.type, from: proposed.from, to: proposed.to });
		const recentlyAsked = state.pending_questions.some((q) => q.thread_key === key);
		if (recentlyAsked) return true;
		if (!state.processed_thread_keys.includes(key)) return false;
		// Even processed keys age out — but we don't have per-key timestamps,
		// so we conservatively skip if the key is in the processed set.
		return true;
	}
	return false;
}

async function applyHighAction(
	client: LinearClient,
	action: CuratorHighAction,
): Promise<{ ok: true } | { ok: false; error: string }> {
	// Look up the state ID for the team prefix the issue belongs to.
	const match = action.issue_id.match(/^([A-Z]+)-\d+$/);
	if (!match) {
		return { ok: false, error: `Cannot parse team prefix from issue_id ${action.issue_id}` };
	}
	const teamKey = match[1];
	const stateId = await withRateLimit(() => resolveStateId(teamKey, action.to_state));
	if (!stateId) {
		return { ok: false, error: `State "${action.to_state}" not found on team ${teamKey}` };
	}
	// Resolve the issue UUID via the public CLI's findIssueByIdentifier — but we
	// only need the UUID for the SDK update call. Cheapest path: client.issue.
	const issue = await withRateLimit(() => client.issue(action.issue_id));
	const update = await withRateLimit(() => client.updateIssue(issue.id, { stateId }));
	if (!update.success) {
		return { ok: false, error: "Linear API rejected the state update" };
	}
	// Comment with rationale.
	const body = `${action.rationale}\n\n_Auto-applied by elnora-linear curator (rule ${action.rule})._`;
	await withRateLimit(() => client.createComment({ issueId: issue.id, body }));
	return { ok: true };
}

export async function dispatchActions(
	client: LinearClient,
	actions: CuratorAction[],
	state: CuratorState,
	opts: DispatchOptions = {},
): Promise<DispatchResult> {
	const now = opts.now ?? new Date();
	const maxMutations = opts.maxMutations ?? MAX_MUTATIONS;
	const maxMedium = opts.maxMedium ?? MAX_MEDIUM_QUEUED;
	const result: DispatchResult = { applied: [], queued: [], reported: [], skipped: [] };

	let highCount = 0;
	let mediumCount = 0;
	for (const action of actions) {
		if (isDebounced(state, action, now)) {
			result.skipped.push({ issue_id: action.issue_id, rule: action.rule, reason: "debounced" });
			continue;
		}

		if (action.tier === "LOW") {
			result.reported.push({ issue_id: action.issue_id, rule: action.rule, rationale: action.rationale });
			appendReportLine({ tier: "LOW", action }, { stateDir: opts.stateDir });
			continue;
		}

		if (action.tier === "HIGH") {
			if (highCount >= maxMutations) {
				result.skipped.push({ issue_id: action.issue_id, rule: action.rule, reason: "cap_high" });
				continue;
			}
			if (opts.dryRun) {
				highCount++;
				result.applied.push({
					issue_id: action.issue_id,
					rule: action.rule,
					from: action.from_state,
					to: action.to_state,
				});
				appendReportLine({ tier: "HIGH", action, dryRun: true }, { stateDir: opts.stateDir });
				continue;
			}
			try {
				const apply = opts.applyHigh ?? applyHighAction;
				const res = await apply(client, action);
				if (res.ok) {
					highCount++;
					result.applied.push({
						issue_id: action.issue_id,
						rule: action.rule,
						from: action.from_state,
						to: action.to_state,
					});
					const key = debounceKey(action.issue_id, { from: action.from_state, to: action.to_state });
					state.processed_thread_keys.push(key);
					appendReportLine({ tier: "HIGH", action, applied: true }, { stateDir: opts.stateDir });
				} else {
					result.skipped.push({ issue_id: action.issue_id, rule: action.rule, reason: res.error });
					appendReportLine({ tier: "HIGH", action, error: res.error }, { stateDir: opts.stateDir });
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				result.skipped.push({ issue_id: action.issue_id, rule: action.rule, reason: msg });
				appendReportLine({ tier: "HIGH", action, error: msg }, { stateDir: opts.stateDir });
			}
			continue;
		}

		// MEDIUM
		if (mediumCount >= maxMedium) {
			result.skipped.push({ issue_id: action.issue_id, rule: action.rule, reason: "cap_medium" });
			continue;
		}
		mediumCount++;
		const m = action as CuratorMediumAction;
		const proposed = m.proposed_action;
		const key = debounceKey(m.issue_id, { type: proposed.type, from: proposed.from, to: proposed.to });
		state.pending_questions.push({
			issue_id: m.issue_id,
			thread_key: key,
			posted_at: now.toISOString(),
			question_text: m.question_text,
		});
		result.queued.push({ issue_id: m.issue_id, rule: m.rule, thread_key: key });
		appendReportLine({ tier: "MEDIUM", action, queued: true }, { stateDir: opts.stateDir });
	}

	return result;
}

export const _internal = { isDebounced };
