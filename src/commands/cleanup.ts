// `elnora-linear cleanup` — find stale Linear issues and act on them.
//
// Default behaviour is dry-run. `--yes` commits the mutations.
// Default state filter is Todo + Backlog (issues that haven't entered active work).
// Default `--action` is `comment` (least destructive).

import type { Issue, LinearClient, WorkflowState } from "@linear/sdk";
import { getLinearClient } from "../client/index.js";
import type { OutputMode } from "../output/index.js";

export type CleanupAction = "close" | "cancel" | "comment";

export interface CleanupOptions {
	team?: string;
	/** Comma-separated state names; default ["Todo","Backlog"]. */
	states?: string[];
	inactiveDays: number;
	action: CleanupAction;
	message?: string;
	limit: number;
	yes: boolean;
	output: OutputMode;
}

export interface CleanupActionPlan {
	issueIdentifier: string;
	issueTitle: string;
	currentState?: string;
	daysInactive: number;
	proposed: {
		setStateType?: "completed" | "canceled";
		addComment?: string;
	};
}

export interface CleanupPlan {
	actions: CleanupActionPlan[];
	totalConsidered: number;
	dryRun: boolean;
}

/** Pure: given options and the candidate issues, compute the plan. */
export function buildCleanupPlan(
	opts: CleanupOptions,
	issues: Array<{ identifier: string; title: string; state?: string; updatedAt: Date }>,
	now: Date = new Date(),
): CleanupPlan {
	const cutoffMs = now.getTime() - opts.inactiveDays * 24 * 60 * 60 * 1000;
	const stale = issues.filter((i) => i.updatedAt.getTime() < cutoffMs);
	const actions: CleanupActionPlan[] = stale.map((issue) => {
		const daysInactive = Math.floor((now.getTime() - issue.updatedAt.getTime()) / (24 * 60 * 60 * 1000));
		const proposed: CleanupActionPlan["proposed"] = {};
		if (opts.action === "close") proposed.setStateType = "completed";
		if (opts.action === "cancel") proposed.setStateType = "canceled";
		if (opts.message) proposed.addComment = opts.message;
		else if (opts.action === "comment") {
			proposed.addComment = `This issue has been inactive for ${daysInactive} days. Closing or refreshing?`;
		}
		return {
			issueIdentifier: issue.identifier,
			issueTitle: issue.title,
			currentState: issue.state,
			daysInactive,
			proposed,
		};
	});
	return { actions, totalConsidered: issues.length, dryRun: !opts.yes };
}

/** Pure: format a plan for the user. */
export function formatCleanupPlan(plan: CleanupPlan, mode: OutputMode): string {
	if (mode === "json") return JSON.stringify(plan, null, 2);
	const header = plan.dryRun
		? `DRY RUN — ${plan.actions.length} of ${plan.totalConsidered} considered issues are stale (pass --yes to commit)`
		: `Acted on ${plan.actions.length} stale issues (out of ${plan.totalConsidered} considered)`;
	if (plan.actions.length === 0) return `${header}\n  (nothing to do)`;
	const lines = plan.actions.map((a) => {
		const ops: string[] = [];
		if (a.proposed.setStateType) ops.push(`state → ${a.proposed.setStateType}`);
		if (a.proposed.addComment) ops.push("+ comment");
		return `  ${a.issueIdentifier}  ${a.daysInactive}d inactive  ${ops.join(" | ")}  ${a.issueTitle}`;
	});
	return [header, ...lines].join("\n");
}

async function findStateByType(client: LinearClient, teamId: string, type: "completed" | "canceled"): Promise<string> {
	const team = await client.team(teamId);
	const states = await team.states();
	const match = (states.nodes as WorkflowState[]).find((s) => s.type === type);
	if (!match) throw new Error(`Team ${team.key} has no workflow state of type "${type}".`);
	return match.id;
}

export async function runCleanup(opts: CleanupOptions): Promise<void> {
	const client = await getLinearClient({ allowPrompt: true });
	const states = opts.states && opts.states.length > 0 ? opts.states : ["Todo", "Backlog"];
	const filter: Record<string, unknown> = {
		state: { name: { in: states } },
	};
	if (opts.team) filter.team = { key: { eq: opts.team } };
	const issuesResult = await client.issues({ filter, first: opts.limit });
	const fetched = issuesResult.nodes;
	const projected = await Promise.all(
		fetched.map(async (issue) => {
			const state = await issue.state;
			return {
				identifier: issue.identifier,
				title: issue.title,
				state: state?.name,
				updatedAt: issue.updatedAt,
			};
		}),
	);
	const plan = buildCleanupPlan(opts, projected);
	process.stdout.write(`${formatCleanupPlan(plan, opts.output)}\n`);
	if (plan.dryRun) return;

	const indexByIdentifier = new Map<string, Issue>(fetched.map((i) => [i.identifier, i]));
	for (const action of plan.actions) {
		const issue = indexByIdentifier.get(action.issueIdentifier);
		if (!issue) continue;
		if (action.proposed.setStateType) {
			const team = await issue.team;
			if (!team) throw new Error(`Issue ${issue.identifier} has no team`);
			const stateId = await findStateByType(client, team.id, action.proposed.setStateType);
			await issue.update({ stateId });
		}
		if (action.proposed.addComment) {
			await client.createComment({ issueId: issue.id, body: action.proposed.addComment });
		}
	}
}
