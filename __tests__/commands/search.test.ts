import { describe, expect, it } from "vitest";

import { buildFilter, parsePriority, type SearchOptions } from "../../src/commands/search.js";

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

	it("adds priority filter", async () => {
		const f = await buildFilter({ ...baseOpts, priority: 1 });
		expect(f.priority).toEqual({ eq: 1 });
	});

	it("adds priority filter for 'No priority' (0)", async () => {
		const f = await buildFilter({ ...baseOpts, priority: 0 });
		expect(f.priority).toEqual({ eq: 0 });
	});

	it("combines multiple filters", async () => {
		const f = await buildFilter({ ...baseOpts, query: "bug", team: "ENG", state: "Todo", priority: 1 });
		expect(f).toEqual({
			searchableContent: { contains: "bug" },
			team: { key: { eq: "ENG" } },
			state: { name: { eqIgnoreCase: "Todo" } },
			priority: { eq: 1 },
		});
	});
});

describe("parsePriority", () => {
	it("maps labels to Linear's 0-4 scale (case-insensitive)", () => {
		expect(parsePriority("urgent")).toBe(1);
		expect(parsePriority("High")).toBe(2);
		expect(parsePriority("MEDIUM")).toBe(3);
		expect(parsePriority("low")).toBe(4);
		expect(parsePriority("none")).toBe(0);
		expect(parsePriority("no priority")).toBe(0);
	});

	it("accepts raw numbers 0-4", () => {
		expect(parsePriority("0")).toBe(0);
		expect(parsePriority("4")).toBe(4);
	});

	it("rejects out-of-range numbers and junk", () => {
		expect(() => parsePriority("5")).toThrow(/priority/);
		expect(() => parsePriority("-1")).toThrow(/priority/);
		expect(() => parsePriority("highest")).toThrow(/priority/);
	});
});
