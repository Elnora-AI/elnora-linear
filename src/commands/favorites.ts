// `elnora-linear favorites` — pin entities to the current user's sidebar.
//
// Favorites are personal: each call acts on the authenticated user's sidebar,
// not the workspace. Linear's `createFavorite` is upsert — adding the same
// target twice returns the existing favorite.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, findIssueByIdentifier, parseLimit, resolveProject, ValidationError } from "../utils/index.js";

type FavoriteCreateInput = Parameters<LinearClient["createFavorite"]>[0];

export function setupFavoritesCommand(program: Command): void {
	const favorites = program
		.command("favorites")
		.description("Pin issues, projects, views, etc. to the current user's Linear sidebar");

	favorites
		.command("list")
		.description("List the current user's favorites")
		.option("--limit <n>", "Max results", "100")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const result = await client.favorites({ first: parseLimit(opts.limit, 100) });
				const items = result.nodes.map((f) => ({
					id: f.id,
					type: f.type,
					url: f.url ?? null,
					folderName: f.folderName ?? null,
					sortOrder: f.sortOrder,
					targetId:
						f.issueId ??
						f.projectId ??
						f.customViewId ??
						f.cycleId ??
						f.documentId ??
						f.initiativeId ??
						f.labelId ??
						f.projectLabelId ??
						f.teamId ??
						f.userId ??
						null,
				}));
				outputSuccess({ favorites: items, count: items.length });
			}),
		);

	favorites
		.command("add")
		.description(
			"Pin a target to the sidebar. Pass exactly one of --issue/--project/--view/--cycle/--document/--folder.",
		)
		.option("--issue <id>", "Issue identifier (e.g. ELN-123) or UUID")
		.option("--project <nameOrId>", "Project name or UUID")
		.option("--view <id>", "Custom view UUID")
		.option("--cycle <id>", "Cycle UUID")
		.option("--document <id>", "Document UUID")
		.option("--folder <name>", "Create a new favorites folder with this name")
		.option("--parent <id>", "Parent folder favorite UUID")
		.option("--sort-order <n>", "Position in sidebar (lower = earlier)")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const targets = [opts.issue, opts.project, opts.view, opts.cycle, opts.document, opts.folder].filter(Boolean);
				if (targets.length !== 1) {
					throw new ValidationError("Pass exactly one of --issue, --project, --view, --cycle, --document, --folder.");
				}
				const client = await getClient();
				const input: FavoriteCreateInput = {};
				if (opts.issue) {
					const issue = await findIssueByIdentifier(client, opts.issue);
					input.issueId = issue.id;
				}
				if (opts.project) {
					const project = await resolveProject(client, opts.project);
					input.projectId = project.id;
				}
				if (opts.view) input.customViewId = opts.view;
				if (opts.cycle) input.cycleId = opts.cycle;
				if (opts.document) input.documentId = opts.document;
				if (opts.folder) input.folderName = opts.folder;
				if (opts.parent) input.parentId = opts.parent;
				if (opts.sortOrder !== undefined) {
					const n = Number(opts.sortOrder);
					if (!Number.isFinite(n)) {
						throw new ValidationError("--sort-order must be numeric");
					}
					input.sortOrder = n;
				}
				const payload = await client.createFavorite(input);
				if (!payload.success) throw new CliError("Failed to create favorite");
				const favorite = await payload.favorite;
				outputSuccess({
					added: true,
					favorite: favorite ? { id: favorite.id, type: favorite.type, url: favorite.url ?? null } : null,
				});
			}),
		);

	favorites
		.command("remove <id>")
		.description("Remove a favorite by its UUID (idempotent — succeeds even if not present)")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const payload = await client.deleteFavorite(id);
				outputSuccess({ removed: payload.success });
			}),
		);
}
