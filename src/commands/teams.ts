// `elnora-linear teams` — manage Linear teams.
//
// `get` returns valid workflow states + the label policy (required groups,
// allowed prefixes, requiresProject) so agents can plan an issue create
// without follow-up calls.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	CliError,
	getTeamLabelPolicy,
	parseColor,
	parseLimit,
	requireNonEmptyUpdate,
	requireYes,
	resolveTeam,
	teamRequiresProject,
} from "../utils/index.js";

type TeamCreateInput = Parameters<LinearClient["createTeam"]>[0];
type TeamUpdateInput = Parameters<LinearClient["updateTeam"]>[1];

export function setupTeamsCommand(program: Command): void {
	const teams = program.command("teams").description("Manage Linear teams");

	teams
		.command("list")
		.description("List all teams")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const result = await client.teams({ first: parseLimit(opts.limit, 50) });
				const rows = result.nodes.map((t) => ({
					id: t.id,
					name: t.name,
					key: t.key,
					description: t.description ?? null,
				}));
				outputSuccess({ teams: rows, count: rows.length });
			}),
		);

	teams
		.command("get <nameOrId>")
		.description(
			"Get team details. Includes validStates and label policy (required groups + allowed prefixes + requiresProject) so agents can plan an issue create without follow-up calls.",
		)
		.action(
			handleAsyncCommand(async (nameOrId: string) => {
				const client = await getClient();
				const team = await resolveTeam(client, nameOrId);

				const [full, statesConn] = await Promise.all([
					client.team(team.id),
					client.workflowStates({ first: 100, filter: { team: { id: { eq: team.id } } } }),
				]);

				const validStates = statesConn?.nodes?.map((s) => ({ name: s.name, type: s.type })) ?? [];

				const labelPolicy = getTeamLabelPolicy(full.key);
				const requiredLabels = labelPolicy?.required ?? [];
				const allowedPrefixes = labelPolicy?.allowedPrefixes ?? [];

				outputSuccess({
					id: full.id,
					name: full.name,
					key: full.key,
					description: full.description ?? null,
					validStates,
					requiredLabels,
					allowedLabelPrefixes: allowedPrefixes,
					requiresProject: teamRequiresProject(full.key),
				});
			}),
		);

	teams
		.command("create <name>")
		.description("Create a new team")
		.requiredOption("--key <key>", "Team key (e.g., ENG, SEC)")
		.option("--description <desc>", "Team description")
		.option("--color <hex>", "Team color (hex)")
		.option("--icon <emoji>", "Team icon (emoji)")
		.option("--timezone <tz>", "Timezone (e.g., Europe/London)")
		.action(
			handleAsyncCommand(async (name: string, opts: Record<string, string>) => {
				const client = await getClient();
				const input: TeamCreateInput = { name, key: opts.key };
				if (opts.description) input.description = opts.description;
				if (opts.color) input.color = parseColor(opts.color);
				if (opts.icon) input.icon = opts.icon;
				if (opts.timezone) input.timezone = opts.timezone;
				const payload = await client.createTeam(input);
				if (!payload.success) throw new CliError("Failed to create team");
				const team = await payload.team;
				outputSuccess({
					created: true,
					team: team ? { id: team.id, name: team.name, key: team.key } : null,
				});
			}),
		);

	teams
		.command("update <nameOrId>")
		.description("Update a team")
		.option("--name <name>", "New name")
		.option("--key <key>", "New key")
		.option("--description <desc>", "New description")
		.option("--color <hex>", "New color (hex)")
		.option("--icon <emoji>", "New icon (emoji)")
		.option("--timezone <tz>", "New timezone")
		.action(
			handleAsyncCommand(async (nameOrId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const team = await resolveTeam(client, nameOrId);
				const update: Partial<TeamUpdateInput> = {};
				if (opts.name) update.name = opts.name;
				if (opts.key) update.key = opts.key;
				if (opts.description) update.description = opts.description;
				if (opts.color) update.color = parseColor(opts.color);
				if (opts.icon) update.icon = opts.icon;
				if (opts.timezone) update.timezone = opts.timezone;
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateTeam(team.id, update as TeamUpdateInput);
				if (!payload.success) throw new CliError("Failed to update team");
				const updated = await payload.team;
				outputSuccess({
					updated: true,
					team: updated ? { id: updated.id, name: updated.name, key: updated.key } : null,
				});
			}),
		);

	teams
		.command("delete <nameOrId>")
		.description("Archive a team — every issue, project, config goes with it. Requires --yes.")
		.option("--yes", "Confirm team deletion (archives every issue and project in the team)")
		.action(
			handleAsyncCommand(async (nameOrId: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `delete team ${nameOrId} (archives all its issues and projects)`);
				const client = await getClient();
				const team = await resolveTeam(client, nameOrId);
				const payload = await client.deleteTeam(team.id);
				outputSuccess({ deleted: payload.success, name: team.name });
			}),
		);

	teams
		.command("restore <nameOrId>")
		.description("Restore an archived team")
		.action(
			handleAsyncCommand(async (nameOrId: string) => {
				const client = await getClient();
				const team = await resolveTeam(client, nameOrId);
				const payload = await client.unarchiveTeam(team.id);
				outputSuccess({ restored: payload.success, name: team.name });
			}),
		);
}
