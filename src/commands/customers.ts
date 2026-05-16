// `elnora-linear customers` — Linear customer-feedback entities.
//
// Pairs with `customer-needs`, which represents the asks tied to each customer.
// Customers can have multiple externalIds — `get` and `resolve` match on UUID,
// any externalId, or exact name.

import type { Customer, LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	CliError,
	isUUID,
	NotFoundError,
	parseLimit,
	requireNonEmptyUpdate,
	resolveUser,
	ValidationError,
} from "../utils/index.js";

type CustomerCreateInput = Parameters<LinearClient["createCustomer"]>[0];
type CustomerUpdateInput = Parameters<LinearClient["updateCustomer"]>[1];
type CustomerUpsertInput = Parameters<LinearClient["customerUpsert"]>[0];

export async function resolveCustomer(client: LinearClient, input: string): Promise<Customer> {
	if (isUUID(input)) return client.customer(input);
	const conn = await client.customers({ first: 250 });
	const all = [...conn.nodes];
	let cursor = conn;
	while (cursor.pageInfo.hasNextPage) {
		cursor = await cursor.fetchNext();
		all.push(...cursor.nodes);
	}
	const lower = input.toLowerCase();
	const match = all.find(
		(c) => c.name.toLowerCase() === lower || c.externalIds.some((eid: string) => eid.toLowerCase() === lower),
	);
	if (!match) throw new NotFoundError("Customer", input);
	return match;
}

function parseCsv(value: string | undefined): string[] | undefined {
	if (!value) return undefined;
	const parts = value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts : undefined;
}

async function formatCustomer(c: Customer): Promise<Record<string, unknown>> {
	const owner = await c.owner;
	return {
		id: c.id,
		name: c.name,
		domains: c.domains,
		externalIds: c.externalIds,
		revenue: c.revenue ?? null,
		size: c.size ?? null,
		owner: owner?.name ?? null,
		needCount: c.approximateNeedCount,
		logoUrl: c.logoUrl ?? null,
		archivedAt: c.archivedAt ?? null,
		createdAt: c.createdAt,
	};
}

export function setupCustomersCommand(program: Command): void {
	const customers = program
		.command("customers")
		.description("Manage Linear customer organizations (customer-feedback feature)");

	customers
		.command("list")
		.description("List customers")
		.option("--query <text>", "Filter by name match (client-side)")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const conn = await client.customers({ first: parseLimit(opts.limit) });
				const items = await Promise.all(conn.nodes.map(formatCustomer));
				const filtered = opts.query
					? items.filter((c) => String(c.name).toLowerCase().includes(opts.query.toLowerCase()))
					: items;
				outputSuccess({ customers: filtered, count: filtered.length });
			}),
		);

	customers
		.command("get <idOrName>")
		.description("Get a customer by UUID, external id, or exact name")
		.action(
			handleAsyncCommand(async (idOrName: string) => {
				const client = await getClient();
				const customer = await resolveCustomer(client, idOrName);
				outputSuccess(await formatCustomer(customer));
			}),
		);

	customers
		.command("create <name>")
		.description("Create a customer")
		.option("--domains <csv>", "Comma-separated email domains (e.g. acme.com)")
		.option("--external-ids <csv>", "Comma-separated external system IDs")
		.option("--owner <userOrMe>", "Owner (name, email, or 'me')")
		.option("--revenue <n>", "Annual revenue (USD, integer)")
		.option("--size <n>", "Number of employees / seats")
		.option("--logo-url <url>", "Logo image URL")
		.action(
			handleAsyncCommand(async (name: string, opts: Record<string, string>) => {
				const client = await getClient();
				const input: CustomerCreateInput = { name };
				if (opts.domains) input.domains = parseCsv(opts.domains);
				if (opts.externalIds) input.externalIds = parseCsv(opts.externalIds);
				if (opts.logoUrl) input.logoUrl = opts.logoUrl;
				if (opts.revenue !== undefined) input.revenue = Number(opts.revenue);
				if (opts.size !== undefined) input.size = Number(opts.size);
				if (opts.owner) {
					const u = await resolveUser(client, opts.owner);
					input.ownerId = u.id;
				}
				const payload = await client.createCustomer(input);
				if (!payload.success) throw new CliError("Failed to create customer");
				const customer = await payload.customer;
				outputSuccess({
					created: true,
					customer: customer ? await formatCustomer(customer) : null,
				});
			}),
		);

	customers
		.command("update <idOrName>")
		.description("Update a customer")
		.option("--name <name>", "New display name")
		.option("--domains <csv>", "Replace domain list")
		.option("--external-ids <csv>", "Replace external IDs list")
		.option("--owner <userOrMe>", "Set owner (name, email, 'me', or 'none')")
		.option("--revenue <n>", "Annual revenue")
		.option("--size <n>", "Number of employees / seats")
		.option("--logo-url <url>", "Logo image URL")
		.action(
			handleAsyncCommand(async (idOrName: string, opts: Record<string, string>) => {
				const client = await getClient();
				const customer = await resolveCustomer(client, idOrName);
				const update: Partial<CustomerUpdateInput> = {};
				if (opts.name) update.name = opts.name;
				if (opts.domains) update.domains = parseCsv(opts.domains);
				if (opts.externalIds) update.externalIds = parseCsv(opts.externalIds);
				if (opts.logoUrl) update.logoUrl = opts.logoUrl;
				if (opts.revenue !== undefined) update.revenue = Number(opts.revenue);
				if (opts.size !== undefined) update.size = Number(opts.size);
				if (opts.owner) {
					if (opts.owner.toLowerCase() === "none") {
						update.ownerId = null;
					} else {
						const u = await resolveUser(client, opts.owner);
						update.ownerId = u.id;
					}
				}
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateCustomer(customer.id, update as CustomerUpdateInput);
				if (!payload.success) throw new CliError("Failed to update customer");
				const updated = await payload.customer;
				outputSuccess({
					updated: true,
					customer: updated ? await formatCustomer(updated) : null,
				});
			}),
		);

	customers
		.command("upsert")
		.description("Create or update a customer, matched by --external-id or --id")
		.option("--name <name>", "Display name (required when creating)")
		.option("--external-id <id>", "External system ID — primary upsert key")
		.option("--id <uuid>", "UUID upsert key (alternative)")
		.option("--domains <csv>", "Email domains")
		.option("--owner <userOrMe>", "Owner (name, email, 'me')")
		.option("--revenue <n>", "Annual revenue")
		.option("--size <n>", "Size")
		.option("--logo-url <url>", "Logo URL")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				if (!opts.externalId && !opts.id) {
					throw new ValidationError("Upsert needs --external-id or --id as the match key.");
				}
				const client = await getClient();
				const input: CustomerUpsertInput = {};
				if (opts.name) input.name = opts.name;
				if (opts.externalId) input.externalId = opts.externalId;
				if (opts.id) input.id = opts.id;
				if (opts.domains) input.domains = parseCsv(opts.domains);
				if (opts.logoUrl) input.logoUrl = opts.logoUrl;
				if (opts.revenue !== undefined) input.revenue = Number(opts.revenue);
				if (opts.size !== undefined) input.size = Number(opts.size);
				if (opts.owner) {
					const u = await resolveUser(client, opts.owner);
					input.ownerId = u.id;
				}
				const payload = await client.customerUpsert(input);
				if (!payload.success) throw new CliError("Failed to upsert customer");
				const customer = await payload.customer;
				outputSuccess({
					upserted: true,
					customer: customer ? await formatCustomer(customer) : null,
				});
			}),
		);
}
