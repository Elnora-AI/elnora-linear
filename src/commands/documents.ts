// `elnora-linear documents` — manage Linear documents.

import type { LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, parseLimit, requireNonEmptyUpdate, requireYes, resolveProject } from "../utils/index.js";

type DocumentCreateInput = Parameters<LinearClient["createDocument"]>[0];
type DocumentUpdateInput = Parameters<LinearClient["updateDocument"]>[1];

export function setupDocumentsCommand(program: Command): void {
	const docs = program.command("documents").description("Manage Linear documents");

	docs
		.command("list")
		.description("List documents")
		.option("--project <project>", "Filter by project")
		.option("--limit <n>", "Max results", "50")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const params: Record<string, unknown> = { first: parseLimit(opts.limit, 50) };
				if (opts.project) {
					const project = await resolveProject(client, opts.project);
					params.filter = { project: { id: { eq: project.id } } };
				}
				const result = await client.documents(params);
				const documents = result.nodes.map((d) => ({
					id: d.id,
					title: d.title,
					icon: d.icon ?? null,
					createdAt: d.createdAt,
					updatedAt: d.updatedAt,
				}));
				outputSuccess({ documents, count: documents.length });
			}),
		);

	docs
		.command("create")
		.description("Create a document")
		.requiredOption("--title <title>", "Document title")
		.option("--content <content>", "Markdown content")
		.option("--project <project>", "Attach to project")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const input: Partial<DocumentCreateInput> & { title: string } = { title: opts.title };
				if (opts.content) input.content = opts.content;
				if (opts.project) {
					const project = await resolveProject(client, opts.project);
					input.projectId = project.id;
				}
				const payload = await client.createDocument(input as DocumentCreateInput);
				if (!payload.success) throw new CliError("Failed to create document");
				const doc = await payload.document;
				outputSuccess({
					created: true,
					document: doc ? { id: doc.id, title: doc.title } : null,
				});
			}),
		);

	docs
		.command("get <id>")
		.description("Get document content")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const doc = await client.document(id);
				outputSuccess({
					id: doc.id,
					title: doc.title,
					content: doc.content ?? null,
					icon: doc.icon ?? null,
					createdAt: doc.createdAt,
					updatedAt: doc.updatedAt,
				});
			}),
		);

	docs
		.command("update <id>")
		.description("Update a document")
		.option("--title <title>", "New title")
		.option("--content <content>", "New content")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const update: Partial<DocumentUpdateInput> = {};
				if (opts.title) update.title = opts.title;
				if (opts.content) update.content = opts.content;
				requireNonEmptyUpdate(update as Record<string, unknown>);
				const payload = await client.updateDocument(id, update as DocumentUpdateInput);
				if (!payload.success) throw new CliError("Failed to update document");
				outputSuccess({ updated: true });
			}),
		);

	docs
		.command("delete <id>")
		.description("Delete a document (recoverable via restore — requires --yes)")
		.option("--yes", "Confirm deletion")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `delete document ${id}`);
				const client = await getClient();
				const payload = await client.deleteDocument(id);
				outputSuccess({ deleted: payload.success });
			}),
		);

	docs
		.command("restore <id>")
		.description("Restore a deleted document")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const payload = await client.unarchiveDocument(id);
				outputSuccess({ restored: payload.success });
			}),
		);
}
