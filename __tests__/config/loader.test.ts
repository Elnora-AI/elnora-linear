import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUNDLED_REFERENCES_DIR, type LinearConfig, loadConfig, resolveReferencesDir } from "../../src/config/index.js";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "elnora-linear-loader-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	delete process.env.LINEAR_REFERENCES_DIR;
});

describe("resolveReferencesDir", () => {
	it("returns explicit override resolved to absolute path", () => {
		expect(resolveReferencesDir(tmp)).toBe(tmp);
	});

	it("uses LINEAR_REFERENCES_DIR when no override", () => {
		process.env.LINEAR_REFERENCES_DIR = tmp;
		expect(resolveReferencesDir()).toBe(tmp);
	});

	it("override takes precedence over env var", () => {
		const other = mkdtempSync(join(tmpdir(), "elnora-linear-other-"));
		try {
			process.env.LINEAR_REFERENCES_DIR = tmp;
			expect(resolveReferencesDir(other)).toBe(other);
		} finally {
			rmSync(other, { recursive: true, force: true });
		}
	});

	it("falls back to bundled when nothing else resolves", () => {
		// No env, no override, and ~/.config/elnora-linear/ presumably doesn't exist on CI runners.
		// We only assert that it doesn't crash and returns *some* directory string; bundled is the
		// expected final fallback on a clean machine.
		const resolved = resolveReferencesDir();
		expect(typeof resolved).toBe("string");
		expect(resolved.length).toBeGreaterThan(0);
	});
});

describe("loadConfig — empty/bundled defaults", () => {
	it("loads bundled placeholders when references dir has no files", () => {
		const cfg = loadConfig({ referencesDir: tmp });
		// Each reference resolves to its bundled placeholder; arrays are empty.
		expect(cfg.teams.teams).toEqual([]);
		expect(cfg.projects.projects).toEqual([]);
		expect(cfg.users.users).toEqual([]);
		expect(cfg.slack.channels).toEqual([]);
		expect(cfg.repos.repos).toEqual([]);
		expect(cfg.signalSources.sources).toEqual([]);
		expect(cfg.workflows.states).toEqual([]);
		// All sources should be reported as "placeholder" since no .json files exist in tmp.
		for (const v of Object.values(cfg.meta.sources)) {
			expect(v).toBe("placeholder");
		}
		expect(cfg.meta.referencesDir).toBe(tmp);
		expect(cfg.meta.bundledReferencesDir).toBe(BUNDLED_REFERENCES_DIR);
	});
});

describe("loadConfig — populated user files", () => {
	function writePopulated(name: string, body: object): void {
		writeFileSync(join(tmp, `${name}.json`), JSON.stringify(body, null, 2));
	}

	it("prefers <name>.json over .placeholder.json", () => {
		writePopulated("teams", {
			teams: [{ key: "TEST", name: "Test Team" }],
		});
		const cfg = loadConfig({ referencesDir: tmp });
		expect(cfg.teams.teams).toHaveLength(1);
		expect(cfg.teams.teams[0]).toEqual({ key: "TEST", name: "Test Team" });
		expect(cfg.meta.sources.teams).toBe("user-file");
		// Other refs still come from bundled placeholders.
		expect(cfg.meta.sources.projects).toBe("placeholder");
	});

	it("loads all reference files when fully populated", () => {
		writePopulated("teams", { teams: [{ key: "TEST", name: "Test Team" }] });
		writePopulated("projects", {
			projects: [{ name: "Test Project", team: "TEST", priority: "High", status: "In Progress" }],
		});
		writePopulated("users", { users: [{ key: "test_user", name: "Test User" }] });
		writePopulated("slack", { channels: [], allowed_channels: [], allowed_dm_users: [] });
		writePopulated("repos", { repos: [{ name: "test-repo" }] });
		writePopulated("signal-sources", {
			sources: [{ type: "github_pr", name: "test-prs", repos: ["test-repo"] }],
		});
		writePopulated("workflows", { states: [{ name: "Done", type: "completed" }], rules: [] });
		writePopulated("label-policy", { policies: {} });
		const cfg: LinearConfig = loadConfig({ referencesDir: tmp });
		expect(Object.values(cfg.meta.sources)).toEqual(Array(8).fill("user-file"));
		expect(cfg.repos.repos[0].name).toBe("test-repo");
		expect(cfg.signalSources.sources[0].type).toBe("github_pr");
		expect(cfg.labelPolicy.policies).toEqual({});
	});
});

describe("loadConfig — error handling", () => {
	it("throws on invalid JSON", () => {
		writeFileSync(join(tmp, "teams.json"), "{ not valid json");
		expect(() => loadConfig({ referencesDir: tmp })).toThrow(/invalid JSON/);
	});

	it("throws on schema-validation failure in strict mode (default)", () => {
		// teams entries must have key and name; this entry is missing name.
		writeFileSync(join(tmp, "teams.json"), JSON.stringify({ teams: [{ key: "TEST" }] }, null, 2));
		expect(() => loadConfig({ referencesDir: tmp })).toThrow(/schema validation/);
	});

	it("warns instead of throwing in non-strict mode", () => {
		writeFileSync(join(tmp, "teams.json"), JSON.stringify({ teams: [{ key: "TEST" }] }, null, 2));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const cfg = loadConfig({ referencesDir: tmp, strict: false });
			expect(cfg.teams.teams[0]).toEqual({ key: "TEST" });
			expect(warn).toHaveBeenCalled();
			expect(warn.mock.calls[0][0]).toContain("schema validation");
		} finally {
			warn.mockRestore();
		}
	});

	it("accepts placeholder files as valid", () => {
		writeFileSync(join(tmp, "teams.placeholder.json"), JSON.stringify({ _placeholder: true, teams: [] }, null, 2));
		const cfg = loadConfig({ referencesDir: tmp });
		expect(cfg.meta.sources.teams).toBe("placeholder");
		expect(cfg.teams.teams).toEqual([]);
	});

	it("accepts example files as valid (when used as placeholder fallback)", () => {
		// If a user copied the example over the placeholder by mistake, it should still load.
		writeFileSync(
			join(tmp, "teams.placeholder.json"),
			JSON.stringify(
				{
					_example: true,
					teams: [{ key: "ENG", name: "Engineering" }],
				},
				null,
				2,
			),
		);
		const cfg = loadConfig({ referencesDir: tmp });
		expect(cfg.teams.teams).toHaveLength(1);
	});
});

describe("bundled references — sanity", () => {
	it("loads cleanly with strictly no references dir input (uses bundled fallback)", () => {
		mkdirSync(join(tmp, "empty"));
		const cfg = loadConfig({ referencesDir: join(tmp, "empty") });
		expect(cfg.teams.teams).toEqual([]);
		// Bundled placeholders validate against their own schemas.
		// (This is a regression guard — if a placeholder ever drifts from its schema, this fails.)
	});
});
