// `elnora-linear customer-needs` — customer requests / feedback (asks).
//
// Each need anchors to either an issue or a project (Linear requires one).
// `list` uses raw GraphQL with customer/issue/project/creator embedded to
// avoid 4N+1 round-trips.

import type { CustomerNeed, LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { gqlRequest } from "../lib/bulk-graphql.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	CliError,
	findIssueByIdentifier,
	parseLimit,
	parsePriority,
	requireNonEmptyUpdate,
	requireYes,
	resolveProject,
	ValidationError,
} from "../utils/index.js";
import { resolveCustomer } from "./customers.js";

const NEED_GRAPHQL_FIELDS = `
  id body priority archivedAt createdAt
  customer { id name }
  issue { identifier }
  project { name }
  creator { name }
`;

interface NeedNode {
	id: string;
	body: string | null;
	priority: number | null;
	archivedAt: string | null;
	createdAt: string;
	customer: { id: string; name: string } | null;
	issue: { identifier: string } | null;
	project: { name: string } | null;
	creator: { name: string } | null;
}

function formatNeedNode(n: NeedNode): Record<string, unknown> {
	return {
		id: n.id,
		body: n.body,
		customer: n.customer?.name ?? null,
		customerId: n.customer?.id ?? null,
		issue: n.issue?.identifier ?? null,
		project: n.project?.name ?? null,
		creator: n.creator?.name ?? null,
		priority: n.priority,
		archivedAt: n.archivedAt,
		createdAt: n.createdAt,
	};
}

type CustomerNeedCreateInput = Parameters<LinearClient["createCustomerNeed"]>[0];
type CustomerNeedUpdateInput = Parameters<LinearClient["updateCustomerNeed"]>[1];

async function formatNeed(n: CustomerNeed): Promise<Record<string, unknown>> {
	const [customer, issue, project, creator] = await Promise.all([n.customer, n.issue, n.project, n.creator]);
	return formatNeedNode({
		id: n.id,
		body: n.body ?? null,
		priority: n.priority ?? null,
		archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
		createdAt: n.createdAt.toISOString(),
		customer: customer ? { id: customer.id, name: customer.name } : null,
		issue: issue ? { identifier: issue.identifier } : null,
		project: project ? { name: project.name } : null,
		creator: creator ? { name: creator.name } : null,
	});
}

