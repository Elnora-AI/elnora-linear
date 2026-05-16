// `elnora-linear project-relations` — project-to-project dependency edges.
//
// Distinct from `relations` (which is IssueRelation between issues). Linear's
// current schema accepts these enum-ish strings (verified live):
//   --type:    "dependency" (only currently-valid value)
//   --anchor:  "start" | "end" | "milestone"
// Defaults model the common "B blocks A" case: A's end gated by B's start.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, requireYes, resolveProject } from "../utils/index.js";

type ProjectRelationCreateInput = Parameters<LinearClient["createProjectRelation"]>[0];

export function setupProjectRelationsCommand(program: Command): void {
	const relations = program
		.command("project-relations")
		.description("Manage project-to-project dependency relations (blocks, related)");

	relations
		.command("create <project> <relatedProject>")
		.description("Create a dependency relation between two projects")
		.option("--type <type>", "Relation type (Linear currently only accepts 'dependency')", "dependency")
		.option("--anchor <type>", "Anchor on source project: start|end|milestone", "end")
		.option("--related-anchor <type>", "Anchor on related project: start|end|milestone", "start")
		.option("--milestone-id <id>", "Source project milestone UUID (when anchor=milestone)")
		.option("--related-milestone-id <id>", "Related project milestone UUID (when related-anchor=milestone)")
		.action(
			handleAsyncCommand(async (projectArg: string, relatedArg: string, opts: Record<string, string>) => {
				const client = await getClient();
				const [project, related] = await Promise.all([
					resolveProject(client, projectArg),
					resolveProject(client, relatedArg),
				]);
				const input: ProjectRelationCreateInput = {
					projectId: project.id,
					relatedProjectId: related.id,
					type: opts.type,
					anchorType: opts.anchor,
					relatedAnchorType: opts.relatedAnchor,
				};
				if (opts.milestoneId) input.projectMilestoneId = opts.milestoneId;
				if (opts.relatedMilestoneId) input.relatedProjectMilestoneId = opts.relatedMilestoneId;
				const payload = await client.createProjectRelation(input);
				if (!payload.success) throw new CliError("Failed to create project relation");
				const relation = await payload.projectRelation;
				outputSuccess({
					created: true,
					relation: relation
						? {
								id: relation.id,
								type: relation.type,
								anchorType: relation.anchorType,
								relatedAnchorType: relation.relatedAnchorType,
								project: project.name,
								relatedProject: related.name,
							}
						: null,
				});
			}),
		);

	relations
		.command("list <project>")
		.description("List dependency relations for a project (forward and inverse)")
		.option("--inverse", "Show inverse relations (projects that point at this one) instead of forward")
		.action(
			handleAsyncCommand(async (projectArg: string, opts: Record<string, string | boolean>) => {
				const client = await getClient();
				const project = await resolveProject(client, projectArg);
				const fullProject = await client.project(project.id);
				const connection = opts.inverse ? await fullProject.inverseRelations() : await fullProject.relations();
				const result = await Promise.all(
					connection.nodes.map(async (r) => {
						const related = await r.relatedProject;
						const source = await r.project;
						return {
							id: r.id,
							type: r.type,
							anchorType: r.anchorType,
							relatedAnchorType: r.relatedAnchorType,
							project: source ? { id: source.id, name: source.name } : null,
							relatedProject: related ? { id: related.id, name: related.name } : null,
						};
					}),
				);
				outputSuccess({
					relations: result,
					count: result.length,
					direction: opts.inverse ? "inverse" : "forward",
				});
			}),
		);

	relations
		.command("delete <relationId>")
		.description("Delete a project relation by its UUID (irreversible — requires --yes)")
		.option("--yes", "Confirm deletion")
		.action(
			handleAsyncCommand(async (relationId: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `delete project relation ${relationId}`);
				const client = await getClient();
				const payload = await client.deleteProjectRelation(relationId);
				outputSuccess({ deleted: payload.success });
			}),
		);
}
