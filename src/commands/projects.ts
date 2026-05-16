// `elnora-linear projects` — manage Linear projects.
//
// `list` uses raw GraphQL with lead{name} embedded to avoid N+1 round-trips.
// `get` parallelizes lead + status + teams + workflow states so an agent can
// plan an issue create against the project without follow-up calls. Includes
// label policy + recommended issue state for the project's current status.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { gqlRequest } from "../lib/bulk-graphql.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	CliError,
	getTeamLabelPolicy,
	parseColor,
	parseDate,
	parseLimit,
	parsePriority,
	parseProjectState,
	recommendedStateForStatus,
	requireNonEmptyUpdate,
	requireYes,
	resolveProject,
	resolveProjectStatus,
	resolveTeam,
	resolveUser,
} from "../utils/index.js";

type ProjectCreateInput = Parameters<LinearClient["createProject"]>[0];
type ProjectUpdateInput = Parameters<LinearClient["updateProject"]>[1];

export function setupProjectsCommand(program: Command): void {
	const projects = program.command("projects").description("Manage Linear projects");

	projects
		.command("list")
		.description("List projects")
		.option("--team <team>", "Filter by team")
		.option("--state <state>", "Filter by project state (planned, started, paused, completed, canceled)")
		.option("--limit <n>", "Max results", "250")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const filter: Record<string, unknown> = {};

				if (opts.state) {
					parseProjectState(opts.state);
					filter.status = { type: { eq: opts.state } };
				}

				if (opts.team) {
					const team = await resolveTeam(client, opts.team);
					filter.accessibleTeams = { id: { eq: team.id } };
				}

				type ProjectNode = {
					id: string;
					name: string;
					state: string;
					priority: number | null;
					lead: { name: string } | null;
					startDate: string | null;
					targetDate: string | null;
					url: string;
				};
				const res = await gqlRequest<{ projects: { nodes: ProjectNode[] } }>(
					`query($filter: ProjectFilter, $first: Int!) {
            projects(first: $first, filter: $filter) {
              nodes {
                id name state priority
                lead { name }
                startDate targetDate url
              }
            }
          }`,
					{ filter, first: parseLimit(opts.limit, 250) },
				);
				if (res.errors) {
					throw new CliError(`projects list: ${res.errors.map((e) => e.message).join("; ")}`);
				}
				const rows = (res.data?.projects.nodes ?? []).map((p) => ({
					id: p.id,
					name: p.name,
					state: p.state,
					priority: p.priority,
					lead: p.lead?.name ?? null,
					startDate: p.startDate,
					targetDate: p.targetDate,
					url: p.url,
				}));
				outputSuccess({ projects: rows, count: rows.length });
			}),
		);

	projects
		.command("get <nameOrId>")
		.description(
			"Get project details. Includes label policy, validStates, and currentStatus for the project's primary team.",
		)
		.action(
			handleAsyncCommand(async (nameOrId: string) => {
				const client = await getClient();
				const project = await resolveProject(client, nameOrId);
				const full = await client.project(project.id);

				const [lead, status, teamsConn] = await Promise.all([full.lead, full.status, full.teams()]);

				const primaryTeam = teamsConn?.nodes?.[0] ?? null;

				const statesConn = primaryTeam
					? await client.workflowStates({ first: 100, filter: { team: { id: { eq: primaryTeam.id } } } })
					: null;

				const validStates = statesConn?.nodes?.map((s) => ({ name: s.name, type: s.type })) ?? [];

				const labelPolicy = primaryTeam ? getTeamLabelPolicy(primaryTeam.key) : null;
				const requiredLabels = labelPolicy?.required ?? [];
				const allowedPrefixes = labelPolicy?.allowedPrefixes ?? [];

				const recommended = recommendedStateForStatus(status?.type);

				outputSuccess({
					id: full.id,
					name: full.name,
					description: full.description ?? null,
					state: full.state,
					priority: full.priority,
					lead: lead?.name ?? null,
					startDate: full.startDate ?? null,
					targetDate: full.targetDate ?? null,
					url: full.url,
					primaryTeam: primaryTeam ? { key: primaryTeam.key, name: primaryTeam.name } : null,
					currentStatus: status
						? {
								name: status.name,
								type: status.type,
								recommendedIssueState: recommended.state,
								...(recommended.warning ? { warning: recommended.warning } : {}),
							}
						: null,
					validStates,
					requiredLabels,
					allowedLabelPrefixes: allowedPrefixes,
				});
			}),
		);

	projects
		.command("create <name>")
		.description("Create a new project")
		.requiredOption("--team <team>", "Team name or key")
		.option("--description <desc>", "Project description (markdown)")
		.option("--priority <priority>", "Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low")
		.option("--lead <lead>", "Lead (name, email, or 'me')")
		.option("--start-date <date>", "Start date (YYYY-MM-DD)")
		.option("--target-date <date>", "Target date (YYYY-MM-DD)")
		.option("--color <hex>", "Project color (hex)")
		.option("--icon <emoji>", "Project icon (emoji)")
		.action(
			handleAsyncCommand(async (name: string, opts: Record<string, string>) => {
				const client = await getClient();
				const [teamResult, leadResult] = await Promise.all([
					resolveTeam(client, opts.team),
					opts.lead ? resolveUser(client, opts.lead) : undefined,
				]);

				const input: ProjectCreateInput = { name, teamIds: [teamResult.id] };
				if (opts.description) input.description = opts.description;
				if (opts.priority) {
					const priority = parsePriority(opts.priority);
					if (priority !== undefined) input.priority = priority;
				}
				if (leadResult) input.leadId = leadResult.id;
				if (opts.startDate) input.startDate = parseDate(opts.startDate);
				if (opts.targetDate) input.targetDate = parseDate(opts.targetDate);
				if (opts.color) input.color = parseColor(opts.color);
				if (opts.icon) input.icon = opts.icon;

				const payload = await client.createProject(input);
				if (!payload.success) throw new CliError("Failed to create project");
				const created = await payload.project;
				outputSuccess({
					created: true,
					project: created ? { id: created.id, name: created.name, url: created.url } : null,
				});
			}),
		);

	projects
		.command("update <nameOrId>")
		.description("Update an existing project")
		.option("--name <name>", "New name")
		.option("--description <desc>", "New description (markdown)")
		.option("--priority <priority>", "New priority: 0-4")
		.option("--lead <lead>", "New lead (name, email, 'me', or 'none')")
		.option("--start-date <date>", "Start date (YYYY-MM-DD)")
		.option("--target-date <date>", "Target date (YYYY-MM-DD)")
		.option("--color <hex>", "Project color (hex)")
		.option("--icon <emoji>", "Project icon (emoji)")
		.option("--state <state>", "Project state (planned, started, paused, completed, canceled, backlog)")
		.action(
			handleAsyncCommand(async (nameOrId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const project = await resolveProject(client, nameOrId);
				const update: Partial<ProjectUpdateInput> = {};
				if (opts.name) update.name = opts.name;
				if (opts.description) update.description = opts.description;
				if (opts.priority) {
					const priority = parsePriority(opts.priority);
					if (priority !== undefined) update.priority = priority;
				}
				if (opts.lead) {
					if (opts.lead.toLowerCase() === "none") {
						update.leadId = null;
					} else {
						const user = await resolveUser(client, opts.lead);
						update.leadId = user.id;
					}
				}
				if (opts.startDate) update.startDate = parseDate(opts.startDate);
				if (opts.targetDate) update.targetDate = parseDate(opts.targetDate);
				if (opts.color) update.color = parseColor(opts.color);
				if (opts.icon) update.icon = opts.icon;
				if (opts.state) {
					const status = await resolveProjectStatus(client, opts.state);
					(update as Record<string, unknown>).statusId = status.id;
				}
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateProject(project.id, update as ProjectUpdateInput);
				if (!payload.success) throw new CliError("Failed to update project");
				const updated = await payload.project;
				outputSuccess({
					updated: true,
					project: updated ? { id: updated.id, name: updated.name, url: updated.url } : null,
				});
			}),
		);

	projects
		.command("delete <nameOrId>")
		.description("Archive a project (recoverable). Use --permanent --yes for irreversible delete.")
		.option("--permanent", "Permanently delete (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (nameOrId: string, opts: Record<string, string | boolean>) => {
				if (opts.permanent) {
					requireYes(opts, `permanently delete project ${nameOrId}`);
				}
				const client = await getClient();
				const project = await resolveProject(client, nameOrId);
				if (opts.permanent) {
					const payload = await client.deleteProject(project.id);
					outputSuccess({ deleted: payload.success, name: project.name, permanent: true });
				} else {
					const payload = await client.archiveProject(project.id);
					outputSuccess({ archived: payload.success, name: project.name });
				}
			}),
		);

	projects
		.command("restore <nameOrId>")
		.description("Restore an archived project")
		.action(
			handleAsyncCommand(async (nameOrId: string) => {
				const client = await getClient();
				const project = await resolveProject(client, nameOrId);
				const payload = await client.unarchiveProject(project.id);
				outputSuccess({ restored: payload.success, name: project.name });
			}),
		);

	projects
		.command("add-label <project> <label>")
		.description("Attach a project label to a project (label is the ProjectLabel name or UUID)")
		.action(
			handleAsyncCommand(async (projectArg: string, labelArg: string) => {
				const client = await getClient();
				const project = await resolveProject(client, projectArg);
				const labelId = await resolveProjectLabelId(client, labelArg);
				const payload = await client.projectAddLabel(project.id, labelId);
				outputSuccess({ added: payload.success, project: project.name, labelId });
			}),
		);

	projects
		.command("remove-label <project> <label>")
		.description("Detach a project label from a project (label is the ProjectLabel name or UUID)")
		.action(
			handleAsyncCommand(async (projectArg: string, labelArg: string) => {
				const client = await getClient();
				const project = await resolveProject(client, projectArg);
				const labelId = await resolveProjectLabelId(client, labelArg);
				const payload = await client.projectRemoveLabel(project.id, labelId);
				outputSuccess({ removed: payload.success, project: project.name, labelId });
			}),
		);
}

async function resolveProjectLabelId(client: LinearClient, nameOrId: string): Promise<string> {
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId)) {
		return nameOrId;
	}
	const lower = nameOrId.toLowerCase();
	let cursor = await client.projectLabels({ first: 250 });
	while (true) {
		const match = cursor.nodes.find((l) => l.name.toLowerCase() === lower);
		if (match) return match.id;
		if (!cursor.pageInfo.hasNextPage) break;
		cursor = await cursor.fetchNext();
	}
	throw new CliError(`Project label not found: ${nameOrId}`, {
		suggestion: "Run `elnora-linear project-labels list` to see available labels.",
	});
}
