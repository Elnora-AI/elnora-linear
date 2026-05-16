// `elnora-linear webhooks` — manage Linear webhooks programmatically.
//
// Needed to register agent webhook endpoints, rotate secrets, and audit what
// webhooks the workspace currently has registered. `verify` runs the HMAC
// check from utils/webhook-verify against a body file + signature file pair.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { LinearClient, Webhook } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { gqlRequest } from "../lib/bulk-graphql.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	CliError,
	parseLimit,
	requireNonEmptyUpdate,
	requireYes,
	resolveTeam,
	ValidationError,
	verifyLinearWebhook,
} from "../utils/index.js";

type WebhookCreateInput = Parameters<LinearClient["createWebhook"]>[0];
type WebhookUpdateInput = Parameters<LinearClient["updateWebhook"]>[1];

function parseResourceTypes(value: string | undefined): string[] | undefined {
	if (!value) return undefined;
	const parts = value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts : undefined;
}

async function formatWebhook(w: Webhook): Promise<Record<string, unknown>> {
	const team = await w.team;
	return {
		id: w.id,
		label: w.label ?? null,
		url: w.url,
		enabled: w.enabled,
		resourceTypes: w.resourceTypes,
		team: team?.name ?? null,
		allPublicTeams: w.allPublicTeams,
		createdAt: w.createdAt,
	};
}

