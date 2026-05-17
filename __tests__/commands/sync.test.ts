import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	_internal,
	mapProject,
	mapProjectStatus,
	mapTeam,
	mapUser,
	mapWorkflowState,
	planImport,
	readExistingReferenceDoc,
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

describe("readExistingReferenceDoc", () => {
	it("returns null when the file is missing", () => {
		expect(readExistingReferenceDoc(tmp, "users")).toBeNull();
	});

	it("returns null for a placeholder file", () => {
		writeFileSync(join(tmp, "users.json"), JSON.stringify({ _placeholder: true, users: [] }));
		expect(readExistingReferenceDoc(tmp, "users")).toBeNull();
	});

	it("returns null for an example file", () => {
		writeFileSync(join(tmp, "users.json"), JSON.stringify({ _example: true, users: [] }));
		expect(readExistingReferenceDoc(tmp, "users")).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		writeFileSync(join(tmp, "users.json"), "{ not json");
		expect(readExistingReferenceDoc(tmp, "users")).toBeNull();
	});

	it("returns the parsed object for a real reference", () => {
		const doc = { users: [{ key: "alice", name: "Alice", linear_user_id: "u1", slack_user_id: "U0001" }] };
		writeFileSync(join(tmp, "users.json"), JSON.stringify(doc));
		expect(readExistingReferenceDoc(tmp, "users")).toEqual(doc);
	});
});

describe("mergePreservedFields", () => {
	it("returns the mapped object unchanged when there's no prior", () => {
		const mapped = { key: "a", name: "Alice" };
		expect(_internal.mergePreservedFields(mapped, undefined)).toEqual(mapped);
	});

	it("preserves prior fields the mapper didn't produce", () => {
		const mapped = { key: "alice", name: "Alice Smith", linear_user_id: "u1" };
		const prior = { key: "alice", name: "stale", linear_user_id: "u1", slack_user_id: "U0001" };
		const out = _internal.mergePreservedFields(mapped, prior);
		expect(out.slack_user_id).toBe("U0001");
		// Mapped fields always win — refreshed name from Linear must overwrite stale.
		expect(out.name).toBe("Alice Smith");
	});
});

// ---------- live sync round-trip with a fake LinearClient ----------
//
// The bug these tests guard against: sync overwrites manually-curated fields
// (slack_user_id, project lead, workflow rules, team default_project) because
// the Linear API doesn't return them. Each test seeds those fields, runs the
// real sync function against a fake client, and asserts they survive.

interface FakeNode {
	[k: string]: unknown;
}

function fakeConnection<T extends FakeNode>(nodes: T[]) {
	const conn = {
		nodes,
		pageInfo: { hasNextPage: false },
		fetchNext: async () => conn,
	};
	return conn;
}

function fakeTeam(key: string, name: string, projects: FakeNode[] = [], states: FakeNode[] = []) {
	return {
		key,
		name,
		description: null,
		projects: async () => fakeConnection(projects),
		states: async () => fakeConnection(states),
	};
}

function fakeClient(opts: { teams?: FakeNode[]; users?: FakeNode[] }): LinearClient {
	const teams = opts.teams ?? [];
	const users = opts.users ?? [];
	return {
		teams: async () => fakeConnection(teams),
		users: async () => fakeConnection(users),
	} as unknown as LinearClient;
}

