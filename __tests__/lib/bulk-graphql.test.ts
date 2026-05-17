import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	_internal,
	batchMutations,
	bulkGetIssue,
	bulkListIssues,
	bulkSearchIssues,
	formatBulkIssue,
	getLastRateLimit,
	gqlRequest,
	resetBulkGraphqlAuthCache,
	resolveIssueIds,
	resolveStateId,
	setFetchForTesting,
} from "../../src/lib/index.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	process.env.LINEAR_API_KEY = "lin_api_test";
	resetBulkGraphqlAuthCache();
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	setFetchForTesting(null);
	resetBulkGraphqlAuthCache();
	vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: { "content-type": "application/json", ...(init.headers ?? {}) },
	});
}

describe("_internal.parseRateHeaders", () => {
	it("parses remaining + limit + reset (relative seconds)", () => {
		const headers = new Headers({
			"x-ratelimit-requests-remaining": "100",
			"x-ratelimit-requests-limit": "2500",
			"x-ratelimit-requests-reset": "45",
		});
		const parsed = _internal.parseRateHeaders(headers);
		expect(parsed.remaining).toBe(100);
		expect(parsed.limit).toBe(2500);
		expect(parsed.resetSeconds).toBe(45);
	});

	it("treats large reset values as absolute ms epoch", () => {
		const futureMs = Date.now() + 30_000;
		const headers = new Headers({ "x-ratelimit-requests-reset": String(futureMs) });
		const parsed = _internal.parseRateHeaders(headers);
		expect(parsed.resetSeconds).toBeGreaterThan(20);
		expect(parsed.resetSeconds).toBeLessThanOrEqual(31);
	});

	it("returns undefined fields when headers absent", () => {
		const parsed = _internal.parseRateHeaders(new Headers());
		expect(parsed.remaining).toBeUndefined();
		expect(parsed.limit).toBeUndefined();
		expect(parsed.resetSeconds).toBeUndefined();
	});
});

describe("_internal.isRateLimitedBody", () => {
	it("detects RATELIMITED extension code", () => {
		expect(
			_internal.isRateLimitedBody({
				errors: [{ message: "rate", extensions: { code: "RATELIMITED" } }],
			}),
		).toBe(true);
	});

	it("returns false for unrelated GraphQL errors", () => {
		expect(_internal.isRateLimitedBody({ errors: [{ message: "boom" }] })).toBe(false);
	});

	it("returns false when no errors", () => {
		expect(_internal.isRateLimitedBody({})).toBe(false);
	});
});

describe("gqlRequest", () => {
	it("posts query + variables and returns data + rateLimit", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse(
				{ data: { ping: "pong" } },
				{ headers: { "x-ratelimit-requests-remaining": "1000", "x-ratelimit-requests-limit": "2500" } },
			),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const res = await gqlRequest<{ ping: string }>("{ ping }", { x: 1 });
		expect(res.data?.ping).toBe("pong");
		expect(res.rateLimit.remaining).toBe(1000);
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.query).toBe("{ ping }");
		expect(body.variables).toEqual({ x: 1 });
		const init = fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
		expect(init.headers.Authorization).toBe("lin_api_test");
	});

	it("retries on HTTP 429 then succeeds", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ errors: [{ message: "slow" }] }, { status: 429, headers: { "retry-after": "0" } }),
			)
			.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const res = await gqlRequest("{ ok }");
		expect(res.data).toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("retries on 400 with RATELIMITED extension", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse(
					{ errors: [{ message: "rate", extensions: { code: "RATELIMITED" } }] },
					{ status: 400, headers: { "retry-after": "0" } },
				),
			)
			.mockResolvedValueOnce(jsonResponse({ data: { ok: 1 } }));
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const res = await gqlRequest("{ ok }");
		expect(res.data).toEqual({ ok: 1 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns error envelope after max retries on 429", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ errors: [{ message: "slow" }] }, { status: 429, headers: { "retry-after": "0" } }),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const res = await gqlRequest("{ ok }", {}, { maxRetries: 1 });
		expect(res.errors?.[0].message).toMatch(/Rate limited/);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("redacts API keys in HTTP error bodies", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response("auth failure for lin_api_supersecret123", {
					status: 401,
					headers: { "content-type": "text/plain" },
				}),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const res = await gqlRequest("{ x }");
		expect(res.errors?.[0].message).toContain("lin_api_[REDACTED]");
		expect(res.errors?.[0].message).not.toContain("supersecret123");
	});

	it("updates getLastRateLimit() after each call", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ data: {} }, { headers: { "x-ratelimit-requests-remaining": "42" } }),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		await gqlRequest("{ x }");
		expect(getLastRateLimit().remaining).toBe(42);
	});
});

