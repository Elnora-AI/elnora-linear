import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchActions } from "../../src/curator/dispatch.js";
import { validateJevAnswer } from "../../src/curator/jev.js";
import type { CuratorAction } from "../../src/curator/llm.js";
import type { CuratorState } from "../../src/curator/state.js";

let stateDir: string;

beforeEach(() => {
	stateDir = mkdtempSync(join(tmpdir(), "elnora-linear-dispatch-"));
});

afterEach(() => {
	rmSync(stateDir, { recursive: true, force: true });
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
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
		const dry = await dispatchActions(fakeClient, [highAction], emptyState(), {
			stateDir,
			dryRun: true,
			confirmHigh: async () => true,
		});
		expect(dry.applied).toHaveLength(1);
		const wet = await dispatchActions(fakeClient, [highAction], state, {
			stateDir,
			applyHigh: async () => ({ ok: true }),
			confirmHigh: async () => true,
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
		const result = await dispatchActions(fakeClient, actions, state, {
			stateDir,
			maxMutations: 2,
			dryRun: true,
			confirmHigh: async () => true,
		});
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

// ---------------------------------------------------------------------------
// HIGH auto-apply is gated by TypeSafe Jev (fetch is faked; no network)
// ---------------------------------------------------------------------------

const JEV_VERSION = "typesafe/jev-1.13-20260917";

function jevBody(choice: string, confidence: number, model = JEV_VERSION): unknown {
	const labels = ["done", "not_done", "unclear"];
	const probabilities = Object.fromEntries(
		labels.map((l) => [l, l === choice ? confidence : (1 - confidence) / (labels.length - 1)]),
	);
	return { model, answers: { q: { choice, confidence, probabilities } } };
}

/** Stub global fetch with a Jev answer (or a rejection) and record the calls. */
function fakeJev(answer: unknown | Error) {
	const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
		if (answer instanceof Error) throw answer;
		return new Response(JSON.stringify(answer), { status: 200 });
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const high: CuratorAction = {
	issue_id: "ENG-7",
	tier: "HIGH",
	rule: "H1",
	rationale: "PR merged and deployed",
	decision: "set_state",
	from_state: "In Progress",
	to_state: "Done",
	signals_cited: ["PR #42 merged"],
};

async function runHigh(state = emptyState()) {
	const applyHigh = vi.fn(async () => ({ ok: true as const }));
	const result = await dispatchActions(fakeClient, [high], state, { stateDir, applyHigh });
	return { result, applyHigh, state };
}

function expectAskedNotApplied(r: Awaited<ReturnType<typeof runHigh>>) {
	expect(r.applyHigh).not.toHaveBeenCalled();
	expect(r.result.applied).toHaveLength(0);
	expect(r.result.queued).toHaveLength(1);
	expect(r.state.pending_questions[0].thread_key).toBe(
		`ENG-7:${JSON.stringify({ type: "set_state", from: "In Progress", to: "Done" })}`,
	);
	expect(r.state.pending_questions[0].question_text).toContain("PR merged and deployed");
}

describe("HIGH gate (Jev)", () => {
	beforeEach(() => {
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
	});

	it("auto-applies at exactly the 0.95 threshold", async () => {
		fakeJev(jevBody("done", 0.95));
		const r = await runHigh();
		expect(r.applyHigh).toHaveBeenCalledOnce();
		expect(r.result.applied).toHaveLength(1);
		expect(r.result.queued).toHaveLength(0);
	});

	it("asks a person just below the threshold", async () => {
		fakeJev(jevBody("done", 0.9499));
		expectAskedNotApplied(await runHigh());
	});

	it("asks a person when Jev says not_done or unclear", async () => {
		fakeJev(jevBody("not_done", 0.99));
		expectAskedNotApplied(await runHigh());
		fakeJev(jevBody("unclear", 0.99));
		expectAskedNotApplied(await runHigh());
	});

	it("asks a person when a confident answer comes from a non-Jev model", async () => {
		fakeJev(jevBody("done", 0.99, "openai/gpt-5"));
		expectAskedNotApplied(await runHigh());
	});

	it("asks a person when Jev is down", async () => {
		fakeJev(new TypeError("fetch failed"));
		expectAskedNotApplied(await runHigh());
	});

	it("asks a person when Jev returns an HTTP error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("upstream error", { status: 502 })),
		);
		expectAskedNotApplied(await runHigh());
	});

	it("asks a person and makes no request when OPENROUTER_API_KEY is missing", async () => {
		vi.stubEnv("OPENROUTER_API_KEY", "");
		const fetchMock = fakeJev(jevBody("done", 0.99));
		expectAskedNotApplied(await runHigh());
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("gates dry runs too", async () => {
		fakeJev(jevBody("done", 0.5));
		const result = await dispatchActions(fakeClient, [high], emptyState(), { stateDir, dryRun: true });
		expect(result.applied).toHaveLength(0);
		expect(result.queued).toHaveLength(1);
	});

	it("does not re-ask a downgraded HIGH that is already pending", async () => {
		fakeJev(jevBody("done", 0.6));
		const first = await runHigh();
		const second = await runHigh(first.state);
		expect(second.result.queued).toHaveLength(0);
		expect(second.result.skipped[0].reason).toBe("debounced");
		expect(second.state.pending_questions).toHaveLength(1);
	});

	it("sends the evidence and the done/not_done/unclear criteria to Jev", async () => {
		const fetchMock = fakeJev(jevBody("done", 0.99));
		await runHigh();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://openrouter.ai/api/v1/systemone");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
		expect(init.signal).toBeInstanceOf(AbortSignal);
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe("~typesafe/jev-latest");
		expect(body.state).toContain("PR #42 merged");
		expect(Object.keys(body.questions.q.criteria).sort()).toEqual(["done", "not_done", "unclear"]);
	});
});

describe("validateJevAnswer", () => {
	const criteria = { done: "d", not_done: "n", unclear: "u" };
	const good = () => jevBody("done", 0.97) as { model: unknown; answers: { q: Record<string, unknown> } };
	const bad: Record<string, (b: ReturnType<typeof good>) => void> = {
		"label outside criteria": (b) => {
			b.answers.q.choice = "closed";
		},
		"confidence NaN": (b) => {
			b.answers.q.confidence = Number.NaN;
		},
		"confidence bool": (b) => {
			b.answers.q.confidence = true;
		},
		"confidence string": (b) => {
			b.answers.q.confidence = "0.97";
		},
		"confidence above 1": (b) => {
			b.answers.q.confidence = 1.2;
		},
		"probability negative": (b) => {
			(b.answers.q.probabilities as Record<string, unknown>).unclear = -0.1;
		},
		"probability string": (b) => {
			(b.answers.q.probabilities as Record<string, unknown>).unclear = "0.01";
		},
		"chosen label missing from probabilities": (b) => {
			delete (b.answers.q.probabilities as Record<string, unknown>).done;
		},
		"confidence disagrees with probabilities": (b) => {
			(b.answers.q.probabilities as Record<string, unknown>).done = 0.8;
		},
		"no model": (b) => {
			b.model = undefined;
		},
	};

	it("accepts a well-formed answer", () => {
		expect(validateJevAnswer(good(), criteria)).toEqual({ choice: "done", confidence: 0.97, model: JEV_VERSION });
	});

	for (const [name, mutate] of Object.entries(bad)) {
		it(`rejects: ${name}`, () => {
			const b = good();
			mutate(b);
			expect(() => validateJevAnswer(b, criteria)).toThrow();
		});
	}

	it("rejects a body without answers", () => {
		expect(() => validateJevAnswer({ model: JEV_VERSION }, criteria)).toThrow();
		expect(() => validateJevAnswer(null, criteria)).toThrow();
	});

	it("an invalid answer never auto-applies", async () => {
		vi.stubEnv("OPENROUTER_API_KEY", "test-key");
		const b = good();
		b.answers.q.confidence = Number.NaN;
		fakeJev(b);
		expectAskedNotApplied(await runHigh());
	});
});
