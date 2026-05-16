// `elnora-linear bulk` — apply the same change to many Linear issues at once.
//
// Safety design:
//   - Default behaviour is dry-run. The plan is printed; nothing is mutated.
//   - `--yes` is required to commit mutations.
//   - At least one of `--set-state` or `--add-comment` must be specified;
//     otherwise the command errors out early.

import type { Issue, LinearClient, WorkflowState } from "@linear/sdk";
import { getLinearClient } from "../client/index.js";
import type { OutputMode } from "../output/index.js";
import { buildFilter, type IssueFilter, type SearchOptions } from "./search.js";

export interface BulkOptions extends Omit<SearchOptions, "limit" | "output"> {
	// Mutation flags
	setState?: string;
	addComment?: string;
	// Safety + pagination
	limit: number;
	yes: boolean;
	output: OutputMode;
}

export interface BulkActionPlan {
	issueIdentifier: string;
	issueTitle: string;
	currentState?: string;
	changes: {
		stateChange?: { from: string; to: string };
		commentAdded?: string;
	};
	skipped?: { reason: string };
}

export interface BulkPlan {
	actions: BulkActionPlan[];
	totalMatched: number;
	dryRun: boolean;
}

/** Pure: given options + matched issues, compute the plan of changes. */
export function buildBulkPlan(
	opts: BulkOptions,
	issues: Array<{ identifier: string; title: string; state?: string }>,
): BulkPlan {
	if (!opts.setState && !opts.addComment) {
		throw new Error("bulk requires at least one of --set-state or --add-comment.");
	}
	const actions: BulkActionPlan[] = issues.map((issue) => {
		const action: BulkActionPlan = {
			issueIdentifier: issue.identifier,
			issueTitle: issue.title,
			currentState: issue.state,
			changes: {},
		};
		if (opts.setState) {
			if (issue.state && issue.state.toLowerCase() === opts.setState.toLowerCase()) {
				action.skipped = { reason: `already in state "${issue.state}"` };
			} else {
				action.changes.stateChange = { from: issue.state ?? "?", to: opts.setState };
			}
		}
		if (opts.addComment) {
			action.changes.commentAdded = opts.addComment;
		}
		return action;
	});
	return { actions, totalMatched: issues.length, dryRun: !opts.yes };
}

/** Pure: format a plan for the user. */
export function formatBulkPlan(plan: BulkPlan, mode: OutputMode): string {
	if (mode === "json") return JSON.stringify(plan, null, 2);
	const willMutate = plan.actions.filter((a) => !a.skipped).length;
	const header = plan.dryRun
		? `DRY RUN — ${willMutate} of ${plan.totalMatched} matched issues would change (pass --yes to commit)`
		: `Applied changes to ${willMutate} of ${plan.totalMatched} matched issues`;
	if (plan.actions.length === 0) return `${header}\n  (no matching issues)`;
	const lines = plan.actions.map((a) => {
		if (a.skipped) return `  ${a.issueIdentifier}  SKIPPED — ${a.skipped.reason}  ${a.issueTitle}`;
		const parts: string[] = [];
		if (a.changes.stateChange) parts.push(`state: ${a.changes.stateChange.from} → ${a.changes.stateChange.to}`);
		if (a.changes.commentAdded) parts.push("+ comment");
		return `  ${a.issueIdentifier}  ${parts.join(" | ")}  ${a.issueTitle}`;
	});
	return [header, ...lines].join("\n");
}

async function findStateIdByName(client: LinearClient, teamId: string, name: string): Promise<string> {
	const team = await client.team(teamId);
	const states = await team.states();
	const match = (states.nodes as WorkflowState[]).find((s) => s.name.toLowerCase() === name.toLowerCase());
	if (!match) throw new Error(`No workflow state named "${name}" in team ${team.key}.`);
	return match.id;
}

export async function runBulk(opts: BulkOptions): Promise<void> {
	const client = await getLinearClient({ allowPrompt: true });
	const filter: IssueFilter = await buildFilter({ ...opts, limit: opts.limit, output: opts.output }, client);
	const issuesResult = await client.issues({ filter, first: opts.limit });
	const fetched = issuesResult.nodes;
	const projected = await Promise.all(
		fetched.map(async (issue) => {
			const state = await issue.state;
			return { identifier: issue.identifier, title: issue.title, state: state?.name };
		}),
	);
	const plan = buildBulkPlan(opts, projected);
	process.stdout.write(`${formatBulkPlan(plan, opts.output)}\n`);
	if (plan.dryRun) return;

	// Apply mutations.
	const indexByIdentifier = new Map<string, Issue>(fetched.map((i) => [i.identifier, i]));
	for (const action of plan.actions) {
		if (action.skipped) continue;
		const issue = indexByIdentifier.get(action.issueIdentifier);
		if (!issue) continue;
		const updates: Record<string, string> = {};
		if (action.changes.stateChange) {
			const team = await issue.team;
			if (!team) throw new Error(`Issue ${issue.identifier} has no team`);
			updates.stateId = await findStateIdByName(client, team.id, action.changes.stateChange.to);
		}
		if (Object.keys(updates).length > 0) {
			await issue.update(updates);
		}
		if (action.changes.commentAdded) {
			await client.createComment({ issueId: issue.id, body: action.changes.commentAdded });
		}
	}
}