export function setupCustomerNeedsCommand(program: Command): void {
	const needs = program.command("customer-needs").description("Manage customer requests / feedback (asks)");

	needs
		.command("list")
		.description("List customer needs")
		.option("--customer <idOrName>", "Filter by customer (UUID, externalId, or name)")
		.option("--project <name>", "Filter by project name")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const filter: Record<string, unknown> = {};
				if (opts.customer) {
					const c = await resolveCustomer(client, opts.customer);
					filter.customer = { id: { eq: c.id } };
				}
				if (opts.project) {
					const p = await resolveProject(client, opts.project);
					filter.project = { id: { eq: p.id } };
				}
				const res = await gqlRequest<{ customerNeeds: { nodes: NeedNode[] } }>(
					`query($filter: CustomerNeedFilter, $first: Int!) {
            customerNeeds(first: $first, filter: $filter) {
              nodes { ${NEED_GRAPHQL_FIELDS} }
            }
          }`,
					{ filter, first: parseLimit(opts.limit) },
				);
				if (res.errors) {
					throw new CliError(`customer-needs list: ${res.errors.map((e) => e.message).join("; ")}`);
				}
				const items = (res.data?.customerNeeds.nodes ?? []).map(formatNeedNode);
				outputSuccess({ needs: items, count: items.length });
			}),
		);

	needs
		.command("get <id>")
		.description("Get a customer need by UUID")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const need = await client.customerNeed({ id });
				outputSuccess(await formatNeed(need));
			}),
		);

	needs
		.command("create")
		.description("Create a customer need (must be linked to an issue or project)")
		.requiredOption("--body <markdown>", "Need body (markdown)")
		.option("--customer <idOrName>", "Customer (UUID, externalId, or exact name)")
		.option("--customer-external-id <id>", "Customer external ID (alternative to --customer)")
		.option("--issue <id>", "Link to issue (ELN-123 or UUID)")
		.option("--project <name>", "Link to project (name or UUID)")
		.option("--priority <0-4>", "Priority")
		.option("--attachment <id>", "Existing attachment UUID to associate as the source")
		.option("--attachment-url <url>", "URL to create an attachment from")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				if (!opts.issue && !opts.project) {
					throw new ValidationError("Customer needs must link to an issue or a project — pass --issue or --project.");
				}
				if (opts.issue && opts.project) {
					throw new ValidationError("Pass only one of --issue or --project, not both.");
				}
				const client = await getClient();
				const input: CustomerNeedCreateInput = { body: opts.body };
				if (opts.customer) {
					const c = await resolveCustomer(client, opts.customer);
					input.customerId = c.id;
				} else if (opts.customerExternalId) {
					input.customerExternalId = opts.customerExternalId;
				}
				if (opts.issue) {
					const issue = await findIssueByIdentifier(client, opts.issue);
					input.issueId = issue.id;
				}
				if (opts.project) {
					const p = await resolveProject(client, opts.project);
					input.projectId = p.id;
				}
				if (opts.priority) input.priority = parsePriority(opts.priority);
				if (opts.attachment) input.attachmentId = opts.attachment;
				if (opts.attachmentUrl) input.attachmentUrl = opts.attachmentUrl;
				const payload = await client.createCustomerNeed(input);
				if (!payload.success) throw new CliError("Failed to create customer need");
				const need = await payload.need;
				outputSuccess({
					created: true,
					need: need ? await formatNeed(need) : null,
				});
			}),
		);

	needs
		.command("from-attachment <attachmentId>")
		.description("Create a customer need from an existing issue attachment")
		.action(
			handleAsyncCommand(async (attachmentId: string) => {
				const client = await getClient();
				const payload = await client.customerNeedCreateFromAttachment({ attachmentId });
				if (!payload.success) throw new CliError("Failed to create need from attachment");
				const need = await payload.need;
				outputSuccess({
					created: true,
					need: need ? await formatNeed(need) : null,
				});
			}),
		);

	needs
		.command("update <id>")
		.description("Update a customer need")
		.option("--body <markdown>", "New body")
		.option("--customer <idOrName>", "Move to a different customer")
		.option("--issue <id>", "Move to a different issue (ELN-123 or UUID)")
		.option("--project <name>", "Move to a different project")
		.option("--priority <0-4>", "New priority")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const update: Partial<CustomerNeedUpdateInput> = {};
				if (opts.body) update.body = opts.body;
				if (opts.priority) update.priority = parsePriority(opts.priority);
				if (opts.customer) {
					const c = await resolveCustomer(client, opts.customer);
					update.customerId = c.id;
				}
				if (opts.issue) {
					const issue = await findIssueByIdentifier(client, opts.issue);
					update.issueId = issue.id;
				}
				if (opts.project) {
					const p = await resolveProject(client, opts.project);
					update.projectId = p.id;
				}
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateCustomerNeed(id, update as CustomerNeedUpdateInput);
				if (!payload.success) throw new CliError("Failed to update customer need");
				const need = await payload.need;
				outputSuccess({
					updated: true,
					need: need ? await formatNeed(need) : null,
				});
			}),
		);

	needs
		.command("archive <id>")
		.description("Archive a customer need (irreversible — requires --yes)")
		.option("--yes", "Confirm")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `archive customer need ${id}`);
				const client = await getClient();
				const payload = await client.archiveCustomerNeed(id);
				if (!payload.success) throw new CliError("Failed to archive customer need");
				outputSuccess({ archived: true, id });
			}),
		);
}
