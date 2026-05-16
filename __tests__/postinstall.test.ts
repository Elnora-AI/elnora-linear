// Postinstall hook tests.
//
// The hook ships as `scripts/postinstall.mjs` (a plain ESM script, not part of
// the TypeScript build). We exercise it two ways:
//   1. Import pure helpers (`shouldSkip`, `findApiKey`) directly.
//   2. Spawn the script as a child process to assert end-to-end behaviour:
//      skip paths stay silent, missing key prints the friendly notice, present
//      key invokes `dist/cli.js sync all`.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findApiKey, shouldSkip } from "../scripts/postinstall.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/postinstall.mjs", import.meta.url));

function runPostinstall(env: Record<string, string | undefined>) {
	// Strip env entries we don't want inherited from the host (the developer
	// running these tests almost certainly has LINEAR_API_KEY set).
	const cleanEnv: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (k === "LINEAR_API_KEY" || k === "CI" || k === "ELNORA_LINEAR_SKIP_POSTINSTALL" || k === "npm_config_global") {
			continue;
		}
		if (v !== undefined) cleanEnv[k] = v;
	}
	for (const [k, v] of Object.entries(env)) {
		if (v !== undefined) cleanEnv[k] = v;
	}
	// Force monochrome output so assertions don't need to handle ANSI.
	cleanEnv.NO_COLOR = "1";
	return spawnSync(process.execPath, [SCRIPT_PATH], {
		env: cleanEnv,
		encoding: "utf8",
		timeout: 15_000,
	});
}

describe("shouldSkip", () => {
	it("skips when the escape hatch env var is set", () => {
		expect(shouldSkip({ ELNORA_LINEAR_SKIP_POSTINSTALL: "1" })).toMatch(/SKIP_POSTINSTALL/);
	});

	it("skips when CI=true", () => {
		expect(shouldSkip({ CI: "true" })).toMatch(/CI/);
	});

	it("skips when CI=1", () => {
		expect(shouldSkip({ CI: "1" })).toMatch(/CI/);
	});

	it("skips for local (non-global) installs", () => {
		expect(shouldSkip({ npm_config_global: "false" })).toMatch(/global/);
	});

	it("does not skip for a global install with no CI/escape hatch", () => {
		expect(shouldSkip({ npm_config_global: "true" })).toBeNull();
	});

	it("does not skip when no relevant env vars are set", () => {
		expect(shouldSkip({})).toBeNull();
	});
});

describe("findApiKey", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "elnora-linear-postinstall-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("reads a valid key from env", () => {
		const result = findApiKey({ LINEAR_API_KEY: "lin_api_abc123" }, join(tmp, "nonexistent.env"));
		expect(result).toEqual({ source: "env", value: "lin_api_abc123" });
	});

	it("strips surrounding quotes from env key", () => {
		const result = findApiKey({ LINEAR_API_KEY: '"lin_api_xyz"' }, join(tmp, "nonexistent.env"));
		expect(result?.value).toBe("lin_api_xyz");
	});

	it("rejects env values that don't start with lin_api_", () => {
		const envFile = join(tmp, ".env");
		const result = findApiKey({ LINEAR_API_KEY: "not-a-linear-key" }, envFile);
		expect(result).toBeNull();
	});

	it("reads a valid key from the env file", () => {
		const envFile = join(tmp, ".env");
		writeFileSync(envFile, "LINEAR_API_KEY=lin_api_fromfile\n");
		const result = findApiKey({}, envFile);
		expect(result).toEqual({ source: envFile, value: "lin_api_fromfile" });
	});

	it("ignores malformed env file entries", () => {
		const envFile = join(tmp, ".env");
		writeFileSync(envFile, "LINEAR_API_KEY=garbage\n");
		const result = findApiKey({}, envFile);
		expect(result).toBeNull();
	});

	it("returns null when no env file and no env var", () => {
		const result = findApiKey({}, join(tmp, "missing.env"));
		expect(result).toBeNull();
	});

	it("prefers env var over env file", () => {
		const envFile = join(tmp, ".env");
		writeFileSync(envFile, "LINEAR_API_KEY=lin_api_fromfile\n");
		const result = findApiKey({ LINEAR_API_KEY: "lin_api_fromenv" }, envFile);
		expect(result?.value).toBe("lin_api_fromenv");
	});
});

describe("postinstall script (end-to-end)", () => {
	it("is silent and exits 0 when CI=true", () => {
		const result = runPostinstall({ CI: "true" });
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("is silent and exits 0 with ELNORA_LINEAR_SKIP_POSTINSTALL=1", () => {
		const result = runPostinstall({ ELNORA_LINEAR_SKIP_POSTINSTALL: "1" });
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("is silent and exits 0 for local (non-global) installs", () => {
		const result = runPostinstall({ npm_config_global: "false" });
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("prints the friendly no-key notice when no key is reachable", () => {
		// Point HOME at an empty temp dir so the script can't find a real env file.
		const tmp = mkdtempSync(join(tmpdir(), "elnora-linear-postinstall-home-"));
		try {
			const result = runPostinstall({ HOME: tmp, npm_config_global: "true" });
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("could not personalise your Linear agents");
			expect(result.stdout).toContain("linear.app/settings/api");
			expect(result.stdout).toContain("elnora-linear sync all");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("exits 0 even when sync would fail (no CLI built, invalid key)", () => {
		// We can't actually run a real sync without a Linear workspace, but we
		// can prove the hook never propagates a non-zero exit code: feed it a
		// syntactically-valid key and let the spawned CLI fail. Either path
		// (CLI missing or 401 from Linear) must still exit 0.
		const tmp = mkdtempSync(join(tmpdir(), "elnora-linear-postinstall-fail-"));
		try {
			const result = runPostinstall({
				HOME: tmp,
				LINEAR_API_KEY: "lin_api_definitelynotvalid_postinstalltest",
				npm_config_global: "true",
			});
			expect(result.status).toBe(0);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
