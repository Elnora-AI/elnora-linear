// `elnora-linear agent-sessions` — Linear agent framework session lifecycle.
//
// Sessions are auto-created by Linear when an agent is @mentioned or assigned
// an issue. The CLI can also create them explicitly for testing the activity
// emitter.

import type { AgentSession, LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, findIssueByIdentifier, parseLimit } from "../utils/index.js";

type AgentSessionCreateOnIssue = Parameters<LinearClient["agentSessionCreateOnIssue"]>[0];
type AgentSessionCreateOnComment = Parameters<LinearClient["agentSessionCreateOnComment"]>[0];
type AgentSessionUpdateInput = Parameters<LinearClient["updateAgentSession"]>[1];
type AgentSessionUpdateExternalUrlInput = Parameters<LinearClient["agentSessionUpdateExternalUrl"]>[1];

async function formatSession(s: AgentSession): Promise<Record<string, unknown>> {
	const [appUser, creator, issue, comment] = await Promise.all([s.appUser, s.creator, s.issue, s.comment]);
	return {
		id: s.id,
		appUser: appUser?.name ?? null,
		creator: creator?.name ?? null,
		issue: issue?.identifier ?? null,
		comment: comment?.id ?? null,
		type: s.type ?? null,
		status: s.status ?? null,
		startedAt: s.startedAt ?? null,
		endedAt: s.endedAt ?? null,
		dismissedAt: s.dismissedAt ?? null,
		externalLink: s.externalLink ?? null,
		createdAt: s.createdAt,
	};
}

export function setupAgentSessionsCommand(program: Command): void {
	const sessions = program.command("agent-sessions").description("Manage Linear agent sessions (agent framework)");

	sessions
		.command("list")
		.description("List agent sessions, newest first")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const conn = await client.agentSessions({ first: parseLimit(opts.limit) });
				const items = await Promise.all(conn.nodes.map(formatSession));
				outputSuccess({ sessions: items, count: items.length });
			}),
		);

	sessions
		.command("get <id>")
		.description("Get details of a single agent session")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const session = await client.agentSession(id);
				outputSuccess(await formatSession(session));
			}),
		);

	sessions
		.command("create-on-issue <issueId>")
		.description("Create an agent session on an issue (issueId can be ENG-123 or UUID)")
		.option("--external-link <url>", "External agent-hosted page URL")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const input: AgentSessionCreateOnIssue = { issueId: issue.id };
				if (opts.externalLink) input.externalLink = opts.externalLink;
				const payload = await client.agentSessionCreateOnIssue(input);
				if (!payload.success) throw new CliError("Failed to create agent session");
				const session = await payload.agentSession;
				outputSuccess({
					created: true,
					session: session ? await formatSession(session) : null,
				});
			}),
		);

	sessions
		.command("create-on-comment <commentId>")
		.description("Create an agent session on a comment thread (commentId is a UUID)")
		.option("--external-link <url>", "External agent-hosted page URL")
		.action(
			handleAsyncCommand(async (commentId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const input: AgentSessionCreateOnComment = { commentId };
				if (opts.externalLink) input.externalLink = opts.externalLink;
				const payload = await client.agentSessionCreateOnComment(input);
				if (!payload.success) throw new CliError("Failed to create agent session");
				const session = await payload.agentSession;
				outputSuccess({
					created: true,
					session: session ? await formatSession(session) : null,
				});
			}),
		);

	sessions
		.command("update <id>")
		.description("Update an agent session (replace plan, externalLink, etc — owner-app only)")
		.option("--external-link <url>", "Replace external link")
		.option("--plan <jsonString>", "Replace plan (JSON object as string)")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const update: AgentSessionUpdateInput = {};
				if (opts.externalLink) update.externalLink = opts.externalLink;
				if (opts.plan) {
					try {
						update.plan = JSON.parse(opts.plan);
					} catch (e: unknown) {
						const msg = e instanceof Error ? e.message : String(e);
						throw new CliError(`Invalid --plan JSON: ${msg}`);
					}
				}
				const payload = await client.updateAgentSession(id, update);
				if (!payload.success) throw new CliError("Failed to update agent session");
				const session = await payload.agentSession;
				outputSuccess({
					updated: true,
					session: session ? await formatSession(session) : null,
				});
			}),
		);

	sessions
		.command("update-external-url <id>")
		.description("Add/remove/replace external URLs on a session")
		.option("--external-link <url>", "Replace primary external link")
		.option("--add <url>", "Add a single external URL (label = url)")
		.option("--remove <url>", "Remove a single external URL by URL string")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const input: AgentSessionUpdateExternalUrlInput = {};
				if (opts.externalLink) input.externalLink = opts.externalLink;
				if (opts.add) input.addedExternalUrls = [{ url: opts.add, label: opts.add }];
				if (opts.remove) input.removedExternalUrls = [opts.remove];
				const payload = await client.agentSessionUpdateExternalUrl(id, input);
				if (!payload.success) throw new CliError("Failed to update external URL");
				outputSuccess({ updated: true, id });
			}),
		);
}
