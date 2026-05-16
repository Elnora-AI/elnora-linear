// `elnora-linear my-issues` — list issues assigned to the current viewer.

import type { Issue } from "@linear/sdk";
import { getLinearClient } from "../client/index.js";
import { type FormattedIssue, formatIssues, type OutputMode } from "../output/index.js";

export interface MyIssuesOptions {
	limit: number;
	output: OutputMode;
}

async function projectIssue(issue: Issue): Promise<FormattedIssue> {
	const [state, team, project] = await Promise.all([issue.state, issue.team, issue.project]);
	return {
		identifier: issue.identifier,
		title: issue.title,
		state: state?.name,
		team: team?.key,
		project: project?.name,
		priority: issue.priority,
		url: issue.url,
		updatedAt: issue.updatedAt.toISOString(),
	};
}

export async function runMyIssues(opts: MyIssuesOptions): Promise<void> {
	const client = await getLinearClient({ allowPrompt: true });
	const me = await client.viewer;
	const result = await me.assignedIssues({ first: opts.limit });
	const projected = await Promise.all(result.nodes.map(projectIssue));
	process.stdout.write(`${formatIssues(projected, opts.output)}\n`);
}
