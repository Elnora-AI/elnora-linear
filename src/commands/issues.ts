// `elnora-linear issues` — the primary command group; covers ~80% of agent usage.
//
// The bulk-ops machinery batches heterogeneous mutations (create / update /
// relate / comment / label-add / label-remove / archive) into aliased GraphQL
// documents — 100 ops execute as ~10 HTTP requests instead of 100. All name
// lookups (state, label, project, team, assignee) happen once upfront, not per
// op. State-name resolution honours each op's own team prefix (ELN-N → ELN) so
// `--team ELN` on a SEC-5 update doesn't silently corrupt SEC's "Done" state.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Issue, IssueSearchResult, LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import {
	batchMutations,
	bulkGetIssue,
	bulkListIssues,
	bulkSearchIssues,
	formatBulkIssue,
	getLastRateLimit,
	type MutationOp,
	resolveIssueIds,
	resolveStateId,
} from "../lib/bulk-graphql.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import {
	CliError,
	fetchAllNodes,
	findIssueByIdentifier,
	getTeamLabelPolicy,
	LabelValidationError,
	NotFoundError,
	parseDate,
	parseIssueIdentifier,
	parseLimit,
	parsePositiveInt,
	parsePriority,
	requireNonEmptyUpdate,
	requireYes,
	resolveLabels,
	resolveProject,
	resolveState,
	resolveTeam,
	resolveUser,
	ValidationError,
	validateLabelsAgainstTeam,
} from "../utils/index.js";

function printRateLimitStats(prefix: string): void {
	const r = getLastRateLimit();
	if (r.remaining === undefined || r.limit === undefined) return;
	const pct = ((r.remaining / r.limit) * 100).toFixed(1);
	process.stderr.write(
		`${prefix}: ${r.remaining}/${r.limit} req remaining (${pct}% headroom)${
			r.resetSeconds !== undefined ? `, resets in ${r.resetSeconds}s` : ""
		}\n`,
	);
}

type IssueCreateInput = Parameters<LinearClient["createIssue"]>[0];
type IssueUpdateInput = Parameters<LinearClient["updateIssue"]>[1];

/**
 * Pick the team key that scopes a bulk-ops op for state-id resolution.
 *
 * Precedence:
 *   1. Explicit op.team (must resolve in teamMap).
 *   2. For update ops, derive from the issue id prefix (e.g. SEC-5 → SEC).
 *   3. Fall back to the run-level --team default.
 *
 * Rule 2 is the cross-team-state safeguard: without it, an update on SEC-5
 * with --team ELN would look up "Done" against ELN and apply ELN's UUID to
 * a SEC issue (silent corruption when both teams have a state of that name).
 */
export function resolveBulkOpTeamKey(
	op: Record<string, unknown>,
	teamMap: Record<string, { id: string; key: string }>,
	defaultTeamKey: string,
): string {
	if (typeof op.team === "string") {
		return teamMap[op.team]?.key ?? defaultTeamKey;
	}
	if (op.kind === "update" && typeof op.id === "string") {
		const m = op.id.match(/^([A-Z]+)-\d+$/);
		if (m) return m[1];
	}
	return defaultTeamKey;
}

async function enforceTeamLabelPolicy(opts: {
	client: LinearClient;
	teamKey: string;
	teamId: string;
	teamName: string;
	finalLabelNames: string[];
	skip?: boolean;
	retryCommand?: string;
}): Promise<void> {
	if (opts.skip) return;
	const policy = getTeamLabelPolicy(opts.teamKey);
	if (!policy) return;

	const [teamScoped, workspaceScoped] = await Promise.all([
		opts.client.issueLabels({
			first: 250,
			filter: { team: { id: { eq: opts.teamId } } },
		}),
		opts.client.issueLabels({
			first: 250,
			filter: { team: { null: true } },
		}),
	]);
	const catalog = [...teamScoped.nodes.map((l) => l.name), ...workspaceScoped.nodes.map((l) => l.name)];

	const result = validateLabelsAgainstTeam(opts.teamKey, opts.finalLabelNames, catalog);
	if (result.valid) return;

	const missing = result.failures
		.filter((f) => f.reason === "missing")
		.map((f) => ({
			prefixes: f.group.prefixes,
			min: f.group.min,
			description: f.group.description,
		}));
	const excess = result.failures
		.filter((f) => f.reason === "excess")
		.map((f) => ({
			prefixes: f.group.prefixes,
			max: f.group.max as number,
			passed: f.group.prefixes.flatMap((p) => opts.finalLabelNames.filter((n) => n.startsWith(p))),
		}));

	throw new LabelValidationError({
		error: "labels_invalid",
		team: opts.teamName,
		teamKey: opts.teamKey,
		missing,
		excess,
		passed: opts.finalLabelNames,
		availableForPrefix: result.availableForPrefix,
		suggestedRetry: opts.retryCommand ?? "",
	});
}

