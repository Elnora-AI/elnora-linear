import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	mapProject,
	mapProjectStatus,
	mapTeam,
	mapUser,
	mapWorkflowState,
	planImport,
	resolveSyncWriteDir,
	runSyncImport,
	runSyncVerify,
} from "../../src/commands/sync.js";

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "elnora-linear-sync-"));
	originalEnv = process.env.LINEAR_REFERENCES_DIR;
	delete process.env.LINEAR_REFERENCES_DIR;
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	if (originalEnv === undefined) delete process.env.LINEAR_REFERENCES_DIR;
	else process.env.LINEAR_REFERENCES_DIR = originalEnv;
});

describe("mapTeam", () => {
	it("returns key + name", () => {
		expect(mapTeam({ key: "ENG", name: "Engineering" })).toEqual({ key: "ENG", name: "Engineering" });
	});

	it("omits description when null", () => {
		expect(mapTeam({ key: "ENG", name: "Engineering", description: null })).toEqual({
			key: "ENG",
			name: "Engineering",
		});
	});

	it("includes description when present", () => {
		const out = mapTeam({ key: "ENG", name: "Engineering", description: "Core team" });
		expect(out.description).toBe("Core team");
	});
});

describe("mapProjectStatus", () => {
	it.each([
		["backlog", "Backlog"],
		["planned", "Planned"],
		["started", "In Progress"],
		["paused", "In Progress"],
		["completed", "Completed"],
		["canceled", "Canceled"],
	])("maps %s -> %s", (input, expected) => {
		expect(mapProjectStatus(input)).toBe(expected);
	});

	it("returns undefined for null", () => {
		expect(mapProjectStatus(null)).toBeUndefined();
	});

	it("returns undefined for unknown state", () => {
		expect(mapProjectStatus("weird")).toBeUndefined();
	});

	it("is case-insensitive", () => {
		expect(mapProjectStatus("STARTED")).toBe("In Progress");
	});
});

describe("mapProject", () => {
	it("includes team key", () => {
		const out = mapProject({ name: "Backend", state: "started" }, "ENG");
		expect(out.team).toBe("ENG");
		expect(out.status).toBe("In Progress");
	});

	it("omits status when state is null", () => {
		const out = mapProject({ name: "Backend", state: null }, "ENG");
		expect(out.status).toBeUndefined();
	});
});

describe("mapUser", () => {
	it("derives key from displayName", () => {
		const out = mapUser({ id: "u1", name: "Alice Smith", displayName: "alice.smith", email: "alice@example.com" });
		expect(out.key).toBe("alice.smith".replace(/[^a-z0-9_-]+/g, "-"));
		expect(out.linear_user_id).toBe("u1");
	});

	it("falls back to email local-part when displayName is missing", () => {
		const out = mapUser({ id: "u2", name: "Bob", email: "bob@example.com" });
		expect(out.key).toBe("bob");
	});

	it("falls back to name when neither displayName nor email exist", () => {
		const out = mapUser({ id: "u3", name: "Carol" });
		expect(out.key).toBe("carol");
	});

	it("strips problematic characters from key", () => {
		const out = mapUser({ id: "u4", name: "User", displayName: "Test User!@#" });
		expect(out.key).toMatch(/^[a-z0-9_-]+$/);
	});

	it("omits email when null", () => {
		const out = mapUser({ id: "u5", name: "NoEmail", email: null });
		expect(out.email).toBeUndefined();
	});
});

describe("mapWorkflowState", () => {
	it.each(["backlog", "unstarted", "started", "completed", "canceled", "triage"])("accepts known type %s", (type) => {
		expect(mapWorkflowState({ name: "X", type })).toEqual({ name: "X", type });
	});

	it("returns null for unknown type", () => {
		expect(mapWorkflowState({ name: "X", type: "weird" })).toBeNull();
	});
});

describe("planImport", () => {
	it("returns matching top-level keys", () => {
		expect(planImport({ teams: {}, projects: {}, other: 1 })).toEqual(["teams", "projects"]);
	});

	it("throws when input is not an object", () => {
		expect(() => planImport("nope")).toThrow(/JSON object/);
	});

	it("throws when no reference-name keys are present", () => {
		expect(() => planImport({ unrelated: 1 })).toThrow(/bundle with top-level keys/);
	});
});

describe("resolveSyncWriteDir", () => {
	it("returns explicit override", () => {
		expect(resolveSyncWriteDir(tmp)).toBe(tmp);
	});

	it("returns LINEAR_REFERENCES_DIR when set", () => {
		process.env.LINEAR_REFERENCES_DIR = tmp;
		expect(resolveSyncWriteDir()).toBe(tmp);
	});
});

describe("runSyncImport", () => {
	it("splits a bundle into individual reference files", () => {
		const bundle = {
			teams: { teams: [{ key: "ENG", name: "Engineering" }] },
			projects: { projects: [{ name: "Backend", team: "ENG" }] },
		};
		const bundlePath = join(tmp, "bundle.json");
		writeFileSync(bundlePath, JSON.stringify(bundle));

		const report = runSyncImport({ from: bundlePath, referencesDir: tmp, output: "json" });
		expect(report.written.map((w) => w.target)).toEqual(["teams", "projects"]);

		const teams = JSON.parse(readFileSync(join(tmp, "teams.json"), "utf8"));
		expect(teams.teams[0]).toEqual({ key: "ENG", name: "Engineering" });
	});

	it("throws when bundle has no recognised reference keys", () => {
		const bundlePath = join(tmp, "bundle.json");
		writeFileSync(bundlePath, JSON.stringify({ unrelated: 1 }));
		expect(() => runSyncImport({ from: bundlePath, referencesDir: tmp, output: "text" })).toThrow(
			/bundle with top-level keys/,
		);
	});
});

describe("runSyncVerify", () => {
	it("reports all placeholder when referencesDir is empty", () => {
		const report = runSyncVerify({ referencesDir: tmp, output: "json" });
		for (const v of Object.values(report.sources)) expect(v).toBe("placeholder");
		expect(report.referencesDir).toBe(tmp);
	});

	it("reports user-file when a populated reference is present", () => {
		writeFileSync(join(tmp, "teams.json"), JSON.stringify({ teams: [{ key: "ENG", name: "Engineering" }] }));
		const report = runSyncVerify({ referencesDir: tmp, output: "json" });
		expect(report.sources.teams).toBe("user-file");
		expect(report.sources.projects).toBe("placeholder");
	});
});