describe("bulkListIssues", () => {
	it("paginates until hasNextPage is false", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						issues: {
							pageInfo: { hasNextPage: true, endCursor: "cur1" },
							nodes: [
								{
									identifier: "ENG-1",
									title: "one",
									priority: 2,
									state: { id: "s1", name: "Todo", type: "unstarted" },
									assignee: null,
									team: { id: "t", key: "ENG", name: "Eng" },
									project: null,
									labels: { nodes: [] },
									parent: null,
									url: "u1",
								},
							],
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						issues: {
							pageInfo: { hasNextPage: false, endCursor: null },
							nodes: [
								{
									identifier: "ENG-2",
									title: "two",
									priority: null,
									state: null,
									assignee: null,
									team: null,
									project: null,
									labels: { nodes: [] },
									parent: null,
									url: "u2",
								},
							],
						},
					},
				}),
			);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const issues = await bulkListIssues({}, { pageSize: 1 });
		expect(issues).toHaveLength(2);
		expect(issues.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
		const secondCall = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
		expect(secondCall.variables.after).toBe("cur1");
	});

	it("stops at max even when more pages available", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				data: {
					issues: {
						pageInfo: { hasNextPage: true, endCursor: "cur1" },
						nodes: [
							{
								identifier: "ENG-1",
								title: "one",
								priority: 0,
								state: null,
								assignee: null,
								team: null,
								project: null,
								labels: { nodes: [] },
								parent: null,
								url: "u1",
							},
						],
					},
				},
			}),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const issues = await bulkListIssues({}, { pageSize: 50, max: 1 });
		expect(issues).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("throws when GraphQL returns errors", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ errors: [{ message: "bad filter" }] }));
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		await expect(bulkListIssues({})).rejects.toThrow(/bad filter/);
	});
});

describe("bulkGetIssue", () => {
	it("parses team prefix + number from identifier", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				data: {
					issues: {
						nodes: [
							{
								identifier: "ENG-42",
								title: "x",
								description: null,
								priority: 1,
								state: null,
								assignee: null,
								team: null,
								project: null,
								labels: { nodes: [] },
								parent: null,
								children: { nodes: [] },
								relations: { nodes: [] },
								url: "u",
								updatedAt: "",
								createdAt: "",
							},
						],
					},
				},
			}),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const issue = await bulkGetIssue("ENG-42");
		expect(issue?.identifier).toBe("ENG-42");
		const variables = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).variables;
		expect(variables).toEqual({ team: "ENG", number: 42 });
	});

	it("returns null for malformed identifier", async () => {
		const fetchMock = vi.fn();
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		expect(await bulkGetIssue("not-an-id")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("bulkSearchIssues", () => {
	it("returns flat node list", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				data: {
					issues: {
						nodes: [
							{
								identifier: "ENG-1",
								title: "match",
								priority: 0,
								state: null,
								assignee: null,
								team: null,
								project: null,
								labels: { nodes: [] },
								parent: null,
								url: "u",
							},
						],
					},
				},
			}),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const results = await bulkSearchIssues("query");
		expect(results).toHaveLength(1);
		expect(results[0].identifier).toBe("ENG-1");
	});

	it("adds team filter when teamKey given", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ data: { issues: { nodes: [] } } }));
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		await bulkSearchIssues("q", { teamKey: "ENG" });
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.query).toContain("team: { key: { eq: $team }");
		expect(body.variables.team).toBe("ENG");
	});
});

describe("formatBulkIssue", () => {
	const sample = {
		id: "issue-uuid-1",
		identifier: "ENG-1",
		title: "title",
		description: "desc",
		priority: 2,
		state: { id: "s", name: "In Progress", type: "started" },
		assignee: { id: "u", name: "Alice" },
		team: { id: "t", key: "ENG", name: "Engineering" },
		project: { id: "p", name: "Proj" },
		labels: { nodes: [{ id: "l", name: "Type:bug" }] },
		parent: { identifier: "ENG-0" },
		children: { nodes: [{ identifier: "ENG-2" }] },
		relations: { nodes: [{ type: "related", relatedIssue: { identifier: "OPS-9" } }] },
		url: "https://linear.app/x",
		updatedAt: "2026-01-01",
		createdAt: "2026-01-01",
		archivedAt: null,
	};

	it("returns the slim shape by default", () => {
		const out = formatBulkIssue(sample);
		expect(out).toMatchObject({
			id: "issue-uuid-1",
			identifier: "ENG-1",
			state: "In Progress",
			assignee: "Alice",
			labels: ["Type:bug"],
			parent: "ENG-0",
		});
		expect(out.description).toBeUndefined();
		expect(out.children).toBeUndefined();
	});

	it("exposes the issue UUID so users can recover identifiers after archive", () => {
		// Regression: without id in the default shape, the CLI provided no path to
		// the UUID of an archived issue (ENG-N lookup excludes archived rows).
		const out = formatBulkIssue(sample);
		expect(out.id).toBe("issue-uuid-1");
	});

	it("includes children/description/relations/archivedAt when withFull=true", () => {
		const out = formatBulkIssue({ ...sample, archivedAt: "2026-05-17T00:00:00Z" }, true);
		expect(out.description).toBe("desc");
		expect(out.children).toEqual(["ENG-2"]);
		expect(out.relations).toEqual([{ type: "related", with: "OPS-9" }]);
		expect(out.archivedAt).toBe("2026-05-17T00:00:00Z");
	});
});

