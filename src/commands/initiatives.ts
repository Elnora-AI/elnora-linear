// `elnora-linear initiatives` — manage initiatives.

import type { InitiativeStatus, LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { parseLimit, requireNonEmptyUpdate, requireYes, resolveInitiative, resolveUser } from "../utils/index.js";

type InitiativeCreateInput = Parameters<LinearClient["createInitiative"]>[0];
type InitiativeUpdateInput = Parameters<LinearClient["updateInitiative"]>[1];

export function setupInitiativesCommand(program: Command): void {
	const initiatives = program.command("initiatives").description("Manage initiatives");

	initiatives
		.command("list")
		.description("List initiatives")
		.option("--limit <n>", "Max results", "250")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const result = await client.initiatives({ first: parseLimit(opts.limit, 250) });
				const items = result.nodes.map((i) => ({
					id: i.id,
					name: i.name,
					status: i.status,
					description: i.description ?? null,
				}));
				outputSuccess({ initiatives: items, count: items.length });
			}),
		);

	initiatives
		.command("get <nameOrId>")
		.description("Get initiative details")
		.action(
			handleAsyncCommand(async (nameOrId: string) => {
				const client = await getClient();
				const resolved = await resolveInitiative(client, nameOrId);
				const init = await client.initiative(resolved.id);
				outputSuccess({
					id: init.id,
					name: init.name,
					status: init.status,
					description: init.description ?? null,
				});
			}),
		);

	initiatives
		.command("create <name>")
		.description("Create an initiative")
		.option("--description <desc>", "Description")
		.option("--status <status>", "Status: Planned, Active, Completed")
		.option("--owner <owner>", "Owner (name, email, or 'me')")
		.action(
			handleAsyncCommand(async (name: string, opts: Record<string, string>) => {
				const client = await getClient();
				const input: InitiativeCreateInput = { name };
				if (opts.description) input.description = opts.description;
				if (opts.status) input.status = opts.status as InitiativeStatus;
				if (opts.owner) {
					const user = await resolveUser(client, opts.owner);
					input.ownerId = user.id;
				}
				const payload = await client.createInitiative(input);
				outputSuccess({ created: payload.success });
			}),
		);

	initiatives
		.command("update <nameOrId>")
		.description("Update an initiative")
		.option("--name <name>", "New name")
		.option("--status <status>", "New status")
		.option("--description <desc>", "New description")
		.action(
			handleAsyncCommand(async (nameOrId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const resolved = await resolveInitiative(client, nameOrId);
				const update: Partial<InitiativeUpdateInput> = {};
				if (opts.name) update.name = opts.name;
				if (opts.status) update.status = opts.status as InitiativeStatus;
				if (opts.description) update.description = opts.description;
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateInitiative(resolved.id, update as InitiativeUpdateInput);
				outputSuccess({ updated: payload.success });
			}),
		);

	initiatives
		.command("delete <nameOrId>")
		.description("Archive an initiative (recoverable). Use --permanent --yes for irreversible delete.")
		.option("--permanent", "Permanently delete (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (nameOrId: string, opts: Record<string, string | boolean>) => {
				if (opts.permanent) {
					requireYes(opts, `permanently delete initiative ${nameOrId}`);
				}
				const client = await getClient();
				// Archive should be idempotent — pass includeArchived so we can detect
				// "already archived" and no-op instead of throwing Entity not found.
				const resolved = await resolveInitiative(client, nameOrId, { includeArchived: !opts.permanent });
				if (opts.permanent) {
					const payload = await client.deleteInitiative(resolved.id);
					outputSuccess({ deleted: payload.success, permanent: true });
				} else if (resolved.archivedAt) {
					outputSuccess({ archived: true, alreadyArchived: true });
				} else {
					const payload = await client.archiveInitiative(resolved.id);
					outputSuccess({ archived: payload.success });
				}
			}),
		);

	initiatives
		.command("restore <nameOrId>")
		.description("Restore an archived initiative")
		.action(
			handleAsyncCommand(async (nameOrId: string) => {
				const client = await getClient();
				const resolved = await resolveInitiative(client, nameOrId, { includeArchived: true });
				const payload = await client.unarchiveInitiative(resolved.id);
				outputSuccess({ restored: payload.success });
			}),
		);
}