export function setupIssuesCommand(program: Command): void {
	const issues = program.command("issues").description("Manage Linear issues");

	issues
		.command("list")
		.description("List issues with optional filters")
		.option("--team <team>", "Filter by team name or key")
		.option("--project <project>", "Filter by project name")
		.option("--assignee <assignee>", "Filter by assignee (name, email, or 'me')")
		.option("--state <state>", "Filter by state name")
		.option("--label <label>", "Filter by label name")
		.option("--limit <n>", "Max results", "50")
		.option("--query <query>", "Search query")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const client = await getClient();
				const filter: Record<string, unknown> = {};

				const [teamResult, projectResult, assigneeResult, labelResult] = await Promise.all([
					opts.team ? resolveTeam(client, opts.team) : undefined,
					opts.project ? resolveProject(client, opts.project) : undefined,
					opts.assignee ? resolveUser(client, opts.assignee) : undefined,
					opts.label ? resolveLabels(client, opts.label) : undefined,
				]);

				if (teamResult) filter.team = { id: { eq: teamResult.id } };
				if (projectResult) filter.project = { id: { eq: projectResult.id } };
				if (assigneeResult) filter.assignee = { id: { eq: assigneeResult.id } };
				if (labelResult) filter.labels = { some: { id: { in: labelResult.map((l) => l.id) } } };

				if (opts.state) {
					if (teamResult) {
						const state = await resolveState(client, opts.state, teamResult.id);
						filter.state = { id: { eq: state.id } };
					} else {
						const allStates = await client.workflowStates({ first: 250 });
						const matches = allStates.nodes.filter((s) => s.name.toLowerCase() === opts.state.toLowerCase());
						if (matches.length === 0) throw new NotFoundError("State", opts.state);
						filter.state = { id: { in: matches.map((s) => s.id) } };
					}
				}

				const limit = parseLimit(opts.limit);
				if (opts.query) {
					const orFilter = {
						or: [{ title: { containsIgnoreCase: opts.query } }, { description: { containsIgnoreCase: opts.query } }],
					};
					const combinedFilter = Object.keys(filter).length ? { and: [filter, orFilter] } : orFilter;
					const nodes = await bulkListIssues(combinedFilter, { max: limit });
					outputSuccess({ issues: nodes.map((n) => formatBulkIssue(n)), count: nodes.length });
					return;
				}

				const nodes = await bulkListIssues(filter, { max: limit });
				outputSuccess({ issues: nodes.map((n) => formatBulkIssue(n)), count: nodes.length });
			}),
		);

	issues
		.command("search <query>")
		.description("Search issues by text")
		.option("--team <team>", "Filter by team")
		.option("--limit <n>", "Max results", "25")
		.action(
			handleAsyncCommand(async (query: string, opts: Record<string, string>) => {
				const limit = parseLimit(opts.limit, 25);
				let teamKey: string | undefined = opts.team;
				if (teamKey && !/^[A-Z]+$/.test(teamKey)) {
					const client = await getClient();
					const t = await resolveTeam(client, teamKey);
					teamKey = t.key;
				}
				const nodes = await bulkSearchIssues(query, { first: limit, teamKey });
				outputSuccess({
					issues: nodes.map((n) => formatBulkIssue(n)),
					count: nodes.length,
					query,
				});
			}),
		);

	issues
		.command("create <title>")
		.description("Create a new issue")
		.requiredOption("--team <team>", "Team name or key")
		.option("-d, --description <desc>", "Issue description (markdown)")
		.option("-a, --assignee <assignee>", "Assignee (name, email, or 'me')")
		.option("-p, --priority <priority>", "Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low")
		.option("--project <project>", "Project name")
		.option("--labels <labels>", "Comma-separated label names")
		.option("--state <state>", "Workflow state name")
		.option("--due-date <date>", "Due date (YYYY-MM-DD)")
		.option("--parent <parent>", "Parent issue ID (e.g., ELN-123)")
		.option("--skip-label-check", "Bypass team label-policy validation (use only when intentionally violating policy)")
		.action(
			handleAsyncCommand(async (title: string, opts: Record<string, string>) => {
				const client = await getClient();

				const [teamResult, userResult, projectResult, labelResults, parentIssue] = await Promise.all([
					resolveTeam(client, opts.team),
					opts.assignee ? resolveUser(client, opts.assignee) : undefined,
					opts.project ? resolveProject(client, opts.project) : undefined,
					opts.labels ? resolveLabels(client, opts.labels) : undefined,
					opts.parent ? findIssueByIdentifier(client, parseIssueIdentifier(opts.parent)) : undefined,
				]);

				const passedLabels = labelResults?.map((l) => l.name) ?? [];
				const shellQuote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
				await enforceTeamLabelPolicy({
					client,
					teamKey: teamResult.key,
					teamId: teamResult.id,
					teamName: teamResult.name,
					finalLabelNames: passedLabels,
					skip: Boolean(opts.skipLabelCheck),
					retryCommand:
						`elnora-linear issues create ${shellQuote(title)} --team ${shellQuote(teamResult.name)}` +
						(opts.project ? ` --project ${shellQuote(opts.project)}` : "") +
						' --labels "<add required labels per team policy>"' +
						(opts.priority ? ` --priority ${opts.priority}` : "") +
						(opts.assignee ? ` --assignee ${shellQuote(opts.assignee)}` : ""),
				});

				const input: IssueCreateInput = { teamId: teamResult.id, title };

				if (opts.description) input.description = opts.description;
				if (opts.priority) {
					const priority = parsePriority(opts.priority);
					if (priority !== undefined) input.priority = priority;
				}
				if (opts.dueDate) input.dueDate = parseDate(opts.dueDate);
				if (userResult) input.assigneeId = userResult.id;
				if (projectResult) input.projectId = projectResult.id;
				if (labelResults) input.labelIds = labelResults.map((l) => l.id);
				if (parentIssue) input.parentId = parentIssue.id;

				let resolvedStateName: string | null = null;
				if (opts.state) {
					const state = await resolveState(client, opts.state, teamResult.id);
					input.stateId = state.id;
					resolvedStateName = state.name;
				}

				const payload = await client.createIssue(input);
				if (!payload.success) throw new CliError("Failed to create issue");
				const issue = await payload.issue;
				if (!issue) {
					outputSuccess({ created: true });
					return;
				}
				let formatted: Record<string, unknown>;
				if (resolvedStateName) {
					formatted = {
						identifier: issue.identifier,
						title,
						state: resolvedStateName,
						priority: opts.priority ? parsePriority(opts.priority) : 0,
						assignee: userResult?.name ?? null,
						team: teamResult.name,
						project: projectResult?.name ?? null,
						labels: labelResults?.map((l) => l.name) ?? [],
						dueDate: input.dueDate ?? null,
						url: issue.url,
					};
				} else {
					formatted = await formatIssue(issue);
				}
				outputSuccess({ created: true, issue: formatted });
			}),
		);

	issues
		.command("get <id>")
		.description("Get issue details by ID (e.g., ELN-123 or UUID)")
		.option("--with-comments", "Also return up to 50 most recent comments on the issue")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				if (/^[A-Z]+-\d+$/.test(id) && !opts.withComments) {
					const node = await bulkGetIssue(id);
					if (!node) throw new NotFoundError("Issue", id);
					outputSuccess(formatBulkIssue(node, true));
					return;
				}
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, id);
				const formatted = (await formatIssue(issue, true)) as Record<string, unknown>;

				if (opts.withComments) {
					const conn = await issue.comments({ first: 50 });
					const comments = await Promise.all(
						(conn?.nodes ?? []).map(async (c) => {
							const user = await c.user;
							return {
								id: c.id,
								user: user?.name ?? null,
								body: c.body,
								createdAt: c.createdAt,
							};
						}),
					);
					formatted.comments = comments;
				}

				outputSuccess(formatted);
			}),
		);

	issues
		.command("update <id>")
		.description("Update an existing issue")
		.option("--title <title>", "New title")
		.option("-d, --description <desc>", "New description (markdown)")
		.option("--state <state>", "New state name")
		.option("-a, --assignee <assignee>", "New assignee (name, email, 'me', or 'none')")
		.option("-p, --priority <priority>", "New priority: 0-4")
		.option("--labels <labels>", "Comma-separated label names (replaces existing)")
		.option("--project <project>", "Move to project")
		.option("--due-date <date>", "Due date (YYYY-MM-DD)")
		.option("--team <team>", "Move to different team")
		.option("--skip-label-check", "Bypass team label-policy validation (use only when intentionally violating policy)")
		.option("--with-issue", "Return the full updated issue body (default: just identifier + confirmation)")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string>) => {
				const client = await getClient();
				const withIssue = Boolean((opts as Record<string, unknown>).withIssue);
				const issue = await findIssueByIdentifier(client, id);
				const update: Partial<IssueUpdateInput> = {};

				if (opts.title) update.title = opts.title;
				if (opts.description) update.description = opts.description;
				if (opts.priority) {
					const priority = parsePriority(opts.priority);
					if (priority !== undefined) update.priority = priority;
				}
				if (opts.dueDate) update.dueDate = parseDate(opts.dueDate);

				const [userResult, labelResults, projectResult, teamResult] = await Promise.all([
					opts.assignee && opts.assignee.toLowerCase() !== "none" ? resolveUser(client, opts.assignee) : undefined,
					opts.labels ? resolveLabels(client, opts.labels) : undefined,
					opts.project ? resolveProject(client, opts.project) : undefined,
					opts.team ? resolveTeam(client, opts.team) : undefined,
				]);

				if (opts.assignee) {
					update.assigneeId = opts.assignee.toLowerCase() === "none" ? null : (userResult?.id as string);
				}
				if (labelResults) update.labelIds = labelResults.map((l) => l.id);
				if (projectResult) update.projectId = projectResult.id;
				if (teamResult) update.teamId = teamResult.id;

				if (labelResults || teamResult) {
					const effectiveTeam = teamResult ?? (await issue.team);
					if (effectiveTeam) {
						const finalLabels = labelResults
							? labelResults.map((l) => l.name)
							: (await issue.labels()).nodes.map((l) => l.name);
						await enforceTeamLabelPolicy({
							client,
							teamKey: effectiveTeam.key,
							teamId: effectiveTeam.id,
							teamName: effectiveTeam.name,
							finalLabelNames: finalLabels,
							skip: Boolean((opts as Record<string, unknown>).skipLabelCheck),
							retryCommand: `elnora-linear issues update ${issue.identifier} --labels "<full final label set per team policy>"`,
						});
					}
				}

				if (opts.state) {
					const teamObj = teamResult ?? (await issue.team);
					if (teamObj) {
						const state = await resolveState(client, opts.state, teamObj.id);
						update.stateId = state.id;
					} else {
						throw new CliError(`Cannot resolve state "${opts.state}": issue has no team. Use --team to specify.`);
					}
				}

				requireNonEmptyUpdate(update as Record<string, unknown>);

				const payload = await client.updateIssue(issue.id, update as IssueUpdateInput);
				if (!payload.success) throw new CliError("Failed to update issue");

				if (withIssue) {
					const refreshed = await bulkGetIssue(issue.identifier);
					outputSuccess({
						updated: true,
						issue: refreshed ? formatBulkIssue(refreshed, true) : { identifier: issue.identifier },
					});
				} else {
					outputSuccess({ updated: true, identifier: issue.identifier });
				}
			}),
		);

	issues
		.command("delete <id>")
		.description("Archive an issue (recoverable). Use --permanent --yes for irreversible delete.")
		.option("--permanent", "Permanently delete (irreversible — requires --yes)")
		.option("--yes", "Confirm permanent deletion")
		.action(
			handleAsyncCommand(async (id: string, opts: Record<string, string | boolean>) => {
				if (opts.permanent) {
					requireYes(opts, `permanently delete issue ${id}`);
				}
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, id);
				if (opts.permanent) {
					const payload = await client.deleteIssue(issue.id);
					outputSuccess({ deleted: payload.success, id: issue.identifier, permanent: true });
				} else {
					const payload = await client.archiveIssue(issue.id);
					outputSuccess({ archived: payload.success, id: issue.identifier });
				}
			}),
		);

	issues
		.command("restore <id>")
		.description("Restore an archived issue")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, id);
				const payload = await client.unarchiveIssue(issue.id);
				outputSuccess({ restored: payload.success, id: issue.identifier });
			}),
		);

	issues
		.command("subscribe <id>")
		.description("Subscribe to issue updates")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, id);
				const payload = await client.issueSubscribe(issue.id);
				if (!payload.success) throw new CliError("Failed to subscribe");
				outputSuccess({ subscribed: true, id: issue.identifier });
			}),
		);

	issues
		.command("unsubscribe <id>")
		.description("Unsubscribe from issue updates")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const issue = await findIssueByIdentifier(client, id);
				const payload = await client.issueUnsubscribe(issue.id);
				if (!payload.success) throw new CliError("Failed to unsubscribe");
				outputSuccess({ unsubscribed: true, id: issue.identifier });
			}),
		);

	issues
		.command("add-label <id> <label>")
		.description("Add a single label without disturbing siblings (atomic)")
		.option("--skip-label-check", "Bypass team label-policy validation (use only when intentionally violating policy)")
		.action(
			handleAsyncCommand(async (id: string, label: string, opts: Record<string, string | boolean>) => {
				if (label.includes(",")) {
					throw new ValidationError(
						'add-label takes a single label. Use `issues update <id> --labels "a,b,c"` for multi-label edits.',
					);
				}
				const client = await getClient();
				const [issue, labels] = await Promise.all([findIssueByIdentifier(client, id), resolveLabels(client, label)]);
				const team = await issue.team;
				if (team) {
					const currentLabelNames = (await issue.labels()).nodes.map((l) => l.name);
					const finalLabels = currentLabelNames.includes(labels[0].name)
						? currentLabelNames
						: [...currentLabelNames, labels[0].name];
					await enforceTeamLabelPolicy({
						client,
						teamKey: team.key,
						teamId: team.id,
						teamName: team.name,
						finalLabelNames: finalLabels,
						skip: Boolean(opts.skipLabelCheck),
						retryCommand: `elnora-linear issues add-label ${issue.identifier} "${labels[0].name}"`,
					});
				}
				const payload = await client.issueAddLabel(issue.id, labels[0].id);
				if (!payload.success) throw new CliError("Failed to add label");
				outputSuccess({ added: true, id: issue.identifier, label: labels[0].name });
			}),
		);

	issues
		.command("remove-label <id> <label>")
		.description("Remove a single label without disturbing siblings (atomic)")
		.option("--skip-label-check", "Bypass team label-policy validation (use only when intentionally violating policy)")
		.action(
			handleAsyncCommand(async (id: string, label: string, opts: Record<string, string | boolean>) => {
				if (label.includes(",")) {
					throw new ValidationError(
						'remove-label takes a single label. Use `issues update <id> --labels "a,b,c"` to set the full label set.',
					);
				}
				const client = await getClient();
				const [issue, labels] = await Promise.all([findIssueByIdentifier(client, id), resolveLabels(client, label)]);
				const team = await issue.team;
				if (team) {
					const currentLabelNames = (await issue.labels()).nodes.map((l) => l.name);
					const finalLabels = currentLabelNames.filter((n) => n !== labels[0].name);
					await enforceTeamLabelPolicy({
						client,
						teamKey: team.key,
						teamId: team.id,
						teamName: team.name,
						finalLabelNames: finalLabels,
						skip: Boolean(opts.skipLabelCheck),
						retryCommand: `elnora-linear issues update ${issue.identifier} --labels "<full final set>"`,
					});
				}
				const payload = await client.issueRemoveLabel(issue.id, labels[0].id);
				if (!payload.success) throw new CliError("Failed to remove label");
				outputSuccess({ removed: true, id: issue.identifier, label: labels[0].name });
			}),
		);

	issues
		.command("batch-create <jsonFile>")
		.description("Create multiple issues from a JSON array file (or '-' for stdin). Cap 50. N>=10 requires --yes.")
		.option("--yes", "Confirm batch creation when N >= 10")
		.action(
			handleAsyncCommand(async (jsonFile: string, opts: Record<string, string | boolean>) => {
				const inputs = readBatchInput(jsonFile);
				if (inputs.length === 0) throw new ValidationError("Batch input is empty.");
				if (inputs.length > 50) {
					throw new ValidationError(`Batch too large (${inputs.length}). Linear API caps batches at 50.`);
				}
				if (inputs.length >= 10 && !opts.yes) {
					throw new ValidationError(
						`Refusing to create ${inputs.length} issues without --yes.`,
						"Re-run with --yes to confirm.",
					);
				}
				const client = await getClient();
				const payload = await client.createIssueBatch({ issues: inputs });
				if (!payload.success) throw new CliError("Failed to create issue batch");
				const issues = await payload.issues;
				outputSuccess({
					created: issues?.length ?? inputs.length,
					ids: issues?.map((i: { identifier: string }) => i.identifier) ?? [],
				});
			}),
		);

	issues
		.command("batch-update <ids> <jsonPatchFile>")
		.description(
			"Apply the same update to multiple issues. <ids> = comma-separated ELN-X or UUIDs. <jsonPatchFile> = path to JSON IssueUpdateInput (or '-' for stdin).",
		)
		.option("--yes", "Confirm batch update when N >= 10")
		.action(
			handleAsyncCommand(async (ids: string, jsonPatchFile: string, opts: Record<string, string | boolean>) => {
				const idList = ids
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				if (idList.length === 0) throw new ValidationError("No issue IDs provided.");
				if (idList.length > 50) {
					throw new ValidationError(`Batch too large (${idList.length}). Linear API caps batches at 50.`);
				}
				if (idList.length >= 10 && !opts.yes) {
					throw new ValidationError(
						`Refusing to update ${idList.length} issues without --yes.`,
						"Re-run with --yes to confirm.",
					);
				}
				const patch = readBatchPatch(jsonPatchFile);
				const client = await getClient();
				const uuids = await Promise.all(idList.map(async (id) => (await findIssueByIdentifier(client, id)).id));
				const payload = await client.updateIssueBatch(uuids, patch);
				if (!payload.success) throw new CliError("Failed to update issue batch");
				outputSuccess({ updated: idList.length, ids: idList });
			}),
		);

	issues
		.command("bulk-list")
		.description(
			"Bulk-fetch issues with all relations in one GraphQL call. Designed for agent workflows that scan large slices of the workspace without exhausting the rate limit.",
		)
		.option("--team <team>", "Team key (e.g. ELN)")
		.option("--state-type <type>", "Filter by state type: backlog|unstarted|started|completed|canceled")
		.option("--state <name>", "Filter by state name (within --team)")
		.option("--project <id>", "Filter by project UUID")
		.option("--max <n>", "Cap total results (default: unlimited, fetches all pages)")
		.option("--page-size <n>", "Issues per page (default 250, Linear's max)")
		.option("--with-description", "Include issue descriptions (default: omitted to keep payloads small)")
		.option("--with-relations", "Include children and relations (default: omitted)")
		.option("--stats", "Print rate-limit budget summary to stderr after the run")
		.action(
			handleAsyncCommand(async (opts: Record<string, string>) => {
				const filter: Record<string, unknown> = {};
				if (opts.team) filter.team = { key: { eq: opts.team } };
				if (opts.stateType) filter.state = { type: { eq: opts.stateType } };
				if (opts.state && opts.team) {
					const stateId = await resolveStateId(opts.team, opts.state);
					if (!stateId) throw new NotFoundError("State", opts.state);
					filter.state = { id: { eq: stateId } };
				}
				if (opts.project) filter.project = { id: { eq: opts.project } };
				const max = parsePositiveInt(opts.max, "--max");
				const pageSize = parseLimit(opts.pageSize, 250, "--page-size");
				const flags = opts as Record<string, unknown>;
				const includeDescription = Boolean(flags.withDescription);
				const includeRelations = Boolean(flags.withRelations);
				const nodes = await bulkListIssues(filter, { pageSize, max, includeDescription, includeRelations });
				outputSuccess({
					issues: nodes.map((n) => {
						const row: Record<string, unknown> = {
							identifier: n.identifier,
							title: n.title,
							state: n.state?.name ?? null,
							stateType: n.state?.type ?? null,
							priority: n.priority,
							assignee: n.assignee?.name ?? null,
							team: n.team?.name ?? null,
							project: n.project?.name ?? null,
							labels: n.labels.nodes.map((l) => l.name),
							parent: n.parent?.identifier ?? null,
							url: n.url,
						};
						if (includeDescription) row.description = n.description;
						if (includeRelations) {
							row.children = n.children.nodes.map((c) => c.identifier);
							row.relations = n.relations.nodes.map((r) => ({
								type: r.type,
								with: r.relatedIssue?.identifier ?? null,
							}));
							row.updatedAt = n.updatedAt;
							row.createdAt = n.createdAt;
						}
						return row;
					}),
					count: nodes.length,
				});
				if (flags.stats) printRateLimitStats("bulk-list");
			}),
		);

	issues
		.command("bulk-ops <opsFile>")
		.description(
			"Execute a JSON file of bulk operations as batched GraphQL mutations. Ops: create | update | relate | comment | label-add | label-remove | archive. Pass '-' to read from stdin.",
		)
		.requiredOption("--team <team>", "Team key for state-name resolution (e.g. ENG)")
		.option("--batch-size <n>", "Mutations per HTTP request (default 10)", "10")
		.option("--dry-run", "Print the resolved op plan and exit without writing")
		.option("--yes", "Confirm when ops count >= 25")
		.option("--stats", "Print rate-limit budget summary to stderr after the run")
		.action(
			handleAsyncCommand(async (opsFile: string, opts: Record<string, string | boolean>) => {
				const raw = readJsonSource(opsFile);
				let ops: unknown;
				try {
					ops = JSON.parse(raw);
				} catch (e) {
					throw new ValidationError(`Invalid JSON in ops file: ${e instanceof Error ? e.message : String(e)}`);
				}
				if (!Array.isArray(ops)) throw new ValidationError("Ops file must be a JSON array.");
				const opsList = ops as Array<Record<string, unknown>>;
				if (opsList.length === 0) {
					outputSuccess({ executed: 0, results: [] });
					return;
				}
				if (opsList.length >= 25 && !opts.yes && !opts.dryRun) {
					throw new ValidationError(
						`Refusing to apply ${opsList.length} ops without --yes.`,
						"Re-run with --yes to confirm, or --dry-run to inspect the resolved plan.",
					);
				}

				const idSet = new Set<string>();
				const stateNames = new Set<string>();
				const labelNames = new Set<string>();
				const projectNames = new Set<string>();
				const teamNames = new Set<string>();
				const assigneeNames = new Set<string>();
				for (const op of opsList) {
					for (const k of ["id", "from", "to", "parent", "issue"] as const) {
						const v = op[k];
						if (typeof v === "string" && /^[A-Z]+-\d+$/.test(v)) idSet.add(v);
					}
					if (typeof op.state === "string") stateNames.add(op.state);
					if (typeof op.label === "string") labelNames.add(op.label);
					if (Array.isArray(op.labels)) {
						for (const l of op.labels) if (typeof l === "string") labelNames.add(l);
					}
					if (typeof op.project === "string") projectNames.add(op.project);
					if (typeof op.team === "string") teamNames.add(op.team);
					if (typeof op.assignee === "string") assigneeNames.add(op.assignee);
				}
				const defaultTeamKey = String(opts.team);
				teamNames.add(defaultTeamKey);
				const client = await getClient();
				const [idMap, labelMap, projectMap, teamMap, assigneeMap] = await Promise.all([
					resolveIssueIds([...idSet]),
					(async () => {
						const out: Record<string, string> = {};
						if (labelNames.size === 0) return out;
						const conn = await client.issueLabels({ first: 250 });
						const all = await fetchAllNodes(conn);
						for (const l of all) {
							if (labelNames.has(l.name)) out[l.name] = l.id;
						}
						return out;
					})(),
					(async () => {
						const out: Record<string, string> = {};
						if (projectNames.size === 0) return out;
						const conn = await client.projects({ first: 250 });
						const all = await fetchAllNodes(conn);
						for (const p of all) {
							if (projectNames.has(p.name)) out[p.name] = p.id;
						}
						return out;
					})(),
					(async () => {
						const out: Record<string, { id: string; key: string }> = {};
						if (teamNames.size === 0) return out;
						const conn = await client.teams({ first: 100 });
						const all = await fetchAllNodes(conn);
						for (const t of all) {
							if (teamNames.has(t.name) || teamNames.has(t.key)) {
								out[t.name] = { id: t.id, key: t.key };
								out[t.key] = { id: t.id, key: t.key };
							}
						}
						return out;
					})(),
					(async () => {
						const out: Record<string, string> = {};
						if (assigneeNames.size === 0) return out;
						const conn = await client.users({ first: 250 });
						const all = await fetchAllNodes(conn);
						for (const u of all) {
							if (assigneeNames.has(u.name) || assigneeNames.has(u.email)) {
								if (assigneeNames.has(u.name)) out[u.name] = u.id;
								if (assigneeNames.has(u.email)) out[u.email] = u.id;
							}
						}
						return out;
					})(),
				]);
				const stateMap: Record<string, string> = {};
				const stateLookupTasks: Array<Promise<void>> = [];
				const stateRequests = new Set<string>();
				for (const op of opsList) {
					if (typeof op.state !== "string") continue;
					const teamKey = resolveBulkOpTeamKey(op, teamMap, defaultTeamKey);
					const key = `${teamKey}:${op.state}`;
					if (stateRequests.has(key)) continue;
					stateRequests.add(key);
					stateLookupTasks.push(
						(async () => {
							const id = await resolveStateId(teamKey, op.state as string);
							if (id) stateMap[key] = id;
						})(),
					);
				}
				await Promise.all(stateLookupTasks);

				const missingIds = [...idSet].filter((i) => !idMap[i]);
				if (missingIds.length > 0) throw new NotFoundError("Issues", missingIds.join(", "));
				const missingLabels = [...labelNames].filter((n) => !labelMap[n]);
				if (missingLabels.length > 0) throw new NotFoundError("Labels", missingLabels.join(", "));
				const missingProjects = [...projectNames].filter((n) => !projectMap[n]);
				if (missingProjects.length > 0) throw new NotFoundError("Projects", missingProjects.join(", "));
				const missingTeams = [...teamNames].filter((n) => !teamMap[n]);
				if (missingTeams.length > 0) throw new NotFoundError("Teams", missingTeams.join(", "));
				const missingAssignees = [...assigneeNames].filter((n) => !assigneeMap[n]);
				if (missingAssignees.length > 0) throw new NotFoundError("Users", missingAssignees.join(", "));
				const missingStates = [...stateRequests].filter((k) => !stateMap[k]);
				if (missingStates.length > 0) throw new NotFoundError("States", missingStates.join(", "));

				const mutations: MutationOp[] = [];
				const plan: Array<Record<string, unknown>> = [];
				for (let i = 0; i < opsList.length; i++) {
					const op = opsList[i];
					const kind = op.kind;
					if (kind === "create") {
						if (typeof op.title !== "string") throw new ValidationError(`Op #${i}: create requires title`);
						const teamSpec = (op.team as string | undefined) ?? defaultTeamKey;
						const team = teamMap[teamSpec];
						if (!team) throw new ValidationError(`Op #${i}: unknown team ${teamSpec}`);
						const input: Record<string, unknown> = { title: op.title, teamId: team.id };
						if (typeof op.description === "string") input.description = op.description;
						if (typeof op.priority === "number") input.priority = op.priority;
						if (typeof op.dueDate === "string") input.dueDate = op.dueDate;
						if (typeof op.project === "string") input.projectId = projectMap[op.project];
						if (Array.isArray(op.labels)) {
							input.labelIds = (op.labels as string[]).map((l) => labelMap[l]);
						}
						if (typeof op.state === "string") {
							input.stateId = stateMap[`${team.key}:${op.state}`];
						}
						if (typeof op.parent === "string") input.parentId = idMap[op.parent];
						if (typeof op.assignee === "string") input.assigneeId = assigneeMap[op.assignee];
						mutations.push({
							alias: `op${i}`,
							field: "issueCreate",
							vars: { input: { type: "IssueCreateInput!", value: input } },
							selection: "success issue { identifier }",
						});
						plan.push({ alias: `op${i}`, kind: "create", title: op.title, input });
					} else if (kind === "update") {
						const input: Record<string, unknown> = {};
						if (typeof op.state === "string") {
							const teamKey = resolveBulkOpTeamKey(op, teamMap, defaultTeamKey);
							input.stateId = stateMap[`${teamKey}:${op.state}`];
						}
						if (typeof op.parent === "string") input.parentId = idMap[op.parent];
						if (op.parent === null) input.parentId = null;
						if (typeof op.description === "string") input.description = op.description;
						if (typeof op.priority === "number") input.priority = op.priority;
						const id = idMap[op.id as string];
						if (!id) throw new ValidationError(`Op #${i}: unknown issue ${op.id}`);
						mutations.push({
							alias: `op${i}`,
							field: "issueUpdate",
							vars: {
								id: { type: "String!", value: id },
								input: { type: "IssueUpdateInput!", value: input },
							},
							selection: "success issue { identifier }",
						});
						plan.push({ alias: `op${i}`, kind: "update", id: op.id, input });
					} else if (kind === "relate") {
						const fromId = idMap[op.from as string];
						const toId = idMap[op.to as string];
						const rtype = (op.type as string) || "related";
						if (!fromId || !toId) throw new ValidationError(`Op #${i}: unknown issue in relate`);
						mutations.push({
							alias: `op${i}`,
							field: "issueRelationCreate",
							vars: {
								input: {
									type: "IssueRelationCreateInput!",
									value: { issueId: fromId, relatedIssueId: toId, type: rtype },
								},
							},
							selection: "success issueRelation { id type }",
						});
						plan.push({ alias: `op${i}`, kind: "relate", from: op.from, to: op.to, type: rtype });
					} else if (kind === "comment") {
						const issueId = idMap[op.issue as string];
						if (!issueId) throw new ValidationError(`Op #${i}: unknown issue ${op.issue}`);
						if (typeof op.body !== "string") throw new ValidationError(`Op #${i}: comment requires body`);
						mutations.push({
							alias: `op${i}`,
							field: "commentCreate",
							vars: {
								input: {
									type: "CommentCreateInput!",
									value: { issueId, body: op.body },
								},
							},
							selection: "success comment { id }",
						});
						plan.push({ alias: `op${i}`, kind: "comment", issue: op.issue });
					} else if (kind === "label-add" || kind === "label-remove") {
						const issueId = idMap[op.issue as string];
						const labelId = labelMap[op.label as string];
						if (!issueId) throw new ValidationError(`Op #${i}: unknown issue ${op.issue}`);
						if (!labelId) throw new ValidationError(`Op #${i}: unknown label ${op.label}`);
						const field = kind === "label-add" ? "issueAddLabel" : "issueRemoveLabel";
						mutations.push({
							alias: `op${i}`,
							field,
							vars: {
								id: { type: "String!", value: issueId },
								labelId: { type: "String!", value: labelId },
							},
							selection: "success",
						});
						plan.push({ alias: `op${i}`, kind, issue: op.issue, label: op.label });
					} else if (kind === "archive") {
						const id = idMap[op.id as string];
						if (!id) throw new ValidationError(`Op #${i}: unknown issue ${op.id}`);
						mutations.push({
							alias: `op${i}`,
							field: "issueArchive",
							vars: { id: { type: "String!", value: id } },
							selection: "success",
						});
						plan.push({ alias: `op${i}`, kind: "archive", id: op.id });
					} else {
						throw new ValidationError(`Op #${i}: unknown kind "${kind}"`);
					}
				}

				if (opts.dryRun) {
					outputSuccess({ resolved: plan.length, plan });
					return;
				}

				const batchSize = parseInt(opts.batchSize as string, 10) || 10;
				const results = await batchMutations(mutations, { batchSize });
				const failed = results.filter((r) => !r.ok);
				outputSuccess({
					executed: results.length,
					succeeded: results.length - failed.length,
					failed: failed.length,
					failures: failed,
				});
				if (opts.stats) printRateLimitStats("bulk-ops");
			}),
		);
}

