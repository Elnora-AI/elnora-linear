// `elnora-linear cycles` — team cycle listings + lookups.

import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { parseLimit, resolveTeam, ValidationError } from "../utils/index.js";

export function setupCyclesCommand(program: Command): void {
	const cycles = program.command("cycles").description("List team cycles");

	cycles
		.command("list")
		.description("List cycles for a team")
		.requiredOption("--team <team>", "Team name or key")
		.option("--type <type>", "Filter: current, previous, next")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const team = await resolveTeam(client, opts.team);
				const result = await client.cycles({
					first: parseLimit(opts.limit, 50),
					filter: { team: { id: { eq: team.id } } },
				});

				let cycleNodes = result.nodes;

				if (opts.type) {
					const validTypes = ["current", "previous", "next"];
					if (!validTypes.includes(opts.type)) {
						throw new ValidationError(
							`Invalid --type value: "${opts.type}". Must be "current", "previous", or "next".`,
						);
					}
					const now = new Date();
					cycleNodes = cycleNodes.filter((c) => {
						const start = c.startsAt ? new Date(c.startsAt) : null;
						const end = c.endsAt ? new Date(c.endsAt) : null;
						switch (opts.type) {
							case "current":
								return start && end && start <= now && end >= now;
							case "previous":
								return end && end < now;
							case "next":
								return start && start > now;
							default:
								return true;
						}
					});
				}

				const rows = cycleNodes.map((c) => ({
					id: c.id,
					number: c.number,
					name: c.name ?? null,
					startsAt: c.startsAt ?? null,
					endsAt: c.endsAt ?? null,
				}));
				outputSuccess({ cycles: rows, team: team.name, count: rows.length });
			}),
		);

	cycles
		.command("get <id>")
		.description("Get cycle details by ID")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const cycle = await client.cycle(id);
				outputSuccess({
					id: cycle.id,
					number: cycle.number,
					name: cycle.name ?? null,
					startsAt: cycle.startsAt ?? null,
					endsAt: cycle.endsAt ?? null,
					completedAt: cycle.completedAt ?? null,
				});
			}),
		);
}
