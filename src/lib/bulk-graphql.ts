// Bulk GraphQL client — raw fetch against Linear's GraphQL endpoint, bypassing
// the @linear/sdk's per-relation lazy resolvers.
//
// Why: SDK list calls like client.issues(...) return objects whose relations
// (state, assignee, project, labels) are Promise-typed properties — awaiting
// each one fires a fresh GraphQL request. Reading 250 issues costs ~1,250
// requests, blowing the 2,500/hr Linear budget in two listings.

import { getApiKey } from "../client/index.js";
import { redactSecrets } from "../output/index.js";
import { sleep } from "../utils/sleep.js";

const ENDPOINT = "https://api.linear.app/graphql";

export interface RateLimitHeaders {
	remaining?: number;
	limit?: number;
	resetSeconds?: number;
}

export interface GraphQLResponse<T> {
	data?: T;
	errors?: Array<{
		message: string;
		path?: Array<string | number>;
		extensions?: Record<string, unknown>;
	}>;
	rateLimit: RateLimitHeaders;
}

let cachedApiKey: string | null = null;
async function getCachedApiKey(): Promise<string> {
	if (!cachedApiKey) cachedApiKey = await getApiKey({ allowPrompt: true });
	return cachedApiKey;
}

export function resetBulkGraphqlAuthCache(): void {
	cachedApiKey = null;
}

let lastRateLimit: RateLimitHeaders = {};
export function getLastRateLimit(): RateLimitHeaders {
	return lastRateLimit;
}

function parseRateHeaders(h: Headers): RateLimitHeaders {
	const num = (v: string | null) => (v != null && !Number.isNaN(+v) ? +v : undefined);
	let resetSeconds: number | undefined = num(h.get("x-ratelimit-requests-reset"));
	if (resetSeconds !== undefined) {
		const nowSec = Date.now() / 1000;
		const asAbsolute = resetSeconds > 1e12 ? resetSeconds / 1000 : resetSeconds;
		if (asAbsolute > nowSec) {
			resetSeconds = Math.max(0, Math.round(asAbsolute - nowSec));
		}
	}
	return {
		remaining: num(h.get("x-ratelimit-requests-remaining")),
		limit: num(h.get("x-ratelimit-requests-limit")),
		resetSeconds,
	};
}

function isRateLimitedBody(body: {
	errors?: Array<{ message?: string; extensions?: Record<string, unknown> }>;
}): boolean {
	const errs = body.errors;
	if (!Array.isArray(errs) || errs.length === 0) return false;
	return errs.some((e) => e?.extensions?.code === "RATELIMITED" || e?.extensions?.type === "ratelimited");
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;
export function setFetchForTesting(impl: FetchLike | null): void {
	fetchImpl = impl ?? fetch;
}

export async function gqlRequest<T = unknown>(
	query: string,
	variables: Record<string, unknown> = {},
	opts: { maxRetries?: number } = {},
): Promise<GraphQLResponse<T>> {
	const maxRetries = opts.maxRetries ?? 3;
	const apiKey = await getCachedApiKey();
	let attempt = 0;
	while (true) {
		const res = await fetchImpl(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: apiKey },
			body: JSON.stringify({ query, variables }),
		});
		const rateLimit = parseRateHeaders(res.headers);
		lastRateLimit = rateLimit;

		if (res.status === 429) {
			if (attempt >= maxRetries) {
				return { errors: [{ message: "Rate limited after max retries" }], rateLimit };
			}
			const retryAfter = +(res.headers.get("retry-after") ?? "60");
			process.stderr.write(`Linear 429: sleeping ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})\n`);
			await sleep(retryAfter * 1000);
			attempt++;
			continue;
		}

		let parsedBody: {
			data?: T;
			errors?: Array<{ message: string; path?: Array<string | number>; extensions?: Record<string, unknown> }>;
		} | null = null;
		if (res.status === 400) {
			try {
				parsedBody = await res.clone().json();
			} catch {}
			if (parsedBody && isRateLimitedBody(parsedBody)) {
				if (attempt >= maxRetries) {
					return { errors: [{ message: "Rate limited after max retries" }], rateLimit };
				}
				const retryAfter = +(res.headers.get("retry-after") ?? "60");
				process.stderr.write(`Linear RATELIMITED: sleeping ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})\n`);
				await sleep(retryAfter * 1000);
				attempt++;
				continue;
			}
		}

		if (!res.ok) {
			const text = parsedBody ? JSON.stringify(parsedBody) : await res.text();
			return {
				errors: [{ message: redactSecrets(`HTTP ${res.status}: ${text.slice(0, 500)}`) }],
				rateLimit,
			};
		}
		const body =
			parsedBody ??
			((await res.json()) as {
				data?: T;
				errors?: Array<{ message: string; path?: Array<string | number>; extensions?: Record<string, unknown> }>;
			});
		if (rateLimit.remaining !== undefined && rateLimit.limit !== undefined) {
			const headroom = rateLimit.remaining / rateLimit.limit;
			if (headroom < 0.05) {
				process.stderr.write(`Linear rate-limit headroom ${(headroom * 100).toFixed(1)}% — pausing 2s\n`);
				await sleep(2000);
			}
		}
		return { ...body, rateLimit };
	}
}

