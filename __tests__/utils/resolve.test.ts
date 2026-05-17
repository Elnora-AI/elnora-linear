import { describe, expect, it, vi } from "vitest";

import { findIssueByIdentifier, isUUID, NotFoundError, resolveInitiative } from "../../src/utils/index.js";

// Minimal stand-ins for the slice of LinearClient each helper actually touches.
// Typed as `unknown as LinearClient` at the callsite so we don't have to bring
// the full SDK surface into the test.
type IssuesCall = {
	filter?: { team?: { key?: { eq?: string } }; number?: { eq?: number } };
	first?: number;
	includeArchived?: boolean;
};
type InitiativesCall = {
	filter?: { id?: { eq?: string } };
	first?: number;
	includeArchived?: boolean;
};

function makeIssuesClient(nodes: Array<Record<string, unknown>>) {
	const calls: IssuesCall[] = [];
	const client = {
		issue: vi.fn(async (id: string) => ({ id, identifier: "UUID-FETCH" })),
		issues: vi.fn(async (args: IssuesCall) => {
			calls.push(args);
			return { nodes };
		}),
	};
	return { client, calls };
}

function makeInitiativesClient(nodes: Array<Record<string, unknown>>) {
	const calls: InitiativesCall[] = [];
	const client = {
		initiative: vi.fn(async (id: string) => ({ id, name: "should-not-be-called" })),
		initiatives: vi.fn(async (args: InitiativesCall) => {
			calls.push(args);
			return {
				nodes,
				pageInfo: { hasNextPage: false },
				fetchNext: async () => ({ nodes: [], pageInfo: { hasNextPage: false }, fetchNext: async () => null }),
			};
		}),
	};
	return { client, calls };
}

describe("findIssueByIdentifier", () => {
	it("excludes archived rows by default (regression: archive is one-way without this fix)", async () => {
		const { client, calls } = makeIssuesClient([{ id: "uuid-1", identifier: "ENG-1" }]);
		// biome-ignore lint/suspicious/noExplicitAny: minimal mock
		await findIssueByIdentifier(client as any, "ENG-1");
		expect(calls).toHaveLength(1);
		expect(calls[0].includeArchived).toBe(false);
		expect(calls[0].filter?.team?.key?.eq).toBe("ENG");
		expect(calls[0].filter?.number?.eq).toBe(1);
	});

	it("passes includeArchived: true so restore can resolve archived issues", async () => {
		const { client, calls } = makeIssuesClient([
			{ id: "uuid-1", identifier: "ENG-1", archivedAt: "2026-05-17T00:00:00Z" },
		]);
		// biome-ignore lint/suspicious/noExplicitAny: minimal mock
		const issue = await findIssueByIdentifier(client as any, "ENG-1", { includeArchived: true });
		expect(calls[0].includeArchived).toBe(true);
		expect(issue.identifier).toBe("ENG-1");
	});

	it("throws NotFoundError when no match (even with includeArchived)", async () => {
		const { client } = makeIssuesClient([]);
		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: minimal mock
			findIssueByIdentifier(client as any, "MISSING-99", { includeArchived: true }),
		).rejects.toThrow(NotFoundError);
	});

	it("routes UUID identifiers through client.issue() (which returns archived rows)", async () => {
		const uuid = "11111111-2222-3333-4444-555555555555";
		const { client } = makeIssuesClient([]);
		// biome-ignore lint/suspicious/noExplicitAny: minimal mock
		const issue = await findIssueByIdentifier(client as any, uuid);
		expect(client.issue).toHaveBeenCalledWith(uuid);
		expect(client.issues).not.toHaveBeenCalled();
		expect(issue.id).toBe(uuid);
	});
});

describe("resolveInitiative", () => {
	const ARCHIVED_UUID = "aaaaaaaa-1111-2222-3333-444444444444";
	const LIVE_UUID = "bbbbbbbb-1111-2222-3333-444444444444";
	const archivedRow = { id: ARCHIVED_UUID, name: "Old Initiative", archivedAt: new Date("2026-05-17") };
	const liveRow = { id: LIVE_UUID, name: "Active Initiative", archivedAt: null };

	it("UUID path uses the filter-based connection (not singular query) so includeArchived applies", async () => {
		const { client, calls } = makeInitiativesClient([archivedRow]);
		// biome-ignore lint/suspicious/noExplicitAny: minimal mock
		const result = await resolveInitiative(client as any, archivedRow.id, { includeArchived: true });
		expect(result.id).toBe(archivedRow.id);
		expect(result.archivedAt).toEqual(archivedRow.archivedAt);
		// The singular initiative(id) query has no includeArchived arg, so we MUST go
		// through initiatives({filter: {id}}) — that's the whole point of the fix.
		expect(client.initiative).not.toHaveBeenCalled();
		expect(calls[0].includeArchived).toBe(true);
		expect(calls[0].filter?.id?.eq).toBe(archivedRow.id);
	});

	it("name path passes includeArchived through to the connection", async () => {
		const { client, calls } = makeInitiativesClient([archivedRow]);
		// biome-ignore lint/suspicious/noExplicitAny: minimal mock
		const result = await resolveInitiative(client as any, archivedRow.name, { includeArchived: true });
		expect(result.id).toBe(archivedRow.id);
		expect(calls[0].includeArchived).toBe(true);
	});

	it("defaults to includeArchived: false (preserves prior behavior for non-restore paths)", async () => {
		const { client, calls } = makeInitiativesClient([liveRow]);
		// biome-ignore lint/suspicious/noExplicitAny: minimal mock
		await resolveInitiative(client as any, liveRow.id);
		expect(calls[0].includeArchived).toBe(false);
	});

	it("surfaces archivedAt so callers can short-circuit redundant archives", async () => {
		const { client } = makeInitiativesClient([archivedRow]);
		// biome-ignore lint/suspicious/noExplicitAny: minimal mock
		const result = await resolveInitiative(client as any, archivedRow.id, { includeArchived: true });
		expect(result.archivedAt).not.toBeNull();
	});

	it("throws NotFoundError when no match", async () => {
		const { client } = makeInitiativesClient([]);
		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: minimal mock
			resolveInitiative(client as any, "11111111-2222-3333-4444-555555555555", { includeArchived: true }),
		).rejects.toThrow(NotFoundError);
	});
});

describe("isUUID", () => {
	it("accepts canonical v4 form", () => {
		expect(isUUID("11111111-2222-3333-4444-555555555555")).toBe(true);
	});

	it("rejects identifier-style strings", () => {
		expect(isUUID("ENG-123")).toBe(false);
		expect(isUUID("not-a-uuid")).toBe(false);
	});
});
