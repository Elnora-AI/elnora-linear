import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(__dirname, "..", "dist", "cli.js");

describe("elnora-linear CLI (built)", () => {
	it.runIf(existsSync(CLI))("prints version with --version", () => {
		const out = execFileSync("node", [CLI, "--version"], { encoding: "utf8" }).trim();
		expect(out).toMatch(/^\d+\.\d+\.\d+/);
	});

	it.runIf(existsSync(CLI))("prints help with --help", () => {
		const out = execFileSync("node", [CLI, "--help"], { encoding: "utf8" });
		expect(out).toContain("elnora-linear");
		expect(out).toContain("Usage:");
	});

	it.runIf(existsSync(CLI))("exits non-zero on unknown command", () => {
		expect(() => execFileSync("node", [CLI, "not-a-real-command"], { encoding: "utf8" })).toThrow();
	});

	// A rule-engine failure used to be reported as one stdout line and exit 0,
	// so a run that collected signals and applied nothing looked healthy to
	// launchd. The bad key below fails auth locally — no network involved.
	it.runIf(existsSync(CLI))("exits non-zero when curator-run's rule engine fails", () => {
		const dir = mkdtempSync(join(tmpdir(), "elnora-linear-cli-"));
		try {
			const res = spawnSync("node", [CLI, "curator-run", "--references-dir", dir, "--output", "json"], {
				encoding: "utf8",
				env: {
					...process.env,
					LINEAR_API_KEY: "definitely-not-a-linear-key",
					ANTHROPIC_API_KEY: "test-key-not-used",
				},
			});
			expect(res.status).toBe(1);
			expect(res.stderr).toContain("curator rule engine failed");
			expect(JSON.parse(res.stdout).pipeline.error).toBeTruthy();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