export interface BulkIssueNode {
	identifier: string;
	title: string;
	description: string | null;
	priority: number | null;
	state: { id: string; name: string; type: string } | null;
	assignee: { id: string; name: string } | null;
	team: { id: string; key: string; name: string } | null;
	project: { id: string; name: string } | null;
	labels: { nodes: Array<{ id: string; name: string }> };
	parent: { identifier: string } | null;
	children: { nodes: Array<{ identifier: string }> };
	relations: { nodes: Array<{ type: string; relatedIssue: { identifier: string } | null }> };
	url: string;
	updatedAt: string;
	createdAt: string;
}

const BULK_LIST_FIELDS_DEFAULT = `
  identifier
  title
  priority
  state { id name type }
  assignee { id name }
  team { id key name }
  project { id name }
  labels { nodes { id name } }
  parent { identifier }
  url
`;

const BULK_LIST_FIELDS_EXTENDED = `
  identifier
  title
  description
  priority
  state { id name type }
  assignee { id name }
  team { id key name }
  project { id name }
  labels { nodes { id name } }
  parent { identifier }
  children { nodes { identifier } }
  relations { nodes { type relatedIssue { identifier } } }
  url
  updatedAt
  createdAt
`;

function bulkListFieldsFor(opts: { includeDescription?: boolean; includeRelations?: boolean }): string {
	return opts.includeDescription || opts.includeRelations ? BULK_LIST_FIELDS_EXTENDED : BULK_LIST_FIELDS_DEFAULT;
}

export async function bulkListIssues(
	filter: Record<string, unknown>,
	opts: { pageSize?: number; max?: number; includeDescription?: boolean; includeRelations?: boolean } = {},
): Promise<BulkIssueNode[]> {
	const pageSize = opts.pageSize ?? 250;
	const max = opts.max ?? Infinity;
	const fields = bulkListFieldsFor(opts);
	const query = `
    query IssuesBulk($after: String, $filter: IssueFilter, $first: Int!) {
      issues(first: $first, after: $after, filter: $filter) {
        pageInfo { hasNextPage endCursor }
        nodes { ${fields} }
      }
    }`;
	type IssuesPage = {
		issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: BulkIssueNode[] };
	};
	const all: BulkIssueNode[] = [];
	let after: string | null = null;
	while (true) {
		const res: GraphQLResponse<IssuesPage> = await gqlRequest<IssuesPage>(query, {
			after,
			filter,
			first: Math.min(pageSize, max - all.length),
		});
		if (res.errors) {
			throw new Error(`bulkListIssues failed: ${res.errors.map((e) => e.message).join("; ")}`);
		}
		const page = (res.data as IssuesPage).issues;
		all.push(...page.nodes);
		if (!page.pageInfo.hasNextPage || all.length >= max) break;
		after = page.pageInfo.endCursor;
	}
	return all;
}

