// `elnora-linear attachments` — manage issue attachments + integration links.
//
// `upload` enforces a path safety check: --file must resolve (via realpathSync)
// under the configured upload root (default $LINEAR_UPLOAD_ROOT or cwd).
// Symlinks pointing out of the root are rejected. A prompt-injected agent
// cannot use `attachments upload` to exfiltrate ~/.ssh/id_rsa, ~/.aws/creds,
// etc.

import { readFileSync, realpathSync } from "node:fs";
import { sep as pathSep, resolve as resolvePath } from "node:path";
import type { Attachment, LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, findIssueByIdentifier, requireYes, ValidationError } from "../utils/index.js";

function resolveUploadPath(filePath: string, allowRoot: string | undefined): string {
	const root = resolvePath(allowRoot ?? process.env.LINEAR_UPLOAD_ROOT ?? process.cwd());
	const resolvedFile = resolvePath(filePath);
	let realFile: string;
	let realRoot: string;
	try {
		realFile = realpathSync(resolvedFile);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new CliError(`Cannot resolve file "${filePath}": ${msg}`, {
			suggestion: "Check that the file path is correct and you have read permission.",
		});
	}
	try {
		realRoot = realpathSync(root);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new CliError(`Upload root "${root}" does not exist: ${msg}`);
	}
	if (realFile !== realRoot && !realFile.startsWith(realRoot + pathSep)) {
		throw new ValidationError(
			`File "${filePath}" resolves to "${realFile}" which is outside the allowed upload root "${realRoot}".`,
			"Move the file under the allowed root, set LINEAR_UPLOAD_ROOT, or pass --allow-root <path>.",
		);
	}
	return realFile;
}

type AttachmentCreateInput = Parameters<LinearClient["createAttachment"]>[0];

