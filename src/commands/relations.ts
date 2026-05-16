// `elnora-linear relations` — manage IssueRelation edges between issues.
// Supports "related", "blocks", "duplicate", "similar".

import { IssueRelationType } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, findIssueByIdentifier, requireYes } from "../utils/index.js";

const VALID_TYPES = Object.values(IssueRelationType);

export function setupRelationsCommand(program: Command): void {
	const relations = program
		.command("relations")
		.description("Manage issue relations (related, blocks, duplicate, similar)");

	relations
		.command("create <issueId> <relatedIssueId>")
		.description("Create a relation between two issues")
		.option("--type <type>", `Relation type: ${VALID_TYPES.join(", ")}`, "related")
		.action(
			handleAsyncCommand(async (issueId: string, relatedIssueId: string, opts: { type: string }) => {
				const client = await getClient();
				if (!VALID_TYPES.includes(opts.type as IssueRelationType)) {
					throw new CliError(`Invalid relation type: ${opts.type}. Valid types: ${VALID_TYPES.join(", ")}`);
				}
				const [issue, relatedIssue] = await Promise.all([
					findIssueByIdentifier(client, issueId),
					findIssueByIdentifier(client, relatedIssueId),
				]);
				const payload = await client.createIssueRelation({
					issueId: issue.id,
					relatedIssueId: relatedIssue.id,
					type: opts.type as IssueRelationType,
				});
				if (!payload.success) throw new CliError("Failed to create issue relation");
				const relation = await payload.issueRelation;
				outputSuccess({
					created: true,
					relation: relation
						? {
								id: relation.id,
								type: relation.type,
								issueId: issue.identifier,
								relatedIssueId: relatedIssue.identifier,
							}
						: null,
				});
			}),
		);

	relations
		.command("list <issueId>")
		.description("List all relations for an issue")
		.action(
			handleAsyncCommand(async (issueId: string) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const relationsConn = await issue.relations();
				const result = await Promise.all(
					relationsConn.nodes.map(async (r) => {
						const related = await r.relatedIssue;
						return {
							id: r.id,
							type: r.type,
							relatedIssue: related ? { identifier: related.identifier, title: related.title } : null,
						};
					}),
				);
				outputSuccess({ relations: result, count: result.length });
			}),
		);

	relations
		.command("delete <relationId>")
		.description("Delete an issue relation by its UUID (irreversible — requires --yes)")
		.option("--yes", "Confirm deletion")
		.action(
			handleAsyncCommand(async (relationId: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `delete issue relation ${relationId}`);
				const client = await getClient();
				const payload = await client.deleteIssueRelation(relationId);
				outputSuccess({ deleted: payload.success });
			}),
		);
}
