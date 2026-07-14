import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatchActions } from "../../src/curator/dispatch.js";
import type { CuratorAction } from "../../src/curator/llm.js";
import type { CuratorState } from "../../src/curator/state.js";

let stateDir: string;

beforeEach(() => {
	stateDir = mkdtempSync(join(tmpdir(), "elnora-linear-dispatch-"));
});

afterEach(() => {
	rmSync(stateDir, { recursive: true, force: true });
});

function emptyState(): CuratorState {
	return {
		version: 1,
		pending_questions: [],
		processed_thread_keys: [],
		out_of_band_queue: [],
		last_run_ended_at: null,
		stats: [],
	};
}

const fakeClient = {
	issue: async () => ({ id: "uuid-1", identifier: "ENG-1" }),
	updateIssue: async () => ({ success: true }),
	createComment: async () => ({ success: true }),
} as unknown as import("@linear/sdk").LinearClient;

describe("dispatchActions", () => {
	it("reports LOW actions without side effects", async () => {
		const state = emptyState();
		const actions: CuratorAction[] = [
			{ issue_id: "ENG-1", tier: "LOW", rule: "L1", rationale: "stale", decision: "report_only" },
		];
		const result = await dispatchActions(fakeClient, actions, state, { stateDir });
		expect(result.reported).toHaveLength(1);
		expect(result.applied).toHaveLength(0);
		expect(result.queued).toHaveLength(0);
	});

	it("queues MEDIUM actions as pending questions on state", async () => {
		const state = emptyState();
		const actions: CuratorAction[] = [
			{
				issue_id: "ENG-1",
				tier: "MEDIUM",
				rule: "M1",
				rationale: "commits but no PR",
				decision: "ask_in_slack",
				proposed_action: { type: "set_state", from: "Todo", to: "In Progress" },
				question_text: "still active?",
				signals_cited: ["commit"],
			},
		];
		const result = await dispatchActions(fakeClient, actions, state, { stateDir });
		expect(result.queued).toHaveLength(1);
		expect(state.pending_questions).toHaveLength(1);
	});

	it("applies HIGH actions only in non-dry-run mode", async () => {
		const state = emptyState();
		const highAction: CuratorAction = {
			issue_id: "ENG-1",
			tier: "HIGH",
			rule: "H1",
			rationale: "PR merged",
			decision: "set_state",
			from_state: "Todo",
			to_state: "Done",
			signals_cited: ["PR #123"],
		};
		const dry = await dispatchActions(fakeClient, [highAction], emptyState(), { stateDir, dryRun: true });
		expect(dry.applied).toHaveLength(1);
		const wet = await dispatchActions(fakeClient, [highAction], state, {
			stateDir,
			applyHigh: async () => ({ ok: true }),
		});
		expect(wet.applied).toHaveLength(1);
		expect(state.processed_thread_keys.length).toBe(1);
	});

	it("caps HIGH actions at maxMutations", async () => {
		const state = emptyState();
		const actions: CuratorAction[] = Array.from({ length: 5 }, (_, i) => ({
			issue_id: `ENG-${i}`,
			tier: "HIGH" as const,
			rule: "H1",
			rationale: "x",
			decision: "set_state" as const,
			from_state: "Todo",
			to_state: "Done",
			signals_cited: [],
		}));
		const result = await dispatchActions(fakeClient, actions, state, { stateDir, maxMutations: 2, dryRun: true });
		expect(result.applied).toHaveLength(2);
		expect(result.skipped.filter((s) => s.reason === "cap_high")).toHaveLength(3);
	});

	it("debounces MEDIUM actions already queued", async () => {
		const state = emptyState();
		state.pending_questions = [
			{
				issue_id: "ENG-1",
				thread_key: `ENG-1:${JSON.stringify({ type: "set_state", from: "Todo", to: "Done" })}`,
				posted_at: "2026-05-10",
				question_text: "?",
			},
		];
		const actions: CuratorAction[] = [
			{
				issue_id: "ENG-1",
				tier: "MEDIUM",
				rule: "M1",
				rationale: "x",
				decision: "ask_in_slack",
				proposed_action: { type: "set_state", from: "Todo", to: "Done" },
				question_text: "?",
				signals_cited: [],
			},
		];
		const result = await dispatchActions(fakeClient, actions, state, { stateDir });
		expect(result.queued).toHaveLength(0);
		expect(result.skipped[0].reason).toBe("debounced");
	});

	it("skips MEDIUM actions without question_text instead of staging them", async () => {
		const state = emptyState();
		const actions: CuratorAction[] = [
			{
				issue_id: "ENG-1",
				tier: "MEDIUM",
				rule: "M1",
				rationale: "x",
				decision: "ask_in_slack",
				proposed_action: { type: "set_state", from: "In Review", to: "In Progress" },
				question_text: "",
				signals_cited: [],
			},
			{
				issue_id: "ENG-2",
				tier: "MEDIUM",
				rule: "M1",
				rationale: "x",
				decision: "ask_in_slack",
				proposed_action: { type: "set_state", from: "Todo", to: "Done" },
				question_text: "real question?",
				signals_cited: [],
			},
		];
		const result = await dispatchActions(fakeClient, actions, state, { stateDir });
		expect(result.skipped.filter((s) => s.reason === "missing_question_text")).toHaveLength(1);
		expect(result.queued).toHaveLength(1);
		expect(state.pending_questions).toHaveLength(1);
		expect(state.pending_questions[0].issue_id).toBe("ENG-2");
	});
});