export async function bulkGetIssue(
	identifier: string,
	opts: { includeDescription?: boolean; includeRelations?: boolean } = {},
): Promise<BulkIssueNode | null> {
	const match = identifier.match(/^([A-Z]+)-(\d+)$/);
	if (!match) return null;
	const fields = bulkListFieldsFor({
		includeDescription: opts.includeDescription ?? true,
		includeRelations: opts.includeRelations ?? true,
	});
	const res = await gqlRequest<{ issues: { nodes: BulkIssueNode[] } }>(
		`query($team: String!, $number: Float!) {
      issues(first: 1, filter: { team: { key: { eq: $team } }, number: { eq: $number } }) {
        nodes { ${fields} }
      }
    }`,
		{ team: match[1], number: parseInt(match[2], 10) },
	);
	if (res.errors) throw new Error(`bulkGetIssue: ${res.errors.map((e) => e.message).join("; ")}`);
	return (res.data as { issues: { nodes: BulkIssueNode[] } }).issues.nodes[0] ?? null;
}

export async function bulkSearchIssues(
	query: string,
	opts: { teamKey?: string; first?: number; includeDescription?: boolean; includeRelations?: boolean } = {},
): Promise<BulkIssueNode[]> {
	const teamVar = opts.teamKey ? "$team: String!" : "";
	const variables: Record<string, unknown> = { query, first: opts.first ?? 25 };
	if (opts.teamKey) variables.team = opts.teamKey;
	const gql = `
    query Search($query: String!, $first: Int!${teamVar ? `, ${teamVar}` : ""}) {
      issues(
        first: $first
        filter: {
          and: [
            { or: [
              { title: { containsIgnoreCase: $query } }
              { description: { containsIgnoreCase: $query } }
            ] }
            ${opts.teamKey ? "{ team: { key: { eq: $team } } }" : ""}
          ]
        }
      ) {
        nodes { ${bulkListFieldsFor(opts)} }
      }
    }`;
	const res = await gqlRequest<{ issues: { nodes: BulkIssueNode[] } }>(gql, variables);
	if (res.errors) throw new Error(`bulkSearchIssues: ${res.errors.map((e) => e.message).join("; ")}`);
	return (res.data as { issues: { nodes: BulkIssueNode[] } }).issues.nodes;
}

export function formatBulkIssue(n: BulkIssueNode, withFull = false): Record<string, unknown> {
	const out: Record<string, unknown> = {
		identifier: n.identifier,
		title: n.title,
		state: n.state?.name ?? null,
		priority: n.priority,
		assignee: n.assignee?.name ?? null,
		team: n.team?.name ?? null,
		project: n.project?.name ?? null,
		labels: n.labels.nodes.map((l) => l.name),
		parent: n.parent?.identifier ?? null,
		url: n.url,
	};
	if (withFull) {
		out.description = n.description;
		out.children = n.children.nodes.map((c) => c.identifier);
		out.relations = n.relations.nodes.map((r) => ({ type: r.type, with: r.relatedIssue?.identifier ?? null }));
		out.updatedAt = n.updatedAt;
		out.createdAt = n.createdAt;
	}
	return out;
}

export interface MutationOp {
	alias: string;
	field: string;
	vars: Record<string, { type: string; value: unknown }>;
	selection?: string;
}

