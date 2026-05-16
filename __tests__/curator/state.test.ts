import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	appendReportLine,
	type CuratorState,
	debounceKey,
	loadState,
	reportPath,
	resolveStateDir,
	saveState,
	statePath,
} from "../../src/curator/state.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "elnora-linear-curator-state-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("resolveStateDir", () => {
	it("honours explicit override", () => {
		expect(resolveStateDir({ stateDir: "/custom" })).toBe("/custom");
	});
	it("honours LINEAR_CURATOR_STATE_DIR env var", () => {
		const prev = process.env.LINEAR_CURATOR_STATE_DIR;
		process.env.LINEAR_CURATOR_STATE_DIR = "/env-override";
		try {
			expect(resolveStateDir({})).toBe("/env-override");
		} finally {
			if (prev === undefined) delete process.env.LINEAR_CURATOR_STATE_DIR;
			else process.env.LINEAR_CURATOR_STATE_DIR = prev;
		}
	});
});

describe("loadState / saveState round-trip", () => {
	it("returns an empty shape when no file present", () => {
		const state = loadState({ stateDir: dir });
		expect(state.version).toBe(1);
		expect(state.pending_questions).toEqual([]);
		expect(state.processed_thread_keys).toEqual([]);
	});

	it("persists and reloads pending questions + processed keys", () => {
		const state: CuratorState = {
			version: 1,
			pending_questions: [{ issue_id: "ENG-1", thread_key: "k1", posted_at: "2026-05-15", question_text: "?" }],
			processed_thread_keys: ["k0"],
			out_of_band_queue: [],
			last_run_ended_at: "2026-05-15T00:00:00Z",
			stats: [],
		};
		saveState(state, { stateDir: dir });
		expect(existsSync(statePath({ stateDir: dir }))).toBe(true);

		const reloaded = loadState({ stateDir: dir });
		expect(reloaded.pending_questions).toHaveLength(1);
		expect(reloaded.processed_thread_keys).toEqual(["k0"]);
	});

	it("recovers gracefully from malformed state file", () => {
		const path = statePath({ stateDir: dir });
		// Manually create a state file with garbage.
		const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, "not json");
		const state = loadState({ stateDir: dir });
		expect(state.pending_questions).toEqual([]);
	});

	it("trims processed_thread_keys past the cap", () => {
		const state: CuratorState = {
			version: 1,
			pending_questions: [],
			processed_thread_keys: Array.from({ length: 1200 }, (_, i) => `k${i}`),
			out_of_band_queue: [],
			last_run_ended_at: null,
			stats: [],
		};
		saveState(state, { stateDir: dir });
		const reloaded = loadState({ stateDir: dir });
		expect(reloaded.processed_thread_keys.length).toBeLessThanOrEqual(1000);
		expect(reloaded.processed_thread_keys[0]).not.toBe("k0");
	});
});

describe("appendReportLine", () => {
	it("appends a JSON line to the report file with a timestamp", () => {
		appendReportLine({ tier: "HIGH", issue: "ENG-1" }, { stateDir: dir });
		const raw = readFileSync(reportPath({ stateDir: dir }), "utf-8").trim();
		const parsed = JSON.parse(raw);
		expect(parsed.tier).toBe("HIGH");
		expect(parsed.issue).toBe("ENG-1");
		expect(typeof parsed._ts).toBe("string");
	});
});

describe("debounceKey", () => {
	it("is stable for the same input", () => {
		expect(debounceKey("ENG-1", { type: "set_state", from: "Todo", to: "Done" })).toBe(
			debounceKey("ENG-1", { type: "set_state", from: "Todo", to: "Done" }),
		);
	});
	it("differs for different actions", () => {
		expect(debounceKey("ENG-1", { to: "Done" })).not.toBe(debounceKey("ENG-1", { to: "Canceled" }));
	});
});
