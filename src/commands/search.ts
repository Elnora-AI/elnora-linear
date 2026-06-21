// `elnora-linear search` — query Linear issues with optional filters.

import type { Issue, LinearClient } from "@linear/sdk";
import { getLinearClient } from "../client/index.js";
import { type FormattedIssue, formatIssues, type OutputMode } from "../output/index.js";

export interface SearchOptions {
	query?: string;
	team?: string;
	assignee?: string;
	state?: string;
	priority?: number;
	limit: number;
	output: OutputMode;
}

// Linear's IssueFilter is shape-loose enough that an opaque record suits us better than the SDK's
// generated types (which differ across SDK versions). The runtime layer passes this straight through.
export type IssueFilter = Record<string, unknown>;

// Linear's fixed priority scale. The labels mirror Linear's UI so callers can pass either.
const PRIORITY_LABELS: Record<string, number> = {
	"no priority": 0,
	none: 0,
	urgent: 1,
	high: 2,
	medium: 3,
	low: 4,
};

/**
 * Resolve a `--priority` value to Linear's 0–4 scale. Accepts a label
 * (urgent|high|medium|low|none) or the raw number. Throws on anything else.
 */
export function parsePriority(raw: string): number {
	const label = PRIORITY_LABELS[raw.trim().toLowerCase()];
	if (label !== undefined) {
		return label;
	}
	const n = Number.parseInt(raw, 10);
	if (Number.isInteger(n) && n >= 0 && n <= 4 && String(n) === raw.trim()) {
		return n;
	}
	throw new Error(`--priority must be urgent|high|medium|low|none or 0-4 (got "${raw}")`);
}

/**
 * Translate SearchOptions into a Linear IssueFilter.
 *
 * Pure function except for the special "me" assignee path, which needs to look up
 * the current viewer's user id. Pass `client` only when assignee="me".
 */
export async function buildFilter(opts: SearchOptions, client?: LinearClient): Promise<IssueFilter> {
	const filter: IssueFilter = {};
	if (opts.query) {
		filter.searchableContent = { contains: opts.query };
	}
	if (opts.team) {
		filter.team = { key: { eq: opts.team } };
	}
	if (opts.state) {
		filter.state = { name: { eqIgnoreCase: opts.state } };
	}
	if (opts.priority !== undefined) {
		filter.priority = { eq: opts.priority };
	}
	if (opts.assignee === "me") {
		if (!client) {
			throw new Error("buildFilter requires a LinearClient when assignee='me' to resolve the viewer's id.");
		}
		const me = await client.viewer;
		filter.assignee = { id: { eq: me.id } };
	} else if (opts.assignee) {
		filter.assignee = { name: { eqIgnoreCase: opts.assignee } };
	}
	return filter;
}

async function projectIssue(issue: Issue): Promise<FormattedIssue> {
	const [state, assignee, team, project] = await Promise.all([issue.state, issue.assignee, issue.team, issue.project]);
	return {
		identifier: issue.identifier,
		title: issue.title,
		state: state?.name,
		assignee: assignee?.name,
		team: team?.key,
		project: project?.name,
		priority: issue.priority,
		url: issue.url,
		updatedAt: issue.updatedAt.toISOString(),
	};
}

export async function runSearch(opts: SearchOptions): Promise<void> {
	const client = await getLinearClient({ allowPrompt: true });
	const filter = await buildFilter(opts, client);
	const result = await client.issues({ filter, first: opts.limit });
	const projected = await Promise.all(result.nodes.map(projectIssue));
	process.stdout.write(`${formatIssues(projected, opts.output)}\n`);
}