export function setupWebhooksCommand(program: Command): void {
	const webhooks = program.command("webhooks").description("Manage Linear webhooks (agent framework integration)");

	webhooks
		.command("list")
		.description("List webhooks registered for the workspace")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				type WebhookNode = {
					id: string;
					label: string | null;
					url: string;
					enabled: boolean;
					resourceTypes: string[];
					allPublicTeams: boolean;
					createdAt: string;
					team: { name: string } | null;
				};
				const res = await gqlRequest<{ webhooks: { nodes: WebhookNode[] } }>(
					`query($first: Int!) {
            webhooks(first: $first) {
              nodes { id label url enabled resourceTypes allPublicTeams createdAt team { name } }
            }
          }`,
					{ first: parseLimit(opts.limit) },
				);
				if (res.errors) {
					throw new CliError(`webhooks list: ${res.errors.map((e) => e.message).join("; ")}`);
				}
				const items = (res.data?.webhooks.nodes ?? []).map((w) => ({
					id: w.id,
					label: w.label,
					url: w.url,
					enabled: w.enabled,
					resourceTypes: w.resourceTypes,
					team: w.team?.name ?? null,
					allPublicTeams: w.allPublicTeams,
					createdAt: w.createdAt,
				}));
				outputSuccess({ webhooks: items, count: items.length });
			}),
		);

	webhooks
		.command("get <id>")
		.description("Get details of a single webhook")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const w = await client.webhook(id);
				outputSuccess(await formatWebhook(w));
			}),
		);

	webhooks
		.command("create")
		.description("Register a new webhook")
		.requiredOption("--url <url>", "HTTPS URL to receive webhook POSTs")
		.requiredOption("--resource-types <csv>", "Comma-separated resource types (e.g. Issue,Comment,AgentSessionEvent)")
		.option("--label <label>", "Human-readable label")
		.option("--team <team>", "Scope to a single team (otherwise --all-public-teams)")
		.option("--all-public-teams", "Subscribe to events from all public teams")
		.option("--secret <secret>", "Optional preset signing secret (otherwise Linear generates one)")
		.option("--disabled", "Create disabled (default: enabled)")
		.action(
			handleAsyncCommand(async (opts: Record<string, string | boolean>) => {
				if (!opts.team && !opts.allPublicTeams) {
					throw new ValidationError(
						"Pass --team <name> for a single-team scope or --all-public-teams for workspace scope.",
					);
				}
				if (opts.team && opts.allPublicTeams) {
					throw new ValidationError("Pass only one of --team or --all-public-teams.");
				}
				const client = await getClient();
				const url = String(opts.url);
				if (!url.startsWith("https://")) {
					throw new ValidationError(`Webhook --url must be HTTPS: "${url}"`);
				}
				const input: WebhookCreateInput = {
					url,
					resourceTypes:
						parseResourceTypes(typeof opts.resourceTypes === "string" ? opts.resourceTypes : undefined) ?? [],
					enabled: !opts.disabled,
				};
				if (typeof opts.label === "string") input.label = opts.label;
				if (typeof opts.secret === "string") input.secret = opts.secret;
				if (opts.team) {
					const t = await resolveTeam(client, String(opts.team));
					input.teamId = t.id;
				}
				if (opts.allPublicTeams) input.allPublicTeams = true;
				const payload = await client.createWebhook(input);
				if (!payload.success) throw new CliError("Failed to create webhook");
				const webhook = await payload.webhook;
				outputSuccess({
					created: true,
					webhook: webhook ? await formatWebhook(webhook) : null,
				});
			}),
		);

	webhooks
		.command("update <id>")
		.description("Update an existing webhook")
		.option("--url <url>", "New URL")
		.option("--resource-types <csv>", "Replace resource types list")
		.option("--label <label>", "New label")
		.option("--enabled", "Enable")
		.option("--disabled", "Disable")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				if (opts.enabled && opts.disabled) {
					throw new ValidationError("Pass only one of --enabled or --disabled.");
				}
				const client = await getClient();
				const update: Partial<WebhookUpdateInput> = {};
				if (typeof opts.url === "string") {
					if (!opts.url.startsWith("https://")) {
						throw new ValidationError(`Webhook --url must be HTTPS: "${opts.url}"`);
					}
					update.url = opts.url;
				}
				if (typeof opts.resourceTypes === "string") {
					update.resourceTypes = parseResourceTypes(opts.resourceTypes);
				}
				if (typeof opts.label === "string") update.label = opts.label;
				if (opts.enabled) update.enabled = true;
				if (opts.disabled) update.enabled = false;
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateWebhook(id, update as WebhookUpdateInput);
				if (!payload.success) throw new CliError("Failed to update webhook");
				const webhook = await payload.webhook;
				outputSuccess({
					updated: true,
					webhook: webhook ? await formatWebhook(webhook) : null,
				});
			}),
		);

	webhooks
		.command("delete <id>")
		.description("Delete a webhook (irreversible — requires --yes)")
		.option("--yes", "Confirm")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `delete webhook ${id}`);
				const client = await getClient();
				const payload = await client.deleteWebhook(id);
				if (!payload.success) throw new CliError("Failed to delete webhook");
				outputSuccess({ deleted: true, id });
			}),
		);

	webhooks
		.command("rotate-secret <id>")
		.description("Rotate the signing secret for a webhook. The new secret is shown ONCE — store it immediately.")
		.option("--yes", "Confirm")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `rotate secret for webhook ${id}`);
				const client = await getClient();
				const payload = await client.rotateSecretWebhook(id);
				if (!payload.success) throw new CliError("Failed to rotate webhook secret");
				const secret = (payload as unknown as { secret?: string }).secret;
				outputSuccess({
					rotated: true,
					id,
					secret: secret ?? null,
					warning: "Store this secret now — it will not be shown again.",
				});
			}),
		);

	webhooks
		.command("verify <signatureFile>")
		.description(
			"Verify a Linear-Signature against a body file. <signatureFile> contains the hex signature; pass --body for the payload file. Reads --secret from arg or LINEAR_WEBHOOK_SECRET.",
		)
		.requiredOption("--body <file>", "Path to the raw request body file")
		.option("--secret <secret>", "Signing secret (default: $LINEAR_WEBHOOK_SECRET)")
		.option("--no-timestamp-check", "Skip the replay-window check (debug only — never disable in production)")
		.option("--max-age-ms <n>", "Replay window in ms (default 60000 = 60 s, per Linear recommendation)")
		.action(
			handleAsyncCommand(async (signatureFile: string, opts: Record<string, string | boolean>) => {
				const secret = (typeof opts.secret === "string" ? opts.secret : undefined) ?? process.env.LINEAR_WEBHOOK_SECRET;
				if (!secret) {
					throw new ValidationError("No webhook secret provided. Pass --secret or set LINEAR_WEBHOOK_SECRET.");
				}
				let signature: string;
				let body: Buffer;
				try {
					signature = readFileSync(resolvePath(signatureFile as string), "utf-8").trim();
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					throw new ValidationError(`Cannot read signature file: ${msg}`);
				}
				try {
					body = readFileSync(resolvePath(opts.body as string));
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					throw new ValidationError(`Cannot read body file: ${msg}`);
				}
				let timestamp: number | undefined;
				if (opts.timestampCheck !== false) {
					try {
						const parsed = JSON.parse(body.toString("utf-8"));
						if (typeof parsed?.webhookTimestamp === "number") {
							timestamp = parsed.webhookTimestamp;
						}
					} catch {
						// Body isn't JSON — fall through and let the HMAC check handle it.
					}
				}
				const maxAgeMs = typeof opts.maxAgeMs === "string" ? Number(opts.maxAgeMs) : undefined;
				const ok = verifyLinearWebhook({ rawBody: body, signature, secret, timestamp, maxAgeMs });
				outputSuccess({ verified: ok, replayCheckApplied: typeof timestamp === "number" });
			}),
		);
}
