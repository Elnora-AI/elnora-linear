// `elnora-linear labels` — manage issue labels (team-scoped and workspace-wide).

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, parseColor, parseLimit, requireNonEmptyUpdate, requireYes, resolveTeam } from "../utils/index.js";

type IssueLabelCreateInput = Parameters<LinearClient["createIssueLabel"]>[0];
type IssueLabelUpdateInput = Parameters<LinearClient["updateIssueLabel"]>[1];

export function setupLabelsCommand(program: Command): void {
	const labels = program.command("labels").description("Manage issue labels");

	labels
		.command("list")
		.description("List labels")
		.option("--team <team>", "Filter by team")
		.option("--limit <n>", "Max results", "250")
		.option("--include-workspace", "When --team is set, also include workspace-scoped labels usable on that team")
		.action(
			handleAsyncCommand(async (opts: Record<string, string | boolean>) => {
				const client = await getClient();
				const limit = parseLimit(typeof opts.limit === "string" ? opts.limit : "250", 250);

				const teamName = typeof opts.team === "string" ? opts.team : undefined;
				const includeWorkspace = Boolean(opts.includeWorkspace);

				let nodes: { id: string; name: string; color: string; description?: string | null }[];

				if (teamName) {
					const team = await resolveTeam(client, teamName);
					const teamScoped = await client.issueLabels({
						first: limit,
						filter: { team: { id: { eq: team.id } } },
					});
					nodes = teamScoped.nodes;

					if (includeWorkspace) {
						const workspaceScoped = await client.issueLabels({
							first: limit,
							filter: { team: { null: true } },
						});
						const seen = new Set(nodes.map((l) => l.id));
						for (const l of workspaceScoped.nodes) {
							if (!seen.has(l.id)) {
								nodes.push(l);
								seen.add(l.id);
							}
						}
					}
				} else {
					const result = await client.issueLabels({ first: limit });
					nodes = result.nodes;
				}

				const rows = nodes.map((l) => ({
					id: l.id,
					name: l.name,
					color: l.color,
					description: l.description ?? null,
				}));
				outputSuccess({ labels: rows, count: rows.length });
			}),
		);

	labels
		.command("create <name>")
		.description("Create a new label")
		.option("--color <hex>", "Label color (hex)")
		.option("--team <team>", "Team-specific label")
		.action(
			handleAsyncCommand(async (name: string, opts: Record<string, string>) => {
				const client = await getClient();
				const input: Partial<IssueLabelCreateInput> & { name: string } = { name };

				if (opts.color) input.color = parseColor(opts.color);
				if (opts.team) {
					const team = await resolveTeam(client, opts.team);
					input.teamId = team.id;
				}

				const payload = await client.createIssueLabel(input as IssueLabelCreateInput);
				if (!payload.success) throw new CliError("Failed to create label");
				const label = await payload.issueLabel;
				outputSuccess({
					created: true,
					label: label ? { id: label.id, name: label.name } : null,
				});
			}),
		);

	labels
		.command("update <id>")
		.description("Update a label")
		.option("--name <name>", "New name")
		.option("--color <hex>", "New color (hex)")
		.option("--description <desc>", "New description")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const update: Partial<IssueLabelUpdateInput> = {};
				if (opts.name) update.name = opts.name;
				if (opts.color) update.color = parseColor(opts.color);
				if (opts.description) update.description = opts.description;
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateIssueLabel(id, update as IssueLabelUpdateInput);
				if (!payload.success) throw new CliError("Failed to update label");
				const label = await payload.issueLabel;
				outputSuccess({
					updated: true,
					label: label ? { id: label.id, name: label.name, color: label.color } : null,
				});
			}),
		);

	labels
		.command("delete <id>")
		.description("Permanently delete a label (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `permanently delete label ${id}`);
				const client = await getClient();
				const payload = await client.deleteIssueLabel(id);
				outputSuccess({ deleted: payload.success });
			}),
		);
}
