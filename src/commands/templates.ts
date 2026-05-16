// `elnora-linear templates` — Linear native template lookups + sync.
//
//  - `templates list`: read-only listing of native templates (filterable by
//                      type and team)
//  - `templates sync`: pushes .md compliance templates from a local templates
//                      directory into Linear as native issue templates.
//                      Idempotent: matches by source-footer in description,
//                      falls back to exact name match.

import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { gqlRequest } from "../lib/bulk-graphql.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { syncTemplates } from "../scripts/sync-linear-templates.js";
import { ValidationError } from "../utils/index.js";

const VALID_TYPES = ["issue", "project", "document"] as const;

export function setupTemplatesCommand(program: Command): void {
	const templates = program
		.command("templates")
		.description("List Linear native templates and sync local .md templates into Linear");

	templates
		.command("list")
		.description("List native Linear templates")
		.option("--type <type>", "Filter by type: issue, project, document")
		.option("--team <name>", "Filter by team name (client-side)")
		.option("--limit <n>", "Max results (client-side cap; templates endpoint returns all)", "100")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				if (opts.type && !(VALID_TYPES as readonly string[]).includes(opts.type)) {
					throw new ValidationError(`Invalid --type "${opts.type}". Must be one of: ${VALID_TYPES.join(", ")}.`);
				}
				type TemplateNode = {
					id: string;
					name: string;
					type: string;
					description: string | null;
					createdAt: string;
					team: { name: string } | null;
				};
				const res = await gqlRequest<{ templates: TemplateNode[] }>(
					`query {
            templates { id name type description createdAt team { name } }
          }`,
				);
				if (res.errors) {
					throw new ValidationError(`templates list: ${res.errors.map((e) => e.message).join("; ")}`);
				}
				const all = res.data?.templates ?? [];
				const filtered = all
					.filter((t) => !opts.type || t.type === opts.type)
					.map((t) => ({
						id: t.id,
						name: t.name,
						type: t.type,
						team: t.team?.name ?? null,
						description: t.description,
						createdAt: t.createdAt,
					}));
				const teamFiltered = opts.team
					? filtered.filter((t) => t.team?.toLowerCase() === opts.team.toLowerCase())
					: filtered;
				const limit = parseInt(opts.limit ?? "100", 10);
				const capped = teamFiltered.slice(0, limit);
				outputSuccess({ templates: capped, count: capped.length });
			}),
		);

	templates
		.command("sync")
		.description("Sync local .md templates into Linear as native templates. Idempotent.")
		.requiredOption("--team <name>", "Target team name or key (templates are team-scoped in Linear)")
		.option("--dry-run", "Preview the plan without writing")
		.option("--templates-dir <path>", "Override path to .md templates directory (default: bundled templates/)")
		.option("--yes", "Confirm live sync (required when not --dry-run)")
		.action(
			handleAsyncCommand(async (opts: Record<string, string | boolean>) => {
				const dryRun = Boolean(opts.dryRun);
				const yes = Boolean(opts.yes);
				if (!dryRun && !yes) {
					throw new ValidationError("Refusing live sync without --yes. Use --dry-run to preview, or pass --yes.");
				}
				const client = await getClient();
				const result = await syncTemplates(client, {
					templatesDir: typeof opts.templatesDir === "string" ? opts.templatesDir : "",
					team: String(opts.team),
					dryRun,
					yes,
				});
				outputSuccess(result);
			}),
		);
}
