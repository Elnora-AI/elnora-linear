// `elnora-linear users` — workspace user lookups.

import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { parseLimit, resolveUser } from "../utils/index.js";

export function setupUsersCommand(program: Command): void {
	const users = program.command("users").description("Manage workspace users");

	users
		.command("list")
		.description("List workspace users")
		.option("--limit <n>", "Max results", "250")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const result = await client.users({ first: parseLimit(opts.limit, 250) });
				const rows = result.nodes.map((u) => ({
					id: u.id,
					name: u.name,
					email: u.email,
					active: u.active,
				}));
				outputSuccess({ users: rows, count: rows.length });
			}),
		);

	users
		.command("me")
		.description("Get current authenticated user")
		.action(
			handleAsyncCommand(async () => {
				const client = await getClient();
				const me = await client.viewer;
				outputSuccess({ id: me.id, name: me.name, email: me.email });
			}),
		);

	users
		.command("get <nameOrEmail>")
		.description("Get user details by name, email, or ID")
		.action(
			handleAsyncCommand(async (nameOrEmail: string) => {
				const client = await getClient();
				const resolved = await resolveUser(client, nameOrEmail);
				const full = await client.user(resolved.id);
				outputSuccess({ id: full.id, name: full.name, email: full.email, active: full.active });
			}),
		);
}
