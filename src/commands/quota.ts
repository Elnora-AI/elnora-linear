// `elnora-linear quota` — show remaining Linear API rate-limit budget.
//
// Wraps the SDK's rateLimitStatus query so callers can check headroom before
// running large bulk operations or long-lived scripts.

import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";

export function setupQuotaCommand(program: Command): void {
	program
		.command("quota")
		.description("Show remaining Linear API rate-limit budget")
		.action(
			handleAsyncCommand(async () => {
				const client = await getClient();
				const payload = await client.rateLimitStatus;
				outputSuccess({
					identifier: payload.identifier ?? null,
					kind: payload.kind,
					limits: payload.limits.map((l) => ({
						type: l.type,
						allowed: l.allowedAmount,
						remaining: l.remainingAmount,
						requested: l.requestedAmount,
						periodMs: l.period,
						resetAt: new Date(l.reset).toISOString(),
					})),
				});
			}),
		);
}