export function setupAttachmentsCommand(program: Command): void {
	const attachments = program.command("attachments").description("Manage issue attachments");

	attachments
		.command("get <id>")
		.description("Get attachment details by ID")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const attachment = await client.attachment(id);
				outputSuccess({
					id: attachment.id,
					title: attachment.title ?? null,
					subtitle: attachment.subtitle ?? null,
					url: attachment.url,
					metadata: attachment.metadata ?? null,
					createdAt: attachment.createdAt,
				});
			}),
		);

	attachments
		.command("list <issueId>")
		.description("List attachments on an issue")
		.action(
			handleAsyncCommand(async (issueId: string) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const result = await issue.attachments();
				const items = result.nodes.map((a: Attachment) => ({
					id: a.id,
					title: a.title ?? null,
					subtitle: a.subtitle ?? null,
					url: a.url,
					createdAt: a.createdAt,
				}));
				outputSuccess({ attachments: items, count: items.length });
			}),
		);

	attachments
		.command("create <issueId>")
		.description("Create an attachment on an issue")
		.requiredOption("--url <url>", "Attachment URL")
		.requiredOption("--title <title>", "Attachment title")
		.option("--subtitle <subtitle>", "Attachment subtitle")
		.option("--icon <icon>", "Icon URL or emoji")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const input: AttachmentCreateInput = { issueId: issue.id, url: opts.url, title: opts.title };
				if (opts.subtitle) input.subtitle = opts.subtitle;
				if (opts.icon) input.iconUrl = opts.icon;
				const payload = await client.createAttachment(input);
				if (!payload.success) throw new CliError("Failed to create attachment");
				const attachment = await payload.attachment;
				outputSuccess({
					created: true,
					attachment: attachment ? { id: attachment.id, title: attachment.title, url: attachment.url } : null,
				});
			}),
		);

	attachments
		.command("upload <issueId>")
		.description("Upload a file as attachment. File must live under the allowed root (default: cwd).")
		.requiredOption("--file <path>", "Local file path (must be under allowed root)")
		.option("--filename <name>", "Filename (e.g., screenshot.png) — required")
		.option("--content-type <mime>", "MIME type (e.g., image/png) — required")
		.option("--title <title>", "Attachment title")
		.option("--allow-root <path>", "Override allowed upload root (default: $LINEAR_UPLOAD_ROOT or cwd)")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const filePath = resolveUploadPath(opts.file, opts.allowRoot);

				if (!opts.filename) throw new ValidationError("--filename is required.");
				if (!opts.contentType) throw new ValidationError("--content-type is required.");

				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);

				let fileContent: Buffer;
				try {
					fileContent = readFileSync(filePath);
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					throw new CliError(`Cannot read file "${opts.file}": ${msg}`, {
						suggestion: "Check that the file path is correct and you have read permission.",
					});
				}

				const uploadPayload = await client.fileUpload(opts.contentType, opts.filename, fileContent.length);
				if (!uploadPayload.success) throw new CliError("Failed to get upload URL");
				const uploadFile = uploadPayload.uploadFile;
				if (!uploadFile) throw new CliError("No upload URL returned");
				if (!uploadFile.uploadUrl.startsWith("https://")) {
					throw new CliError("Upload URL must use HTTPS");
				}
				const allowedHeaderKeys = new Set([
					"content-type",
					"content-disposition",
					"cache-control",
					"x-amz-acl",
					"x-goog-content-length-range",
					"x-goog-acl",
				]);
				const headers: Record<string, string> = { "Content-Type": opts.contentType };
				for (const header of uploadFile.headers) {
					if (allowedHeaderKeys.has(header.key.toLowerCase())) {
						headers[header.key] = header.value;
					}
				}
				const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
				if (fileContent.length > MAX_UPLOAD_SIZE) {
					throw new CliError(`File too large (${fileContent.length} bytes, max ${MAX_UPLOAD_SIZE})`);
				}
				const uploadBody = Uint8Array.from(fileContent);
				const response = await fetch(uploadFile.uploadUrl, {
					method: "PUT",
					headers,
					body: uploadBody,
				});
				if (!response.ok) throw new CliError(`Upload failed: ${response.statusText}`);
				const attachInput: AttachmentCreateInput = {
					issueId: issue.id,
					url: uploadFile.assetUrl,
					title: opts.title ?? opts.filename,
				};
				const attachPayload = await client.createAttachment(attachInput);
				if (!attachPayload.success) {
					throw new CliError("File was uploaded but could not be attached to the issue.", {
						suggestion: `The file is available at ${uploadFile.assetUrl}. Try creating the attachment manually.`,
					});
				}
				outputSuccess({ uploaded: true, url: uploadFile.assetUrl });
			}),
		);

	attachments
		.command("delete <id>")
		.description("Permanently delete an attachment (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				requireYes(opts, `permanently delete attachment ${id}`);
				const client = await getClient();
				const payload = await client.deleteAttachment(id);
				outputSuccess({ deleted: payload.success });
			}),
		);

	async function outputLinkResult(
		payload: Awaited<ReturnType<LinearClient["attachmentLinkURL"]>>,
		integration: string,
	): Promise<void> {
		if (!payload.success) throw new CliError(`Failed to link ${integration} attachment`);
		const attachment = await payload.attachment;
		outputSuccess({
			linked: true,
			integration,
			attachment: attachment ? { id: attachment.id, title: attachment.title, url: attachment.url } : null,
		});
	}

	attachments
		.command("link-github-pr <issueId>")
		.description("Link a GitHub pull request as an integration-aware attachment")
		.requiredOption("--url <url>", "GitHub pull request URL")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const payload = await client.attachmentLinkGitHubPR(issue.id, opts.url);
				await outputLinkResult(payload, "github-pr");
			}),
		);

	attachments
		.command("link-slack <issueId>")
		.description("Link a Slack message as an integration-aware attachment")
		.requiredOption("--url <url>", "Slack permalink (https://*.slack.com/archives/...)")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const payload = await client.attachmentLinkSlack(issue.id, opts.url);
				await outputLinkResult(payload, "slack");
			}),
		);

	attachments
		.command("link-jira <issueId>")
		.description("Link a Jira issue as an integration-aware attachment")
		.requiredOption("--jira-issue-id <id>", "Jira issue ID")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const payload = await client.attachmentLinkJiraIssue(issue.id, opts.jiraIssueId);
				await outputLinkResult(payload, "jira");
			}),
		);

	attachments
		.command("link-url <issueId>")
		.description("Link an arbitrary URL as an integration-aware attachment (dedup on issueId+url)")
		.requiredOption("--url <url>", "URL to link")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const payload = await client.attachmentLinkURL(issue.id, opts.url);
				await outputLinkResult(payload, "url");
			}),
		);

	attachments
		.command("link-discord <issueId>")
		.description("Link a Discord message as an integration-aware attachment")
		.requiredOption("--channel-id <id>", "Discord channel ID")
		.requiredOption("--message-id <id>", "Discord message ID")
		.requiredOption("--url <url>", "Discord message URL")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const payload = await client.attachmentLinkDiscord(opts.channelId, issue.id, opts.messageId, opts.url);
				await outputLinkResult(payload, "discord");
			}),
		);

	attachments
		.command("link-zendesk <issueId>")
		.description("Link a Zendesk ticket as an integration-aware attachment")
		.requiredOption("--ticket-id <id>", "Zendesk ticket ID")
		.action(
			handleAsyncCommand(async (issueId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, issueId);
				const payload = await client.attachmentLinkZendesk(issue.id, opts.ticketId);
				await outputLinkResult(payload, "zendesk");
			}),
		);
}