function readBatchInput(jsonFile: string): IssueCreateInput[] {
	const raw = readJsonSource(jsonFile);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(`Invalid JSON in batch file: ${msg}`);
	}
	if (!Array.isArray(parsed)) {
		throw new ValidationError("Batch input must be a JSON array of issue inputs.");
	}
	return parsed as IssueCreateInput[];
}

function readBatchPatch(jsonFile: string): IssueUpdateInput {
	const raw = readJsonSource(jsonFile);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(`Invalid JSON in patch file: ${msg}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ValidationError("Batch patch must be a JSON object (IssueUpdateInput).");
	}
	return parsed as IssueUpdateInput;
}

function readJsonSource(jsonFile: string): string {
	if (jsonFile === "-") {
		return readFileSync(0, "utf-8");
	}
	const filePath = resolvePath(jsonFile);
	try {
		return readFileSync(filePath, "utf-8");
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(`Cannot read "${jsonFile}": ${msg}`);
	}
}

export async function getLabelNames(issue: Issue | IssueSearchResult, client?: LinearClient): Promise<string[]> {
	if ("labels" in issue && typeof (issue as Issue).labels === "function") {
		const conn = await (issue as Issue).labels();
		return conn?.nodes?.map((l) => l.name) ?? [];
	}
	const ids = (issue as IssueSearchResult).labelIds;
	if (!client || !ids || ids.length === 0) return [];
	const conn = await client.issueLabels({
		filter: { id: { in: ids } },
		first: ids.length,
	});
	return conn?.nodes?.map((l) => l.name) ?? [];
}

async function formatIssue(
	issue: Issue | IssueSearchResult,
	detailed = false,
	client?: LinearClient,
): Promise<Record<string, unknown>> {
	const [state, assignee, team, project] = await Promise.all([issue.state, issue.assignee, issue.team, issue.project]);

	let labelNames: string[] = [];
	try {
		labelNames = await getLabelNames(issue, client);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		process.stderr.write(`Warning: could not fetch labels for ${issue.identifier}: ${msg}\n`);
	}

	const result: Record<string, unknown> = {
		identifier: issue.identifier,
		title: issue.title,
		state: state?.name ?? null,
		priority: issue.priority,
		assignee: assignee?.name ?? null,
		team: team?.name ?? null,
		project: project?.name ?? null,
		labels: labelNames,
		dueDate: issue.dueDate ?? null,
		url: issue.url,
	};

	if (detailed) {
		result.id = issue.id;
		result.createdAt = issue.createdAt;
		result.updatedAt = issue.updatedAt;
		result.description = issue.description ?? null;
		const parent = await issue.parent;
		result.parent = parent ? { id: parent.id, identifier: parent.identifier, title: parent.title } : null;
	}

	return result;
}
