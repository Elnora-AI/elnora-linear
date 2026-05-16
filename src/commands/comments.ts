// `elnora-linear comments` — manage issue comments.
//
// `list` uses raw GraphQL with an embedded user{name} subquery to avoid N+1
// round-trips when rendering threads.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { gqlRequest } from "../lib/bulk-graphql.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, findIssueByIdentifier, NotFoundError, requireYes } from "../utils/index.js";

type CommentCreateInput = Parameters<LinearClient["createComment"]>[0];
type CommentUpdateInput = Parameters<LinearClient["updateComment"]>[1];

export function setupCommentsCommand(program: Command): void {
	const comments = program.command("comments").description("Manage issue comments");

	comments
		.command("list <issueId>")
		.description("List comments on an issue")
		.action(
			handleAsyncCommand(async (issueId: string) => {
				type CommentNode = {
					id: string;
					body: string;
					createdAt: string;
					updatedAt: string;
					user: { name: string } | null;
				};
				const m = issueId.match(/^([A-Z]+)-(\d+)$/);
				const filter = m
					? { team: { key: { eq: m[1] } }, number: { eq: parseInt(m[2], 10) } }
					: { id: { eq: issueId } };
				const res = await gqlRequest<{
					issues: { nodes: { comments: { nodes: CommentNode[] } }[] };
				}>(
					`query($filter: IssueFilter!) {
            issues(first: 1, filter: $filter) {
              nodes {
                comments(first: 100) {
                  nodes { id body createdAt updatedAt user { name } }
                }
              }
            }
          }`,
					{ filter },
				);
				if (res.errors) {
					throw new CliError(`comments list: ${res.errors.map((e) => e.message).join("; ")}`);
				}
				const issue = res.data?.issues.nodes[0];
				if (!issue) throw new NotFoundError("Issue", issueId);
				const rows = issue.comments.nodes.map((c) => ({
					id: c.id,
					author: c.user?.name ?? null,
					body: c.body,
					createdAt: c.createdAt,
					updatedAt: c.updatedAt,
				}));
				outputSuccess({ comments: rows, count: rows.length });
			}),
		);

	comments
		.command("create <issueId>")
		.description("Add a comment to an issue")
		.requiredOption("--body <text>", "Comment text (markdown)")
		.action(
			handleAsyncCommand(async (issueId: string, opts: { body: string }) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const input: CommentCreateInput = { issueId: issue.id, body: opts.body };
				const payload = await client.createComment(input);
				if (!payload.success) throw new CliError("Failed to create comment");
				const comment = await payload.comment;
				outputSuccess({
					created: true,
					comment: comment ? { id: comment.id, body: comment.body } : null,
				});
			}),
		);

	comments
		.command("update <commentId>")
		.description("Update an existing comment")
		.requiredOption("--body <text>", "New comment text (markdown)")
		.action(
			handleAsyncCommand(async (commentId: string, opts: { body: string }) => {
				const client = await getClient();
				const update: CommentUpdateInput = { body: opts.body };
				const payload = await client.updateComment(commentId, update);
				if (!payload.success) throw new CliError("Failed to update comment");
				const comment = await payload.comment;
				outputSuccess({
					updated: true,
					comment: comment ? { id: comment.id, body: comment.body } : null,
				});
			}),
		);

	comments
		.command("delete <commentId>")
		.description("Permanently delete a comment (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (commentId: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `permanently delete comment ${commentId}`);
				const client = await getClient();
				const payload = await client.deleteComment(commentId);
				outputSuccess({ deleted: payload.success });
			}),
		);

	comments
		.command("resolve <commentId>")
		.description("Mark a comment thread as resolved")
		.action(
			handleAsyncCommand(async (commentId: string) => {
				const client = await getClient();
				const payload = await client.commentResolve(commentId);
				if (!payload.success) throw new CliError("Failed to resolve comment");
				outputSuccess({ resolved: true, id: commentId });
			}),
		);

	comments
		.command("unresolve <commentId>")
		.description("Reopen a resolved comment thread")
		.action(
			handleAsyncCommand(async (commentId: string) => {
				const client = await getClient();
				const payload = await client.commentUnresolve(commentId);
				if (!payload.success) throw new CliError("Failed to unresolve comment");
				outputSuccess({ unresolved: true, id: commentId });
			}),
		);
}