describe("syncUsers (live, fake client)", () => {
	it("preserves slack_user_id across resync", async () => {
		writeFileSync(
			join(tmp, "users.json"),
			JSON.stringify({
				users: [
					{ key: "carmen", name: "Carmen Kivisild", linear_user_id: "u-carmen", slack_user_id: "U0CARMEN" },
					{ key: "risto", name: "Risto", linear_user_id: "u-risto", slack_user_id: "U0RISTO" },
				],
			}),
		);

		const client = fakeClient({
			users: [
				{ id: "u-carmen", name: "Carmen Kivisild", email: "carmen@example.com", displayName: "carmen" },
				{ id: "u-risto", name: "Risto", email: "risto@example.com", displayName: "risto" },
				{ id: "u-new", name: "New Hire", email: "new@example.com", displayName: "new" },
			],
		});

		await _internal.syncUsers(client, tmp);
		const written = JSON.parse(readFileSync(join(tmp, "users.json"), "utf8"));

		const carmen = written.users.find((u: { key: string }) => u.key === "carmen");
		const risto = written.users.find((u: { key: string }) => u.key === "risto");
		const newHire = written.users.find((u: { key: string }) => u.key === "new");

		expect(carmen.slack_user_id).toBe("U0CARMEN");
		expect(risto.slack_user_id).toBe("U0RISTO");
		// New user from Linear comes in without a slack_user_id — that's correct.
		expect(newHire.slack_user_id).toBeUndefined();
		// And mapped fields still update (email picked up from API).
		expect(carmen.email).toBe("carmen@example.com");
	});

	it("matches by linear_user_id even if the key has drifted", async () => {
		writeFileSync(
			join(tmp, "users.json"),
			JSON.stringify({
				users: [{ key: "old-handle", name: "Alice", linear_user_id: "u-alice", slack_user_id: "U0ALICE" }],
			}),
		);

		const client = fakeClient({
			users: [{ id: "u-alice", name: "Alice", email: "alice@example.com", displayName: "alice.new" }],
		});

		await _internal.syncUsers(client, tmp);
		const written = JSON.parse(readFileSync(join(tmp, "users.json"), "utf8"));

		expect(written.users).toHaveLength(1);
		expect(written.users[0].slack_user_id).toBe("U0ALICE");
		// Key follows the mapUser slug rules — `.` → `-`. The prior `old-handle`
		// is matched via linear_user_id and refreshed to the current displayName.
		expect(written.users[0].key).toBe("alice-new");
	});

	it("falls back to key matching when prior entry lacks linear_user_id", async () => {
		writeFileSync(
			join(tmp, "users.json"),
			JSON.stringify({ users: [{ key: "bob", name: "Bob", slack_user_id: "U0BOB" }] }),
		);

		const client = fakeClient({
			users: [{ id: "u-bob", name: "Bob", email: "bob@example.com", displayName: "bob" }],
		});

		await _internal.syncUsers(client, tmp);
		const written = JSON.parse(readFileSync(join(tmp, "users.json"), "utf8"));

		expect(written.users[0].slack_user_id).toBe("U0BOB");
		expect(written.users[0].linear_user_id).toBe("u-bob");
	});

	it("works on first sync (no prior file)", async () => {
		const client = fakeClient({
			users: [{ id: "u-alice", name: "Alice", email: "alice@example.com", displayName: "alice" }],
		});
		await _internal.syncUsers(client, tmp);
		const written = JSON.parse(readFileSync(join(tmp, "users.json"), "utf8"));
		expect(written.users).toHaveLength(1);
		expect(written.users[0].slack_user_id).toBeUndefined();
	});
});

describe("syncTeams (live, fake client)", () => {
	it("preserves default_project across resync", async () => {
		writeFileSync(
			join(tmp, "teams.json"),
			JSON.stringify({ teams: [{ key: "ENG", name: "stale", default_project: "Backend Platform" }] }),
		);
		const client = fakeClient({ teams: [fakeTeam("ENG", "Engineering")] });

		await _internal.syncTeams(client, tmp);
		const written = JSON.parse(readFileSync(join(tmp, "teams.json"), "utf8"));

		expect(written.teams[0].default_project).toBe("Backend Platform");
		expect(written.teams[0].name).toBe("Engineering");
	});
});

describe("syncProjects (live, fake client)", () => {
	it("preserves lead, priority, sla across resync", async () => {
		writeFileSync(
			join(tmp, "projects.json"),
			JSON.stringify({
				projects: [{ name: "Backend Platform", team: "ENG", lead: "alice", priority: "High", sla: "30 days" }],
			}),
		);

		const client = fakeClient({
			teams: [
				fakeTeam("ENG", "Engineering", [{ name: "Backend Platform", description: "Core services", state: "started" }]),
			],
		});

		await _internal.syncProjects(client, tmp);
		const written = JSON.parse(readFileSync(join(tmp, "projects.json"), "utf8"));

		expect(written.projects[0].lead).toBe("alice");
		expect(written.projects[0].priority).toBe("High");
		expect(written.projects[0].sla).toBe("30 days");
		expect(written.projects[0].status).toBe("In Progress");
		expect(written.projects[0].description).toBe("Core services");
	});
});

describe("syncWorkflows (live, fake client)", () => {
	it("preserves curator rules across resync", async () => {
		const rules = [
			{
				id: "merged-pr-closes-issue",
				tier: "high",
				description: "Close on merge",
				when: { signal_type: "github_pr" },
				action: { set_state: "Done" },
			},
		];
		writeFileSync(
			join(tmp, "workflows.json"),
			JSON.stringify({ states: [{ name: "Todo", type: "unstarted" }], rules }),
		);

		const client = fakeClient({
			teams: [
				fakeTeam(
					"ENG",
					"Engineering",
					[],
					[
						{ name: "Todo", type: "unstarted" },
						{ name: "Done", type: "completed" },
					],
				),
			],
		});

		await _internal.syncWorkflows(client, tmp);
		const written = JSON.parse(readFileSync(join(tmp, "workflows.json"), "utf8"));

		expect(written.rules).toEqual(rules);
		expect(written.states.map((s: { name: string }) => s.name).sort()).toEqual(["Done", "Todo"]);
	});

	it("defaults rules to [] when there's no prior file", async () => {
		const client = fakeClient({
			teams: [fakeTeam("ENG", "Engineering", [], [{ name: "Todo", type: "unstarted" }])],
		});
		await _internal.syncWorkflows(client, tmp);
		const written = JSON.parse(readFileSync(join(tmp, "workflows.json"), "utf8"));
		expect(written.rules).toEqual([]);
	});
});
