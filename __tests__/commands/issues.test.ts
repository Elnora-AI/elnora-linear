import { describe, expect, it } from "vitest";

import { buildBatchCreateInput, type FriendlyLookups, resolveBulkOpTeamKey } from "../../src/commands/issues.js";

describe("resolveBulkOpTeamKey", () => {
	const teamMap = {
		ENG: { id: "team-eng", key: "ENG" },
		Engineering: { id: "team-eng", key: "ENG" },
		SEC: { id: "team-sec", key: "SEC" },
	};

	it("uses explicit op.team when present + resolvable", () => {
		expect(resolveBulkOpTeamKey({ team: "Engineering" }, teamMap, "OPS")).toBe("ENG");
		expect(resolveBulkOpTeamKey({ team: "SEC" }, teamMap, "OPS")).toBe("SEC");
	});

	it("falls back to default when op.team is unknown", () => {
		expect(resolveBulkOpTeamKey({ team: "DoesNotExist" }, teamMap, "OPS")).toBe("OPS");
	});

	it("derives team from issue prefix on update ops (cross-team safeguard)", () => {
		expect(resolveBulkOpTeamKey({ kind: "update", id: "SEC-5" }, teamMap, "ENG")).toBe("SEC");
		expect(resolveBulkOpTeamKey({ kind: "update", id: "ENG-99" }, teamMap, "OPS")).toBe("ENG");
	});

	it("uses default when update id has no prefix match", () => {
		expect(resolveBulkOpTeamKey({ kind: "update", id: "not-an-identifier" }, teamMap, "OPS")).toBe("OPS");
	});

	it("uses default when op has no team and is not an update", () => {
		expect(resolveBulkOpTeamKey({ kind: "create", title: "x" }, teamMap, "OPS")).toBe("OPS");
		expect(resolveBulkOpTeamKey({ kind: "comment" }, teamMap, "OPS")).toBe("OPS");
	});

	it("explicit op.team beats id-derived prefix", () => {
		expect(resolveBulkOpTeamKey({ team: "SEC", kind: "update", id: "ENG-5" }, teamMap, "OPS")).toBe("SEC");
	});
});

describe("buildBatchCreateInput", () => {
	const lookups: FriendlyLookups = {
		teams: new Map([
			["eng", { id: "team-eng", name: "Engineering", key: "ENG" }],
			["engineering", { id: "team-eng", name: "Engineering", key: "ENG" }],
			["team-eng", { id: "team-eng", name: "Engineering", key: "ENG" }],
		]),
		projects: new Map([
			["apollo", { id: "proj-1", name: "Apollo" }],
			["proj-1", { id: "proj-1", name: "Apollo" }],
		]),
		users: new Map([
			["alice@example.com", { id: "user-alice", name: "Alice" }],
			["alice", { id: "user-alice", name: "Alice" }],
		]),
		labels: new Map([
			["backend", { id: "label-be", name: "backend" }],
			["bug", { id: "label-bug", name: "bug" }],
		]),
		states: new Map([["team-eng\ntodo", { id: "state-todo", name: "Todo" }]]),
		parents: new Map([["eng-12", { id: "issue-parent", identifier: "ENG-12" }]]),
	};

	it("resolves friendly names to UUIDs", () => {
		const { input, display } = buildBatchCreateInput(
			{
				title: "Add SSO",
				team: "ENG",
				project: "Apollo",
				assignee: "alice@example.com",
				labels: ["backend", "bug"],
				state: "Todo",
				priority: 1,
			},
			0,
			lookups,
		);
		expect(input).toMatchObject({
			teamId: "team-eng",
			title: "Add SSO",
			projectId: "proj-1",
			assigneeId: "user-alice",
			labelIds: ["label-be", "label-bug"],
			stateId: "state-todo",
			priority: 1,
		});
		expect(display).toEqual({
			title: "Add SSO",
			team: "Engineering",
			project: "Apollo",
			assignee: "Alice",
			labels: ["backend", "bug"],
			state: "Todo",
			priority: 1,
		});
	});

	it("accepts comma-separated labels and a numeric-string priority", () => {
		const { input } = buildBatchCreateInput(
			{ title: "x", team: "ENG", labels: "backend, bug", priority: "2" },
			0,
			lookups,
		);
		expect(input.labelIds).toEqual(["label-be", "label-bug"]);
		expect(input.priority).toBe(2);
	});

	it("passes raw IDs through unchanged", () => {
		const { input } = buildBatchCreateInput(
			{ title: "x", teamId: "team-eng", projectId: "proj-1", labelIds: ["label-be"], stateId: "state-todo" },
			0,
			lookups,
		);
		expect(input).toMatchObject({
			teamId: "team-eng",
			projectId: "proj-1",
			labelIds: ["label-be"],
			stateId: "state-todo",
		});
	});

	it("resolves a parent identifier", () => {
		const { input } = buildBatchCreateInput({ title: "x", team: "ENG", parent: "ENG-12" }, 0, lookups);
		expect(input.parentId).toBe("issue-parent");
	});

	it("throws on a missing title, naming the 1-based index", () => {
		expect(() => buildBatchCreateInput({ team: "ENG" }, 4, lookups)).toThrow(/Issue #5.*title/);
	});

	it("throws when neither team nor teamId is given", () => {
		expect(() => buildBatchCreateInput({ title: "x" }, 0, lookups)).toThrow(/team/);
	});

	it("throws on an unknown label", () => {
		expect(() => buildBatchCreateInput({ title: "x", team: "ENG", labels: ["nope"] }, 0, lookups)).toThrow(/nope/);
	});

	it("throws on an unknown state for the resolved team", () => {
		expect(() => buildBatchCreateInput({ title: "x", team: "ENG", state: "Shipped" }, 0, lookups)).toThrow(/Shipped/);
	});
});
