// sync-linear-templates — push .md compliance templates into Linear as native
// issue templates so they appear in the Linear UI's template picker for
// everyone, not just CLI users.
//
// Match strategy:
//   1) by source-footer in template.description (`<!-- elnora-linear-template-source: <filename> -->`)
//   2) by exact template.name match (legacy / first-time match)
//
// Naming: `templates/SEC-VLN-vulnerability.md` → name `Template: SEC-VLN-vulnerability`.

import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LinearClient, Template } from "@linear/sdk";

const SOURCE_TAG_RE = /<!--\s*elnora-linear-template-source:\s*(.+?)\s*-->/i;

export interface SyncOptions {
	templatesDir: string;
	team: string;
	dryRun: boolean;
	yes: boolean;
}

export interface PlanEntry {
	filename: string;
	name: string;
	action: "create" | "update" | "skip";
	reason?: string;
	templateId?: string;
}

export interface SyncResult {
	created: number;
	updated: number;
	skipped: number;
	errors: { filename: string; error: string }[];
	plan: PlanEntry[];
}

/**
 * Default `<package-root>/templates/`. Resolves to dist/scripts/ when running
 * the published package and src/scripts/ during local development; both are
 * three levels under the package root.
 */
function defaultTemplatesDir(): string {
	const scriptDir = fileURLToPath(new URL(".", import.meta.url));
	return join(scriptDir, "..", "..", "templates");
}

function readTemplateFiles(dir: string): { filename: string; name: string; body: string }[] {
	const files = readdirSync(dir).filter((f) => extname(f) === ".md");
	return files.map((file) => {
		const body = readFileSync(join(dir, file), "utf-8");
		const stem = basename(file, ".md");
		return { filename: file, name: `Template: ${stem}`, body };
	});
}

function buildDescription(filename: string, body: string): string {
	const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
	const summary = firstLine.replace(/^#+\s*/, "").trim();
	return `${summary}\n\n<!-- elnora-linear-template-source: ${filename} -->`;
}

function findExistingMatch(existing: Template[], filename: string, name: string): Template | undefined {
	for (const t of existing) {
		const desc = t.description ?? "";
		const m = desc.match(SOURCE_TAG_RE);
		if (m && m[1] === filename) return t;
	}
	return existing.find((t) => t.name === name);
}

async function planSync(client: LinearClient, opts: SyncOptions): Promise<{ plan: PlanEntry[]; teamId: string }> {
	const teams = await client.teams({ first: 250 });
	const team = teams.nodes.find(
		(t) => t.name.toLowerCase() === opts.team.toLowerCase() || t.key.toLowerCase() === opts.team.toLowerCase(),
	);
	if (!team) {
		throw new Error(`Team "${opts.team}" not found. Use --team to override.`);
	}

	const all = ((await client.templates) ?? []) as Template[];
	const issueTemplates = all.filter((t) => t.type === "issue");

	const local = readTemplateFiles(opts.templatesDir);
	const plan: PlanEntry[] = local.map((t) => {
		const match = findExistingMatch(issueTemplates, t.filename, t.name);
		if (match) {
			return { filename: t.filename, name: t.name, action: "update", templateId: match.id };
		}
		return { filename: t.filename, name: t.name, action: "create" };
	});

	return { plan, teamId: team.id };
}

async function applyPlan(
	client: LinearClient,
	opts: SyncOptions,
	plan: PlanEntry[],
	teamId: string,
): Promise<SyncResult> {
	const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [], plan };
	const local = readTemplateFiles(opts.templatesDir);
	const byFilename = new Map(local.map((t) => [t.filename, t]));

	for (const entry of plan) {
		const tpl = byFilename.get(entry.filename);
		if (!tpl) {
			result.errors.push({ filename: entry.filename, error: "template file disappeared mid-run" });
			continue;
		}
		const description = buildDescription(tpl.filename, tpl.body);
		try {
			if (entry.action === "create") {
				await client.createTemplate({
					name: tpl.name,
					type: "issue",
					teamId,
					description,
					templateData: { description: tpl.body },
				});
				result.created += 1;
			} else if (entry.action === "update" && entry.templateId) {
				await client.updateTemplate(entry.templateId, {
					name: tpl.name,
					description,
					templateData: { description: tpl.body },
				});
				result.updated += 1;
			} else {
				result.skipped += 1;
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			result.errors.push({ filename: entry.filename, error: msg });
		}
	}
	return result;
}

export async function syncTemplates(client: LinearClient, opts: SyncOptions): Promise<SyncResult> {
	const resolved: SyncOptions = {
		...opts,
		templatesDir: opts.templatesDir || defaultTemplatesDir(),
	};
	const { plan, teamId } = await planSync(client, resolved);
	if (resolved.dryRun) {
		return { created: 0, updated: 0, skipped: 0, errors: [], plan };
	}
	return applyPlan(client, resolved, plan, teamId);
}
