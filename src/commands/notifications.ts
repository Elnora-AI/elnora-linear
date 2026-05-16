// `elnora-linear notifications` — Linear inbox surface.
//
// SDK note: notificationMarkReadAll / MarkUnreadAll / SnoozeAll all take a
// NotificationEntityInput (issue, initiative, etc.) — they mark/snooze ALL
// notifications for a given entity, not the entire inbox. Archiving an
// individual notification uses archiveNotification.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, findIssueByIdentifier, parseLimit, requireYes, ValidationError } from "../utils/index.js";

type NotificationEntityInput = Parameters<LinearClient["notificationMarkReadAll"]>[0];
type NotificationsQueryVariables = Parameters<LinearClient["notifications"]>[0];

async function resolveEntity(
	client: LinearClient,
	opts: { issue?: string; initiative?: string; initiativeUpdate?: string },
): Promise<NotificationEntityInput> {
	const provided = [opts.issue, opts.initiative, opts.initiativeUpdate].filter(Boolean);
	if (provided.length === 0) {
		throw new ValidationError("Specify exactly one of --issue, --initiative, --initiative-update.");
	}
	if (provided.length > 1) {
		throw new ValidationError("Only one of --issue / --initiative / --initiative-update may be set.");
	}
	if (opts.issue) {
		const issue = await findIssueByIdentifier(client, opts.issue);
		return { issueId: issue.id };
	}
	if (opts.initiative) {
		return { initiativeId: opts.initiative };
	}
	return { initiativeUpdateId: opts.initiativeUpdate as string };
}

export function setupNotificationsCommand(program: Command): void {
	const notif = program.command("notifications").description("Linear inbox — list, archive, snooze, mark read");

	notif
		.command("list")
		.description("List notifications, newest first")
		.option("--limit <n>", "Max results", "50")
		.option("--unread", "Only unread notifications (filtered client-side after fetch)")
		.action(
			handleAsyncCommand(async (opts: Record<string, string | boolean>) => {
				const client = await getClient();
				const vars: NotificationsQueryVariables = {
					first: parseLimit(typeof opts.limit === "string" ? opts.limit : undefined),
				};
				const conn = await client.notifications(vars);
				const all = conn.nodes.map((n) => ({
					id: n.id,
					type: n.type,
					readAt: n.readAt ?? null,
					snoozedUntilAt: n.snoozedUntilAt ?? null,
					createdAt: n.createdAt,
				}));
				const filtered = opts.unread ? all.filter((n) => !n.readAt) : all;
				outputSuccess({ notifications: filtered, count: filtered.length });
			}),
		);

	notif
		.command("get <id>")
		.description("Get details of a single notification")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const n = await client.notification(id);
				outputSuccess({
					id: n.id,
					type: n.type,
					readAt: n.readAt ?? null,
					snoozedUntilAt: n.snoozedUntilAt ?? null,
					createdAt: n.createdAt,
					updatedAt: n.updatedAt,
				});
			}),
		);

	notif
		.command("archive <id>")
		.description("Archive a single notification (irreversible — requires --yes)")
		.option("--yes", "Confirm")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `archive notification ${id}`);
				const client = await getClient();
				const payload = await client.archiveNotification(id);
				if (!payload.success) throw new CliError("Failed to archive notification");
				outputSuccess({ archived: true, id });
			}),
		);

	notif
		.command("mark-read")
		.description("Mark all notifications for a given entity as read")
		.option("--issue <id>", "Issue identifier (ELN-123) or UUID")
		.option("--initiative <id>", "Initiative UUID")
		.option("--initiative-update <id>", "Initiative update UUID")
		.option("--at <iso>", "Read-at timestamp (default: now)")
		.action(
			handleAsyncCommand(
				async (opts: { issue?: string; initiative?: string; initiativeUpdate?: string; at?: string }) => {
					const client = await getClient();
					const entity = await resolveEntity(client, opts);
					const readAt = opts.at ? new Date(opts.at) : new Date();
					if (Number.isNaN(readAt.getTime())) {
						throw new ValidationError(`Invalid --at: "${opts.at}". Use an ISO timestamp.`);
					}
					const payload = await client.notificationMarkReadAll(entity, readAt);
					if (!payload.success) throw new CliError("Failed to mark read");
					outputSuccess({ marked: "read", entity, readAt: readAt.toISOString() });
				},
			),
		);

	notif
		.command("mark-unread")
		.description("Mark all notifications for a given entity as unread")
		.option("--issue <id>", "Issue identifier (ELN-123) or UUID")
		.option("--initiative <id>", "Initiative UUID")
		.option("--initiative-update <id>", "Initiative update UUID")
		.action(
			handleAsyncCommand(async (opts: { issue?: string; initiative?: string; initiativeUpdate?: string }) => {
				const client = await getClient();
				const entity = await resolveEntity(client, opts);
				const payload = await client.notificationMarkUnreadAll(entity);
				if (!payload.success) throw new CliError("Failed to mark unread");
				outputSuccess({ marked: "unread", entity });
			}),
		);

	notif
		.command("snooze")
		.description("Snooze all notifications for an entity until a given time")
		.requiredOption("--until <iso>", "Snooze until this ISO timestamp")
		.option("--issue <id>", "Issue identifier (ELN-123) or UUID")
		.option("--initiative <id>", "Initiative UUID")
		.option("--initiative-update <id>", "Initiative update UUID")
		.action(
			handleAsyncCommand(
				async (opts: { issue?: string; initiative?: string; initiativeUpdate?: string; until: string }) => {
					const client = await getClient();
					const entity = await resolveEntity(client, opts);
					const until = new Date(opts.until);
					if (Number.isNaN(until.getTime())) {
						throw new ValidationError(`Invalid --until: "${opts.until}". Use an ISO timestamp.`);
					}
					const payload = await client.notificationSnoozeAll(entity, until);
					if (!payload.success) throw new CliError("Failed to snooze");
					outputSuccess({ snoozed: true, entity, until: until.toISOString() });
				},
			),
		);
}
