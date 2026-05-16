// `elnora-linear milestones` — manage project milestones.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	NotFoundError,
	parseDate,
	parseLimit,
	requireNonEmptyUpdate,
	requireYes,
	resolveProject,
} from "../utils/index.js";

type ProjectMilestoneCreateInput = Parameters<LinearClient["createProjectMilestone"]>[0];
type ProjectMilestoneUpdateInput = Parameters<LinearClient["updateProjectMilestone"]>[1];

export function setupMilestonesCommand(program: Command): void {
	const milestones = program.command("milestones").description("Manage project milestones");

	milestones
		.command("list")
		.description("List milestones for a project")
		.requiredOption("--project <project>", "Project name or ID")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const project = await resolveProject(client, opts.project);
				const result = await client.projectMilestones({
					filter: { project: { id: { eq: project.id } } },
					first: parseLimit(opts.limit, 50),
				});
				const items = result.nodes.map((m) => ({
					id: m.id,
					name: m.name,
					description: m.description ?? null,
					targetDate: m.targetDate ?? null,
				}));
				outputSuccess({ milestones: items, project: project.name, count: items.length });
			}),
		);

	milestones
		.command("get <nameOrId>")
		.description("Get milestone details")
		.requiredOption("--project <project>", "Project name or ID")
		.action(
			handleAsyncCommand(async (nameOrId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const project = await resolveProject(client, opts.project);
				const result = await client.projectMilestones({
					filter: { project: { id: { eq: project.id } } },
				});
				const match = result.nodes.find((m) => m.id === nameOrId || m.name.toLowerCase() === nameOrId.toLowerCase());
				if (!match) throw new NotFoundError("Milestone", nameOrId);
				outputSuccess({
					id: match.id,
					name: match.name,
					description: match.description ?? null,
					targetDate: match.targetDate ?? null,
				});
			}),
		);

	milestones
		.command("create <name>")
		.description("Create a milestone")
		.requiredOption("--project <project>", "Project name or ID")
		.option("--description <desc>", "Description")
		.option("--target-date <date>", "Target date (YYYY-MM-DD)")
		.action(
			handleAsyncCommand(async (name: string, opts: Record<string, string>) => {
				const client = await getClient();
				const project = await resolveProject(client, opts.project);
				const input: ProjectMilestoneCreateInput = { projectId: project.id, name };
				if (opts.description) input.description = opts.description;
				if (opts.targetDate) input.targetDate = parseDate(opts.targetDate);
				const payload = await client.createProjectMilestone(input);
				outputSuccess({ created: payload.success });
			}),
		);

	milestones
		.command("update <id>")
		.description("Update a milestone")
		.option("--name <name>", "New name")
		.option("--description <desc>", "New description")
		.option("--target-date <date>", "New target date (YYYY-MM-DD)")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const update: Partial<ProjectMilestoneUpdateInput> = {};
				if (opts.name) update.name = opts.name;
				if (opts.description) update.description = opts.description;
				if (opts.targetDate) update.targetDate = parseDate(opts.targetDate);
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateProjectMilestone(id, update as ProjectMilestoneUpdateInput);
				outputSuccess({ updated: payload.success });
			}),
		);

	milestones
		.command("delete <id>")
		.description("Permanently delete a milestone (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `permanently delete milestone ${id}`);
				const client = await getClient();
				const payload = await client.deleteProjectMilestone(id);
				outputSuccess({ deleted: payload.success });
			}),
		);
}
