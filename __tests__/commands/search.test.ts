import { describe, expect, it } from "vitest";

import { buildFilter, type SearchOptions } from "../../src/commands/search.js";

const baseOpts: SearchOptions = { limit: 25, output: "text" };

describe("buildFilter", () => {
	it("returns empty object when no filters are set", async () => {
		expect(await buildFilter(baseOpts)).toEqual({});
	});

	it("adds searchableContent for query", async () => {
		const f = await buildFilter({ ...baseOpts, query: "billing bug" });
		expect(f.searchableContent).toEqual({ contains: "billing bug" });
	});

	it("adds team filter", async () => {
		const f = await buildFilter({ ...baseOpts, team: "ENG" });
		expect(f.team).toEqual({ key: { eq: "ENG" } });
	});

	it("adds state filter (case-insensitive)", async () => {
		const f = await buildFilter({ ...baseOpts, state: "in progress" });
		expect(f.state).toEqual({ name: { eqIgnoreCase: "in progress" } });
	});

	it("adds assignee filter by name (case-insensitive)", async () => {
		const f = await buildFilter({ ...baseOpts, assignee: "Alice Smith" });
		expect(f.assignee).toEqual({ name: { eqIgnoreCase: "Alice Smith" } });
	});

	it("resolves assignee 'me' via client.viewer.id", async () => {
		// Minimal fake of LinearClient — only client.viewer is read.
		const fakeClient = { viewer: Promise.resolve({ id: "user-uuid-1" }) };
		const f = await buildFilter({ ...baseOpts, assignee: "me" }, fakeClient as never);
		expect(f.assignee).toEqual({ id: { eq: "user-uuid-1" } });
	});

	it("throws if assignee='me' but no client is provided", async () => {
		await expect(buildFilter({ ...baseOpts, assignee: "me" })).rejects.toThrow(/viewer/);
	});

	it("combines multiple filters", async () => {
		const f = await buildFilter({ ...baseOpts, query: "bug", team: "ENG", state: "Todo" });
		expect(f).toEqual({
			searchableContent: { contains: "bug" },
			team: { key: { eq: "ENG" } },
			state: { name: { eqIgnoreCase: "Todo" } },
		});
	});
});
