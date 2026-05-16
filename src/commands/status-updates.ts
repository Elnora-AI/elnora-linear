// `elnora-linear status-updates` — manage project/initiative status updates.
//
// Initiative status updates are not yet exposed by Linear's SDK; this command
// rejects --type initiative with a pointer to `initiatives update --status`.

import type { LinearClient, ProjectUpdateHealthType } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	CliError,
	parseHealth,
	parseLimit,
	requireNonEmptyUpdate,
	requireYes,
	resolveProject,
} from "../utils/index.js";

type ProjectUpdateCreateInput = Parameters<LinearClient["createProjectUpdate"]>[0];
type ProjectUpdateUpdateInput = Parameters<LinearClient["updateProjectUpdate"]>[1];

export function setupStatusUpdatesCommand(program: Command): void {
	const statusUpdates = program.command("status-updates").description("Manage project/initiative status updates");

	statusUpdates
		.command("list")
		.description("List status updates")
		.requiredOption("--type <type>", "Type: project or initiative")
		.option("--project <project>", "Filter by project")
		.option("--initiative <initiative>", "Filter by initiative")
		.option("--limit <n>", "Max results", "25")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();

				if (opts.type === "project" && opts.project) {
					const project = await resolveProject(client, opts.project);
					const updates = await client.projectUpdates({
						filter: { project: { id: { eq: project.id } } },
						first: parseLimit(opts.limit, 25),
					});
					const items = updates.nodes.map((u) => ({
						id: u.id,
						body: u.body ?? null,
						health: u.health ?? null,
						createdAt: u.createdAt,
					}));
					outputSuccess({ statusUpdates: items, project: project.name, count: items.length });
					return;
				}

				if (opts.type === "initiative") {
					throw new CliError("Initiative status updates are not yet supported by the Linear SDK.", {
						suggestion:
							"Use 'elnora-linear initiatives update <id> --status <status>' to update initiative status directly.",
					});
				}

				throw new CliError("Specify --project with --type project to list status updates.", {
					suggestion: 'Example: elnora-linear status-updates list --type project --project "My Project"',
				});
			}),
		);

	statusUpdates
		.command("create")
		.description("Create a status update")
		.requiredOption("--type <type>", "Type: project or initiative")
		.option("--project <project>", "Project name or ID")
		.option("--initiative <initiative>", "Initiative name or ID")
		.option("--health <health>", "Health: onTrack, atRisk, offTrack")
		.option("--body <body>", "Update content (markdown)")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();

				if (opts.type === "project" && opts.project) {
					const project = await resolveProject(client, opts.project);
					const input: ProjectUpdateCreateInput = { projectId: project.id };
					if (opts.body) input.body = opts.body;
					if (opts.health) input.health = parseHealth(opts.health) as ProjectUpdateHealthType;
					const payload = await client.createProjectUpdate(input);
					outputSuccess({ created: payload.success });
					return;
				}

				if (opts.type === "initiative") {
					throw new CliError("Initiative status updates are not yet supported by the Linear SDK.", {
						suggestion:
							"Use 'elnora-linear initiatives update <id> --status <status>' to update initiative status directly.",
					});
				}

				throw new CliError("Specify --project with --type project to create a status update.", {
					suggestion:
						'Example: elnora-linear status-updates create --type project --project "My Project" --body "Update text"',
				});
			}),
		);

	statusUpdates
		.command("update <id>")
		.description("Update a status update")
		.option("--health <health>", "Health: onTrack, atRisk, offTrack")
		.option("--body <body>", "Update content (markdown)")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const update: Partial<ProjectUpdateUpdateInput> = {};
				if (opts.body) update.body = opts.body;
				if (opts.health) update.health = parseHealth(opts.health) as ProjectUpdateHealthType;
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateProjectUpdate(id, update as ProjectUpdateUpdateInput);
				outputSuccess({ updated: payload.success });
			}),
		);

	statusUpdates
		.command("delete <id>")
		.description("Archive a status update (recoverable). Use --permanent --yes for irreversible delete.")
		.option("--permanent", "Permanently delete (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				if (opts.permanent) {
					requireYes(opts, `permanently delete status update ${id}`);
				}
				const client = await getClient();
				if (opts.permanent) {
					const payload = await client.deleteProjectUpdate(id);
					outputSuccess({ deleted: payload.success, permanent: true });
				} else {
					const payload = await client.archiveProjectUpdate(id);
					outputSuccess({ archived: payload.success });
				}
			}),
		);

	statusUpdates
		.command("restore <id>")
		.description("Restore an archived status update")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const payload = await client.unarchiveProjectUpdate(id);
				outputSuccess({ restored: payload.success });
			}),
		);
}
