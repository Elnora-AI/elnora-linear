// `elnora-linear states` — workflow state lookups by team.

import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { NotFoundError, parseLimit, resolveTeam } from "../utils/index.js";

export function setupStatesCommand(program: Command): void {
	const states = program.command("states").description("List workflow states");

	states
		.command("list")
		.description("List workflow states for a team")
		.requiredOption("--team <team>", "Team name or key")
		.option("--limit <n>", "Max results", "100")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const team = await resolveTeam(client, opts.team);
				const result = await client.workflowStates({
					first: parseLimit(opts.limit, 100),
					filter: { team: { id: { eq: team.id } } },
				});
				const rows = result.nodes.map((s) => ({
					id: s.id,
					name: s.name,
					type: s.type,
					color: s.color,
					position: s.position,
				}));
				outputSuccess({ states: rows, team: team.name, count: rows.length });
			}),
		);

	states
		.command("get <nameOrId>")
		.description("Get workflow state details")
		.requiredOption("--team <team>", "Team name or key")
		.action(
			handleAsyncCommand(async (nameOrId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const team = await resolveTeam(client, opts.team);
				const result = await client.workflowStates({
					first: 250,
					filter: { team: { id: { eq: team.id } } },
				});
				const match = result.nodes.find((s) => s.id === nameOrId || s.name.toLowerCase() === nameOrId.toLowerCase());
				if (!match) throw new NotFoundError("Workflow state", nameOrId);
				outputSuccess({
					id: match.id,
					name: match.name,
					type: match.type,
					color: match.color,
					position: match.position,
					team: team.name,
				});
			}),
		);
}
