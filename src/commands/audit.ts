// `elnora-linear audit` — read-only access to Linear's audit log.
//
// Useful for SOC 2 / compliance evidence pulls. IPs and key IDs/labels redacted
// by default; opt in via `--unsafe-include-pii` and treat the output as
// confidential.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess, redactAuditEntry } from "../output/index.js";
import { parseLimit, ValidationError } from "../utils/index.js";

type AuditEntriesQueryVariables = Parameters<LinearClient["auditEntries"]>[0];
type AuditEntryFilter = NonNullable<NonNullable<AuditEntriesQueryVariables>["filter"]>;

export function setupAuditCommand(program: Command): void {
	const audit = program.command("audit").description("Read Linear audit log entries (compliance / SOC 2 evidence)");

	audit
		.command("entries")
		.description("List audit entries, newest first. IPs and key IDs redacted by default.")
		.option("--limit <n>", "Max results", "50")
		.option("--since <iso>", "Only entries created after this ISO timestamp")
		.option("--type <type>", "Filter by audit entry type (see `audit types`)")
		.option(
			"--unsafe-include-pii",
			"Return raw IPs, API key IDs/labels, and OAuth client names. Treat output as confidential.",
		)
		.action(
			handleAsyncCommand(async (opts: Record<string, string | boolean>) => {
				const client = await getClient();
				const filter: AuditEntryFilter = {};
				if (opts.since) {
					const d = new Date(String(opts.since));
					if (Number.isNaN(d.getTime())) {
						throw new ValidationError(`Invalid --since: "${opts.since}". Use an ISO timestamp.`);
					}
					filter.createdAt = { gt: d };
				}
				if (opts.type) {
					filter.type = { eq: String(opts.type) };
				}
				const vars: AuditEntriesQueryVariables = {
					first: parseLimit(typeof opts.limit === "string" ? opts.limit : undefined),
				};
				if (Object.keys(filter).length > 0) {
					vars.filter = filter;
				}
				const conn = await client.auditEntries(vars);
				const entries = await Promise.all(
					conn.nodes.map(async (e) => {
						const actor = await e.actor;
						return {
							id: e.id,
							type: e.type,
							actor: actor?.name ?? null,
							actorId: e.actorId ?? null,
							countryCode: e.countryCode ?? null,
							ip: e.ip ?? null,
							createdAt: e.createdAt,
							metadata: e.metadata ?? null,
						};
					}),
				);

				if (opts.unsafeIncludePii) {
					process.stderr.write(
						"Warning: --unsafe-include-pii is on; output contains IPs and API key IDs. Treat as confidential.\n",
					);
					outputSuccess({ entries, count: entries.length });
					return;
				}

				const redacted = entries.map((e) => redactAuditEntry(e));
				outputSuccess({ entries: redacted, count: redacted.length });
			}),
		);

	audit
		.command("types")
		.description("List available audit entry types")
		.option("--prefix <str>", "Filter types by case-sensitive prefix")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const types = await client.auditEntryTypes;
				const filtered = opts.prefix ? types.filter((t) => t.type.startsWith(opts.prefix)) : types;
				outputSuccess({
					types: filtered.map((t) => ({ type: t.type, description: t.description })),
					count: filtered.length,
				});
			}),
		);
}
