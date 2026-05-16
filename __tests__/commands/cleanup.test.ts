import { describe, expect, it } from "vitest";

import { buildCleanupPlan, type CleanupOptions, formatCleanupPlan } from "../../src/commands/cleanup.js";

const NOW = new Date("2026-05-16T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const baseOpts: CleanupOptions = {
	inactiveDays: 30,
	action: "comment",
	limit: 100,
	yes: false,
	output: "text",
};

const issues = [
	{ identifier: "ENG-1", title: "Fresh issue", state: "Todo", updatedAt: daysAgo(5) },
	{ identifier: "ENG-2", title: "Stale issue", state: "Todo", updatedAt: daysAgo(45) },
	{ identifier: "ENG-3", title: "Very stale", state: "Backlog", updatedAt: daysAgo(120) },
];

describe("buildCleanupPlan", () => {
	it("only includes issues older than inactiveDays", () => {
		const plan = buildCleanupPlan(baseOpts, issues, NOW);
		expect(plan.actions.map((a) => a.issueIdentifier)).toEqual(["ENG-2", "ENG-3"]);
		expect(plan.totalConsidered).toBe(3);
	});

	it("computes daysInactive correctly", () => {
		const plan = buildCleanupPlan(baseOpts, issues, NOW);
		expect(plan.actions[0].daysInactive).toBe(45);
		expect(plan.actions[1].daysInactive).toBe(120);
	});

	it("action='close' proposes state→completed", () => {
		const plan = buildCleanupPlan({ ...baseOpts, action: "close" }, issues, NOW);
		expect(plan.actions[0].proposed.setStateType).toBe("completed");
	});

	it("action='cancel' proposes state→canceled", () => {
		const plan = buildCleanupPlan({ ...baseOpts, action: "cancel" }, issues, NOW);
		expect(plan.actions[0].proposed.setStateType).toBe("canceled");
	});

	it("action='comment' with no message uses a default templated message", () => {
		const plan = buildCleanupPlan(baseOpts, issues, NOW);
		expect(plan.actions[0].proposed.setStateType).toBeUndefined();
		expect(plan.actions[0].proposed.addComment).toContain("45 days");
	});

	it("custom --message overrides the default", () => {
		const plan = buildCleanupPlan({ ...baseOpts, message: "please refresh" }, issues, NOW);
		expect(plan.actions[0].proposed.addComment).toBe("please refresh");
	});

	it("close+message produces both state change and comment", () => {
		const plan = buildCleanupPlan({ ...baseOpts, action: "close", message: "auto-closed" }, issues, NOW);
		expect(plan.actions[0].proposed.setStateType).toBe("completed");
		expect(plan.actions[0].proposed.addComment).toBe("auto-closed");
	});

	it("reports dryRun=true when yes=false", () => {
		expect(buildCleanupPlan(baseOpts, issues, NOW).dryRun).toBe(true);
	});

	it("reports dryRun=false when yes=true", () => {
		expect(buildCleanupPlan({ ...baseOpts, yes: true }, issues, NOW).dryRun).toBe(false);
	});

	it("returns empty actions when nothing is stale", () => {
		const fresh = [{ identifier: "ENG-1", title: "Fresh", state: "Todo", updatedAt: daysAgo(5) }];
		const plan = buildCleanupPlan(baseOpts, fresh, NOW);
		expect(plan.actions).toEqual([]);
		expect(plan.totalConsidered).toBe(1);
	});
});

describe("formatCleanupPlan", () => {
	it("json mode round-trips", () => {
		const plan = buildCleanupPlan(baseOpts, issues, NOW);
		expect(JSON.parse(formatCleanupPlan(plan, "json"))).toEqual(plan);
	});

	it("text mode header reflects dry-run", () => {
		const dry = buildCleanupPlan(baseOpts, issues, NOW);
		expect(formatCleanupPlan(dry, "text")).toContain("DRY RUN");
		const live = buildCleanupPlan({ ...baseOpts, yes: true }, issues, NOW);
		expect(formatCleanupPlan(live, "text")).toContain("Acted on");
	});

	it("text mode shows '(nothing to do)' on empty plan", () => {
		const fresh = [{ identifier: "ENG-1", title: "Fresh", state: "Todo", updatedAt: daysAgo(5) }];
		expect(formatCleanupPlan(buildCleanupPlan(baseOpts, fresh, NOW), "text")).toContain("nothing to do");
	});

	it("text mode includes daysInactive per action", () => {
		const out = formatCleanupPlan(buildCleanupPlan({ ...baseOpts, action: "close" }, issues, NOW), "text");
		expect(out).toContain("45d inactive");
		expect(out).toContain("120d inactive");
		expect(out).toContain("state → completed");
	});
});
