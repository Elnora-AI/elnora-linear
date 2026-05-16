// Batch resolution of human-readable identifiers to UUIDs.
// Pattern borrowed from czottmann/linearis — resolve multiple entities in
// minimal API calls.

import type { Issue, LinearClient } from "@linear/sdk";

import { NotFoundError, ValidationError } from "./errors.js";

/**
 * Minimal interface for SDK connection objects that support pagination. The
 * SDK exports LinearConnection (no fetchNext) and internal Connection (with
 * fetchNext). Concrete connections returned by client methods (e.g.
 * client.projects()) implement this.
 */
interface PaginatedConnection<T> {
	nodes: T[];
	pageInfo: { hasNextPage: boolean };
	fetchNext(): Promise<PaginatedConnection<T>>;
}

/**
 * Paginate through all nodes in a connection. Uses the SDK's built-in
 * fetchNext() to break the 250-item ceiling.
 */
export async function fetchAllNodes<T>(connection: PaginatedConnection<T>): Promise<T[]> {
	let current = connection;
	const all = [...current.nodes];
	while (current.pageInfo.hasNextPage) {
		current = await current.fetchNext();
		all.push(...current.nodes);
	}
	return all;
}

/** True if `value` is a UUID v4-shaped string. */
export function isUUID(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Resolve a team name or key to its UUID. Accepts: team name ("Engineering"),
 * key ("ENG"), or UUID.
 */
export async function resolveTeam(
	client: LinearClient,
	nameOrId: string,
): Promise<{ id: string; name: string; key: string }> {
	if (isUUID(nameOrId)) {
		const team = await client.team(nameOrId);
		return { id: team.id, name: team.name, key: team.key };
	}
	const connection = await client.teams({ first: 250 });
	const allTeams = await fetchAllNodes(connection);
	const lower = nameOrId.toLowerCase();
	const match = allTeams.find((t) => t.name.toLowerCase() === lower || t.key.toLowerCase() === lower);
	if (!match) throw new NotFoundError("Team", nameOrId);
	return { id: match.id, name: match.name, key: match.key };
}

/** Resolve a project name to its UUID. */
export async function resolveProject(client: LinearClient, nameOrId: string): Promise<{ id: string; name: string }> {
	if (isUUID(nameOrId)) {
		const project = await client.project(nameOrId);
		return { id: project.id, name: project.name };
	}
	const connection = await client.projects({ first: 250 });
	const allProjects = await fetchAllNodes(connection);
	const lower = nameOrId.toLowerCase();
	const match = allProjects.find((p) => p.name.toLowerCase() === lower);
	if (!match) throw new NotFoundError("Project", nameOrId);
	return { id: match.id, name: match.name };
}

/** Resolve a user name, email, or "me" to UUID. */
export async function resolveUser(client: LinearClient, nameOrId: string): Promise<{ id: string; name: string }> {
	if (nameOrId.toLowerCase() === "me") {
		const me = await client.viewer;
		return { id: me.id, name: me.name };
	}
	if (isUUID(nameOrId)) {
		const user = await client.user(nameOrId);
		return { id: user.id, name: user.name };
	}
	const connection = await client.users({ first: 250 });
	const allUsers = await fetchAllNodes(connection);
	const lower = nameOrId.toLowerCase();
	const match = allUsers.find((u) => u.name.toLowerCase() === lower || (u.email && u.email.toLowerCase() === lower));
	if (!match) throw new NotFoundError("User", nameOrId);
	return { id: match.id, name: match.name };
}

/** Resolve comma-separated label names to UUIDs. */
export async function resolveLabels(client: LinearClient, labelNames: string): Promise<{ id: string; name: string }[]> {
	const names = labelNames
		.split(",")
		.map((n) => n.trim())
		.filter(Boolean);
	if (names.length === 0) {
		throw new ValidationError("No valid label names provided. Separate multiple labels with commas.");
	}
	const connection = await client.issueLabels({ first: 250 });
	const allLabels = await fetchAllNodes(connection);
	const resolved: { id: string; name: string }[] = [];
	for (const name of names) {
		const lower = name.toLowerCase();
		const match = allLabels.find((l) => l.name.toLowerCase() === lower);
		if (!match) throw new NotFoundError("Label", name);
		resolved.push({ id: match.id, name: match.name });
	}
	return resolved;
}

/** Resolve a workflow state name to UUID for a given team. */
export async function resolveState(
	client: LinearClient,
	stateName: string,
	teamId: string,
): Promise<{ id: string; name: string; type: string }> {
	const states = await client.workflowStates({
		first: 250,
		filter: { team: { id: { eq: teamId } } },
	});
	const lower = stateName.toLowerCase();
	const match = states.nodes.find((s) => s.name.toLowerCase() === lower);
	if (!match) throw new NotFoundError("State", stateName);
	return { id: match.id, name: match.name, type: match.type };
}

/** Resolve an initiative name to its UUID. */
export async function resolveInitiative(client: LinearClient, nameOrId: string): Promise<{ id: string; name: string }> {
	if (isUUID(nameOrId)) {
		const init = await client.initiative(nameOrId);
		return { id: init.id, name: init.name };
	}
	const connection = await client.initiatives({ first: 250 });
	const all = await fetchAllNodes(connection);
	const lower = nameOrId.toLowerCase();
	const match = all.find((i) => i.name.toLowerCase() === lower);
	if (!match) throw new NotFoundError("Initiative", nameOrId);
	return { id: match.id, name: match.name };
}

/**
 * Parse an issue identifier like "ENG-123" into a searchable format. Returns
 * the identifier as-is if it looks like a Linear issue ID.
 */
export function parseIssueIdentifier(input: string): string {
	if (isUUID(input)) return input;
	if (/^[A-Za-z]+-\d+$/.test(input)) return input;
	throw new NotFoundError("Issue", input);
}

/**
 * Find an issue by Linear identifier (e.g., ENG-123) or UUID.
 *
 * Identifiers are split into team key + number and resolved through the
 * standard client.issues({filter}) API in a single request. Earlier this
 * function did searchIssues + client.issue() (two requests); the filter-based
 * path returns full Issue objects directly so connection methods (.comments(),
 * .labels(), .relations()) work the same as before.
 */
export async function findIssueByIdentifier(client: LinearClient, id: string): Promise<Issue> {
	if (isUUID(id)) return client.issue(id);
	const match = id.toUpperCase().match(/^([A-Z]+)-(\d+)$/);
	if (!match) throw new NotFoundError("Issue", id);
	const result = await client.issues({
		filter: { team: { key: { eq: match[1] } }, number: { eq: parseInt(match[2], 10) } },
		first: 1,
	});
	const issue = result.nodes[0];
	if (issue) return issue;
	throw new NotFoundError("Issue", id);
}

/**
 * Resolve a project status by name (e.g. "Started") OR type
 * (backlog|planned|started|paused|completed|canceled) to its UUID. Used by
 * `projects update --state` since the SDK's ProjectUpdateInput takes statusId,
 * not a state string.
 */
export async function resolveProjectStatus(
	client: LinearClient,
	nameOrType: string,
): Promise<{ id: string; name: string; type: string }> {
	if (isUUID(nameOrType)) {
		const status = await client.projectStatus(nameOrType);
		return { id: status.id, name: status.name, type: status.type };
	}
	const connection = await client.projectStatuses({ first: 250 });
	const all = await fetchAllNodes(connection);
	const lower = nameOrType.toLowerCase();
	const match = all.find((s) => s.name.toLowerCase() === lower || s.type.toLowerCase() === lower);
	if (!match) throw new NotFoundError("Project status", nameOrType);
	return { id: match.id, name: match.name, type: match.type };
}
