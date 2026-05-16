// `elnora-linear context --team <name>` — one-shot team context primitive.
//
// Cold-start primitive for agent workflows: a single CLI call that returns
// members, projects (with statuses + recommendedIssueState), workflow states,
// the team's label catalog grouped by prefix, the required-label policy, and
// Template:* names. Replaces the 4-call sequence (`teams get` + `projects list
// --team` + `states list --team` + `labels list --team`) with one parallel
// fetch — total wall-clock is bounded by the slowest of 5 fanned-out queries.

import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { getTeamLabelPolicy, groupLabelsByPrefix, recommendedStateForStatus, resolveTeam } from "../utils/index.js";

export function setupContextCommand(program: Command): void {
	program
		.command("context")
		.description(
			"One-call team context: members, projects (with statuses), workflow states, labels grouped by prefix, required-label policy. Use this once at the start of a workflow instead of calling teams/projects/states/labels separately.",
		)
		.requiredOption("--team <team>", "Team name or key")
		.option("--exclude-projects", "Skip the projects fetch (fastest mode for label/state-only lookups)")
		.option("--exclude-members", "Skip the members fetch (saves a round-trip if you don't need assignees)")
		.action(
			handleAsyncCommand(async (opts: Record<string, string | boolean>) => {
				const client = await getClient();
				const team = await resolveTeam(client, opts.team as string);
				const policy = getTeamLabelPolicy(team.key);
				const allowedPrefixes = policy?.allowedPrefixes ?? [];

				const skipProjects = Boolean(opts.excludeProjects);
				const skipMembers = Boolean(opts.excludeMembers);

				const [projectsConn, statesConn, teamLabelsConn, workspaceLabelsConn, membersConn] = await Promise.all([
					skipProjects
						? Promise.resolve(null)
						: client.projects({
								first: 100,
								filter: { accessibleTeams: { id: { eq: team.id } } },
							}),
					client.workflowStates({
						first: 100,
						filter: { team: { id: { eq: team.id } } },
					}),
					client.issueLabels({
						first: 250,
						filter: { team: { id: { eq: team.id } } },
					}),
					client.issueLabels({
						first: 250,
						filter: { team: { null: true } },
					}),
					skipMembers
						? Promise.resolve(null)
						: client.users({
								first: 100,
								filter: { active: { eq: true } },
							}),
				]);

				const projects = projectsConn
					? await Promise.all(
							projectsConn.nodes.map(async (p) => {
								const status = await p.status;
								const recommended = recommendedStateForStatus(status?.type);
								return {
									name: p.name,
									status: status?.name ?? null,
									statusType: status?.type ?? null,
									recommendedIssueState: recommended.state,
									...(recommended.warning ? { warning: recommended.warning } : {}),
									url: p.url,
								};
							}),
						)
					: null;

				const states = (statesConn?.nodes ?? []).map((s) => ({
					name: s.name,
					type: s.type,
				}));

				const allLabels = [
					...(teamLabelsConn?.nodes ?? []).map((l) => l.name),
					...(workspaceLabelsConn?.nodes ?? []).map((l) => l.name),
				];
				const dedupedLabels = Array.from(new Set(allLabels));
				const labelsByPrefix = groupLabelsByPrefix(dedupedLabels, allowedPrefixes);

				const members = membersConn ? membersConn.nodes.map((u) => ({ name: u.name, email: u.email })) : null;

				const templates = (labelsByPrefix["Template:"] ?? []).map((name) => name.replace(/^Template: /, ""));

				const result: Record<string, unknown> = {
					team: { key: team.key, name: team.name },
					states,
					labels: { byPrefix: labelsByPrefix, all: dedupedLabels },
					requiredLabels: policy?.required ?? [],
					allowedLabelPrefixes: allowedPrefixes,
					requiresProject: policy?.requiresProject ?? false,
					templates,
				};

				if (projects !== null) result.projects = projects;
				if (members !== null) result.members = members;

				outputSuccess(result);
			}),
		);
}