describe("batchMutations", () => {
	it("builds aliased multi-mutation document with scoped variables", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				data: {
					op_0: { success: true },
					op_1: { success: true },
				},
			}),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const results = await batchMutations([
			{
				alias: "op_0",
				field: "issueUpdate",
				vars: { id: { type: "String!", value: "abc" }, input: { type: "IssueUpdateInput!", value: { title: "A" } } },
			},
			{
				alias: "op_1",
				field: "issueUpdate",
				vars: { id: { type: "String!", value: "def" }, input: { type: "IssueUpdateInput!", value: { title: "B" } } },
			},
		]);
		expect(results).toEqual([
			{ alias: "op_0", ok: true, data: { success: true } },
			{ alias: "op_1", ok: true, data: { success: true } },
		]);
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.query).toContain("$op_0_id: String!");
		expect(body.query).toContain("$op_1_id: String!");
		expect(body.query).toContain("op_0: issueUpdate(");
		expect(body.query).toContain("op_1: issueUpdate(");
		expect(body.variables.op_0_id).toBe("abc");
		expect(body.variables.op_1_id).toBe("def");
	});

	it("maps per-alias errors via response.errors[].path[0]", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				data: { op_0: { success: true }, op_1: null },
				errors: [{ message: "boom", path: ["op_1"] }],
			}),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const results = await batchMutations([
			{ alias: "op_0", field: "issueUpdate", vars: { id: { type: "String!", value: "a" } } },
			{ alias: "op_1", field: "issueUpdate", vars: { id: { type: "String!", value: "b" } } },
		]);
		expect(results[0]).toEqual({ alias: "op_0", ok: true, data: { success: true } });
		expect(results[1]).toEqual({ alias: "op_1", ok: false, error: "boom" });
	});

	it("falls back to sibling-error when no aliased errors on a null op", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				data: { op_0: null, op_1: null },
				errors: [{ message: "doc-level fail" }],
			}),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const results = await batchMutations([
			{ alias: "op_0", field: "issueUpdate", vars: { id: { type: "String!", value: "a" } } },
			{ alias: "op_1", field: "issueUpdate", vars: { id: { type: "String!", value: "b" } } },
		]);
		expect(results[0].ok).toBe(false);
		expect(results[0].error).toContain("doc-level fail");
		expect(results[1].error).toContain("doc-level fail");
	});

	it("respects batchSize and issues multiple requests", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ data: { op_0: { success: true } } }));
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const ops = [
			{ alias: "op_0", field: "f", vars: { id: { type: "String!", value: "1" } } },
			{ alias: "op_0", field: "f", vars: { id: { type: "String!", value: "2" } } },
			{ alias: "op_0", field: "f", vars: { id: { type: "String!", value: "3" } } },
		];
		await batchMutations(ops, { batchSize: 1 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

describe("resolveIssueIds", () => {
	it("returns empty map for empty input", async () => {
		const fetchMock = vi.fn();
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		expect(await resolveIssueIds([])).toEqual({});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("groups by team prefix and merges into one map", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						issues: {
							pageInfo: { hasNextPage: false, endCursor: null },
							nodes: [
								{ id: "uuid-eng-1", identifier: "ENG-1" },
								{ id: "uuid-eng-2", identifier: "ENG-2" },
							],
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						issues: {
							pageInfo: { hasNextPage: false, endCursor: null },
							nodes: [{ id: "uuid-ops-7", identifier: "OPS-7" }],
						},
					},
				}),
			);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const map = await resolveIssueIds(["ENG-1", "ENG-2", "OPS-7", "not-an-id"]);
		expect(map).toEqual({
			"ENG-1": "uuid-eng-1",
			"ENG-2": "uuid-eng-2",
			"OPS-7": "uuid-ops-7",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("paginates within a team when hasNextPage is true", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						issues: {
							pageInfo: { hasNextPage: true, endCursor: "c1" },
							nodes: [{ id: "uuid-eng-1", identifier: "ENG-1" }],
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					data: {
						issues: {
							pageInfo: { hasNextPage: false, endCursor: null },
							nodes: [{ id: "uuid-eng-2", identifier: "ENG-2" }],
						},
					},
				}),
			);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		const map = await resolveIssueIds(["ENG-1", "ENG-2"]);
		expect(Object.keys(map)).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const secondVars = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).variables;
		expect(secondVars.after).toBe("c1");
	});
});

describe("resolveStateId", () => {
	it("returns the matching state id (case-insensitive)", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				data: {
					team: {
						states: {
							nodes: [
								{ id: "todo-id", name: "Todo" },
								{ id: "done-id", name: "Done" },
							],
						},
					},
				},
			}),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		expect(await resolveStateId("ENG", "done")).toBe("done-id");
	});

	it("returns null when state not found", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ data: { team: { states: { nodes: [{ id: "todo", name: "Todo" }] } } } }),
		);
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		expect(await resolveStateId("ENG", "Done")).toBeNull();
	});

	it("returns null on missing team", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ data: { team: null } }));
		setFetchForTesting(fetchMock as unknown as typeof fetch);
		expect(await resolveStateId("X", "Done")).toBeNull();
	});
});