export async function batchMutations(
	ops: MutationOp[],
	opts: { batchSize?: number } = {},
): Promise<Array<{ alias: string; ok: boolean; data?: unknown; error?: string }>> {
	const batchSize = opts.batchSize ?? 10;
	const results: Array<{ alias: string; ok: boolean; data?: unknown; error?: string }> = [];
	for (let i = 0; i < ops.length; i += batchSize) {
		const slice = ops.slice(i, i + batchSize);
		const varDecls: string[] = [];
		const opDecls: string[] = [];
		const variables: Record<string, unknown> = {};
		for (const op of slice) {
			const argParts: string[] = [];
			for (const [vName, v] of Object.entries(op.vars)) {
				const scoped = `${op.alias}_${vName}`;
				varDecls.push(`$${scoped}: ${v.type}`);
				argParts.push(`${vName}: $${scoped}`);
				variables[scoped] = v.value;
			}
			const sel = op.selection ?? "success";
			opDecls.push(`${op.alias}: ${op.field}(${argParts.join(", ")}) { ${sel} }`);
		}
		const doc = `mutation Batch(${varDecls.join(", ")}) {\n  ${opDecls.join("\n  ")}\n}`;
		const res = await gqlRequest<Record<string, unknown>>(doc, variables);
		const errorByAlias = new Map<string, string>();
		const documentErrors: string[] = [];
		for (const e of res.errors ?? []) {
			const alias = typeof e.path?.[0] === "string" ? (e.path[0] as string) : null;
			if (alias) {
				const prev = errorByAlias.get(alias);
				errorByAlias.set(alias, prev ? `${prev}; ${e.message}` : e.message);
			} else {
				documentErrors.push(e.message);
			}
		}
		const docError = documentErrors.length > 0 ? documentErrors.join("; ") : null;
		const siblingError =
			errorByAlias.size > 0
				? `aborted: sibling op in same batch failed (${[...errorByAlias.values()].join("; ")})`
				: null;
		for (const op of slice) {
			const data = res.data?.[op.alias];
			const aliasError = errorByAlias.get(op.alias);
			if (data) {
				results.push({ alias: op.alias, ok: true, data });
			} else if (aliasError) {
				results.push({ alias: op.alias, ok: false, error: aliasError });
			} else if (docError) {
				results.push({ alias: op.alias, ok: false, error: docError });
			} else if (siblingError) {
				results.push({ alias: op.alias, ok: false, error: siblingError });
			} else {
				results.push({ alias: op.alias, ok: false, error: "no data returned" });
			}
		}
	}
	return results;
}

export async function resolveIssueIds(identifiers: string[]): Promise<Record<string, string>> {
	if (identifiers.length === 0) return {};
	const byTeam: Record<string, number[]> = {};
	for (const id of identifiers) {
		const m = /^([A-Z]+)-(\d+)$/.exec(id);
		if (!m) continue;
		const teamKey = m[1];
		if (!byTeam[teamKey]) byTeam[teamKey] = [];
		byTeam[teamKey].push(parseInt(m[2], 10));
	}
	const map: Record<string, string> = {};
	for (const [teamKey, numbers] of Object.entries(byTeam)) {
		let after: string | null = null;
		while (true) {
			const res: GraphQLResponse<{
				issues: {
					pageInfo: { hasNextPage: boolean; endCursor: string | null };
					nodes: Array<{ id: string; identifier: string }>;
				};
			}> = await gqlRequest(
				`query($team: String!, $numbers: [Float!], $after: String) {
          issues(
            first: 250
            after: $after
            filter: { team: { key: { eq: $team } }, number: { in: $numbers } }
          ) {
            pageInfo { hasNextPage endCursor }
            nodes { id identifier }
          }
        }`,
				{ team: teamKey, numbers, after },
			);
			if (res.errors) throw new Error(`resolveIssueIds: ${res.errors.map((e) => e.message).join("; ")}`);
			const page = (
				res.data as {
					issues: {
						pageInfo: { hasNextPage: boolean; endCursor: string | null };
						nodes: Array<{ id: string; identifier: string }>;
					};
				}
			).issues;
			for (const n of page.nodes) map[n.identifier] = n.id;
			if (!page.pageInfo.hasNextPage) break;
			after = page.pageInfo.endCursor;
		}
	}
	return map;
}

export async function resolveStateId(teamKey: string, stateName: string): Promise<string | null> {
	const res = await gqlRequest<{ team: { states: { nodes: Array<{ id: string; name: string }> } } | null }>(
		`query($team: String!) {
      team(id: $team) {
        states(first: 50) { nodes { id name } }
      }
    }`,
		{ team: teamKey },
	);
	if (res.errors || !res.data?.team) return null;
	const match = res.data.team.states.nodes.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
	return match?.id ?? null;
}

export const _internal = { parseRateHeaders, isRateLimitedBody, bulkListFieldsFor };
