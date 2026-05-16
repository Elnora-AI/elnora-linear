// `elnora-linear views` — Linear CustomViews (saved filters).
//
// --filter-json accepts a raw IssueFilter object. Whatever Linear's GraphQL
// accepts as IssueFilter is accepted here.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	CliError,
	parseColor,
	parseLimit,
	requireNonEmptyUpdate,
	requireYes,
	resolveTeam,
	resolveUser,
	ValidationError,
} from "../utils/index.js";

type CustomViewCreateInput = Parameters<LinearClient["createCustomView"]>[0];
type CustomViewUpdateInput = Parameters<LinearClient["updateCustomView"]>[1];

function parseFilterJson(raw: string | undefined, flag: string): Record<string, unknown> | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			const got = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
			throw new ValidationError(`${flag} must be a JSON object, got ${got}`);
		}
		return parsed as Record<string, unknown>;
	} catch (e: unknown) {
		if (e instanceof ValidationError) throw e;
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(`${flag} is not valid JSON: ${msg}`);
	}
}

export function setupViewsCommand(program: Command): void {
	const views = program.command("views").description("Manage Linear custom views (saved filters)");

	views
		.command("list")
		.description("List custom views accessible to the current user")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const result = await client.customViews({ first: parseLimit(opts.limit, 50) });
				const items = await Promise.all(
					result.nodes.map(async (v) => {
						const owner = await v.owner;
						const team = v.teamId ? await v.team : null;
						return {
							id: v.id,
							name: v.name,
							description: v.description ?? null,
							shared: v.shared,
							owner: owner ? { id: owner.id, name: owner.name } : null,
							team: team ? { id: team.id, key: team.key } : null,
							updatedAt: v.updatedAt,
						};
					}),
				);
				outputSuccess({ views: items, count: items.length });
			}),
		);

	views
		.command("get <id>")
		.description("Get a custom view including its IssueFilter")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const view = await client.customView(id);
				const owner = await view.owner;
				const team = view.teamId ? await view.team : null;
				outputSuccess({
					id: view.id,
					name: view.name,
					description: view.description ?? null,
					icon: view.icon ?? null,
					color: view.color ?? null,
					shared: view.shared,
					owner: owner ? { id: owner.id, name: owner.name } : null,
					team: team ? { id: team.id, key: team.key } : null,
					filterData: view.filterData ?? null,
					projectFilterData: view.projectFilterData ?? null,
					createdAt: view.createdAt,
					updatedAt: view.updatedAt,
				});
			}),
		);

	views
		.command("create <name>")
		.description("Create a custom view. Pass an IssueFilter via --filter-json.")
		.option("--description <desc>", "Description")
		.option("--filter-json <json>", "Issue filter as JSON (IssueFilter shape)")
		.option("--project-filter-json <json>", "Project filter as JSON (ProjectFilter shape)")
		.option("--team <team>", "Restrict view to a team (name, key, or UUID)")
		.option("--owner <user>", "Owner (name, email, UUID, or 'me'); defaults to current user")
		.option("--shared", "Share with the whole workspace")
		.option("--icon <icon>", "Icon name")
		.option("--color <hex>", "Icon color (hex)")
		.action(
			handleAsyncCommand(async (name: string, opts: Record<string, string | boolean>) => {
				const client = await getClient();
				const input: CustomViewCreateInput = { name };
				if (opts.description) input.description = opts.description as string;
				if (opts.filterJson) input.filterData = parseFilterJson(opts.filterJson as string, "--filter-json");
				if (opts.projectFilterJson) {
					input.projectFilterData = parseFilterJson(opts.projectFilterJson as string, "--project-filter-json");
				}
				if (opts.team) {
					const team = await resolveTeam(client, opts.team as string);
					input.teamId = team.id;
				}
				if (opts.owner) {
					const owner = await resolveUser(client, opts.owner as string);
					input.ownerId = owner.id;
				}
				if (opts.shared) input.shared = true;
				if (opts.icon) input.icon = opts.icon as string;
				if (opts.color) input.color = parseColor(opts.color as string);

				const payload = await client.createCustomView(input);
				if (!payload.success) throw new CliError("Failed to create custom view");
				const view = await payload.customView;
				outputSuccess({
					created: true,
					view: view ? { id: view.id, name: view.name, shared: view.shared } : null,
				});
			}),
		);

	views
		.command("update <id>")
		.description("Update a custom view")
		.option("--name <name>", "New name")
		.option("--description <desc>", "New description")
		.option("--filter-json <json>", "Replace IssueFilter (JSON)")
		.option("--project-filter-json <json>", "Replace ProjectFilter (JSON)")
		.option("--shared <bool>", "Share state: true|false")
		.option("--icon <icon>", "Icon name")
		.option("--color <hex>", "Icon color (hex)")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const update: CustomViewUpdateInput = {};
				if (opts.name) update.name = opts.name;
				if (opts.description !== undefined) update.description = opts.description;
				if (opts.filterJson) update.filterData = parseFilterJson(opts.filterJson, "--filter-json");
				if (opts.projectFilterJson) {
					update.projectFilterData = parseFilterJson(opts.projectFilterJson, "--project-filter-json");
				}
				if (opts.shared !== undefined) {
					if (opts.shared !== "true" && opts.shared !== "false") {
						throw new ValidationError("--shared must be 'true' or 'false'");
					}
					update.shared = opts.shared === "true";
				}
				if (opts.icon) update.icon = opts.icon;
				if (opts.color) update.color = parseColor(opts.color);
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateCustomView(id, update);
				outputSuccess({ updated: payload.success });
			}),
		);

	views
		.command("delete <id>")
		.description("Permanently delete a custom view (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `permanently delete custom view ${id}`);
				const client = await getClient();
				try {
					const subs = await client.customViewHasSubscribers(id);
					if (subs.hasSubscribers) {
						outputSuccess({
							deleted: (await client.deleteCustomView(id)).success,
							warning: "View had active subscribers other than you.",
						});
						return;
					}
				} catch {
					// hasSubscribers is best-effort; fall through to delete.
				}
				const payload = await client.deleteCustomView(id);
				outputSuccess({ deleted: payload.success });
			}),
		);
}
