import { describe, expect, it } from "vitest";

import { type BulkOptions, buildBulkPlan, formatBulkPlan } from "../../src/commands/bulk.js";

const baseOpts: BulkOptions = { limit: 100, yes: false, output: "text" };

const sampleIssues = [
	{ identifier: "ENG-101", title: "Add bulk import", state: "Todo" },
	{ identifier: "ENG-102", title: "Fix flaky test", state: "Todo" },
];

describe("buildBulkPlan", () => {
	it("throws if no mutation is specified", () => {
		expect(() => buildBulkPlan(baseOpts, sampleIssues)).toThrow(/at least one of --set-state or --add-comment/);
	});

	it("plans state changes for non-matching state", () => {
		const plan = buildBulkPlan({ ...baseOpts, setState: "In Progress" }, sampleIssues);
		expect(plan.actions).toHaveLength(2);
		expect(plan.actions[0].changes.stateChange).toEqual({ from: "Todo", to: "In Progress" });
		expect(plan.actions[0].skipped).toBeUndefined();
	});

	it("skips issues already in the target state (case-insensitive)", () => {
		const plan = buildBulkPlan({ ...baseOpts, setState: "todo" }, sampleIssues);
		expect(plan.actions.every((a) => a.skipped)).toBe(true);
		expect(plan.actions[0].skipped?.reason).toContain('already in state "Todo"');
	});

	it("plans comments for every matched issue", () => {
		const plan = buildBulkPlan({ ...baseOpts, addComment: "see #ENG-99" }, sampleIssues);
		expect(plan.actions[0].changes.commentAdded).toBe("see #ENG-99");
		expect(plan.actions[1].changes.commentAdded).toBe("see #ENG-99");
	});

	it("reports dryRun=true when yes=false", () => {
		const plan = buildBulkPlan({ ...baseOpts, addComment: "hello" }, sampleIssues);
		expect(plan.dryRun).toBe(true);
	});

	it("reports dryRun=false when yes=true", () => {
		const plan = buildBulkPlan({ ...baseOpts, yes: true, addComment: "hello" }, sampleIssues);
		expect(plan.dryRun).toBe(false);
	});

	it("handles empty issue list", () => {
		const plan = buildBulkPlan({ ...baseOpts, addComment: "hi" }, []);
		expect(plan.actions).toEqual([]);
		expect(plan.totalMatched).toBe(0);
	});
});

describe("formatBulkPlan", () => {
	it("json mode round-trips", () => {
		const plan = buildBulkPlan({ ...baseOpts, setState: "In Progress" }, sampleIssues);
		expect(JSON.parse(formatBulkPlan(plan, "json"))).toEqual(plan);
	});

	it("text mode header reflects dry-run state", () => {
		const dry = buildBulkPlan({ ...baseOpts, setState: "In Progress" }, sampleIssues);
		expect(formatBulkPlan(dry, "text")).toContain("DRY RUN");
		const live = buildBulkPlan({ ...baseOpts, yes: true, setState: "In Progress" }, sampleIssues);
		expect(formatBulkPlan(live, "text")).toContain("Applied");
	});

	it("text mode lists every action", () => {
		const plan = buildBulkPlan({ ...baseOpts, setState: "In Progress" }, sampleIssues);
		const out = formatBulkPlan(plan, "text");
		expect(out).toContain("ENG-101");
		expect(out).toContain("ENG-102");
		expect(out).toContain("Todo → In Progress");
	});

	it("text mode shows SKIPPED reason", () => {
		const plan = buildBulkPlan({ ...baseOpts, setState: "Todo" }, sampleIssues);
		const out = formatBulkPlan(plan, "text");
		expect(out).toContain("SKIPPED");
	});

	it("text mode shows '(no matching issues)' on empty plan", () => {
		const plan = buildBulkPlan({ ...baseOpts, addComment: "hi" }, []);
		expect(formatBulkPlan(plan, "text")).toContain("no matching issues");
	});
});
