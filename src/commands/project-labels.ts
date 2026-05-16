// `elnora-linear project-labels` — manage project-scoped labels (distinct from
// issue labels, which live on `labels`).

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, parseColor, parseLimit, requireNonEmptyUpdate, requireYes } from "../utils/index.js";

type ProjectLabelCreateInput = Parameters<LinearClient["createProjectLabel"]>[0];
type ProjectLabelUpdateInput = Parameters<LinearClient["updateProjectLabel"]>[1];

export function setupProjectLabelsCommand(program: Command): void {
	const projectLabels = program.command("project-labels").description("Manage project labels");

	projectLabels
		.command("list")
		.description("List project labels")
		.option("--limit <n>", "Max results", "250")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const result = await client.projectLabels({ first: parseLimit(opts.limit, 250) });
				const rows = result.nodes.map((l) => ({
					id: l.id,
					name: l.name,
					color: l.color ?? null,
					description: l.description ?? null,
				}));
				outputSuccess({ projectLabels: rows, count: rows.length });
			}),
		);

	projectLabels
		.command("create <name>")
		.description("Create a project label")
		.option("--color <hex>", "Label color (hex)")
		.option("--description <desc>", "Label description")
		.action(
			handleAsyncCommand(async (name: string, opts: Record<string, string>) => {
				const client = await getClient();
				const input: ProjectLabelCreateInput = { name };
				if (opts.color) input.color = parseColor(opts.color);
				if (opts.description) input.description = opts.description;
				const payload = await client.createProjectLabel(input);
				if (!payload.success) throw new CliError("Failed to create project label");
				const label = await payload.projectLabel;
				outputSuccess({
					created: true,
					label: label ? { id: label.id, name: label.name } : null,
				});
			}),
		);

	projectLabels
		.command("update <id>")
		.description("Update a project label")
		.option("--name <name>", "New name")
		.option("--color <hex>", "New color (hex)")
		.option("--description <desc>", "New description")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const update: Partial<ProjectLabelUpdateInput> = {};
				if (opts.name) update.name = opts.name;
				if (opts.color) update.color = parseColor(opts.color);
				if (opts.description) update.description = opts.description;
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateProjectLabel(id, update as ProjectLabelUpdateInput);
				if (!payload.success) throw new CliError("Failed to update project label");
				const label = await payload.projectLabel;
				outputSuccess({
					updated: true,
					label: label ? { id: label.id, name: label.name } : null,
				});
			}),
		);

	projectLabels
		.command("delete <id>")
		.description("Permanently delete a project label (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `permanently delete project label ${id}`);
				const client = await getClient();
				const payload = await client.deleteProjectLabel(id);
				outputSuccess({ deleted: payload.success });
			}),
		);
}
