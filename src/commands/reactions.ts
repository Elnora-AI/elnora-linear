// `elnora-linear react` / `unreact` — top-level emoji reaction shortcuts.
//
// Linear's ReactionCreateInput accepts issueId in either UUID or "ELN-123"
// form, so we don't need to resolve issue identifiers ourselves. Comments
// require UUIDs. Use --issue to force the issue interpretation when the
// target is a UUID (issue UUIDs and comment UUIDs share the same shape).

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, isUUID, ValidationError } from "../utils/index.js";

type ReactionCreateInput = Parameters<LinearClient["createReaction"]>[0];

export function buildReactionInput(target: string, emoji: string, isIssue: boolean): ReactionCreateInput {
	if (!emoji) {
		throw new ValidationError("Emoji is required.");
	}
	if (/^[A-Za-z]+-\d+$/.test(target)) {
		if (isIssue) {
			process.stderr.write(`Warning: --issue is implied for issue identifier "${target}" — flag has no effect.\n`);
		}
		return { emoji, issueId: target };
	}
	if (!isUUID(target)) {
		throw new ValidationError(`Invalid target: "${target}". Use an issue identifier (ELN-123) or a UUID.`);
	}
	return isIssue ? { emoji, issueId: target } : { emoji, commentId: target };
}

export function setupReactionsCommand(program: Command): void {
	program
		.command("react <target> <emoji>")
		.description(
			"Add an emoji reaction. Target = ELN-123 (issue) or comment UUID. Use --issue to force issue when target is a UUID.",
		)
		.option("--issue", "Treat the UUID target as an issue (default: comment)")
		.action(
			handleAsyncCommand(async (target: string, emoji: string, opts: Record<string, boolean>) => {
				const client = await getClient();
				const input = buildReactionInput(target, emoji, Boolean(opts.issue));
				const payload = await client.createReaction(input);
				if (!payload.success) throw new CliError("Failed to create reaction");
				const reaction = await payload.reaction;
				outputSuccess({
					created: true,
					reaction: reaction ? { id: reaction.id, emoji: reaction.emoji } : null,
				});
			}),
		);

	program
		.command("unreact <reactionId>")
		.description("Remove a reaction by its id")
		.action(
			handleAsyncCommand(async (reactionId: string) => {
				const client = await getClient();
				const payload = await client.deleteReaction(reactionId);
				if (!payload.success) throw new CliError("Failed to delete reaction");
				outputSuccess({ deleted: true, id: reactionId });
			}),
		);
}
