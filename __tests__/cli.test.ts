import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// The file options are validated before the client is built, so these cases
// exit on argument validation alone — no API key, no network.
describe("long-text file options (built)", () => {
	const ENV = { ...process.env, LINEAR_API_KEY: "definitely-not-a-linear-key" };

	function run(args: string[], input?: string) {
		return spawnSync("node", [CLI, ...args], { encoding: "utf8", env: ENV, input });
	}

	it.runIf(existsSync(CLI))("advertises --description-file in `issues create --help`", () => {
		const out = execFileSync("node", [CLI, "issues", "create", "--help"], { encoding: "utf8" });
		expect(out).toContain("--description-file");
	});

	it.runIf(existsSync(CLI))("advertises --description-file in `issues update --help`", () => {
		const out = execFileSync("node", [CLI, "issues", "update", "--help"], { encoding: "utf8" });
		expect(out).toContain("--description-file");
	});

	it.runIf(existsSync(CLI))("advertises --body-file in `comments create --help`", () => {
		const out = execFileSync("node", [CLI, "comments", "create", "--help"], { encoding: "utf8" });
		expect(out).toContain("--body-file");
	});

	it.runIf(existsSync(CLI))("rejects --description with --description-file instead of picking a winner", () => {
		const dir = mkdtempSync(join(tmpdir(), "elnora-linear-text-"));
		try {
			const file = join(dir, "body.md");
			writeFileSync(file, "# From the file\n");
			const res = run([
				"issues",
				"create",
				"Title",
				"--team",
				"ENG",
				"--description",
				"inline",
				"--description-file",
				file,
			]);
			expect(res.status).toBe(2);
			expect(res.stderr).toContain("--description-file");
			expect(res.stderr).toContain("mutually exclusive");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.runIf(existsSync(CLI))("reports an unreadable --description-file with the path and the reason", () => {
		const missing = join(tmpdir(), "elnora-linear-does-not-exist-1234567890.md");
		const res = run(["issues", "update", "ENG-1", "--description-file", missing]);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain("Cannot read --description-file");
		expect(res.stderr).toContain(missing);
	});

	it.runIf(existsSync(CLI))("still requires a comment body when neither option is given", () => {
		const res = run(["comments", "create", "ENG-1"]);
		expect(res.status).toBe(2);
		expect(res.stderr).toContain("--body");
		expect(res.stderr).toContain("--body-file");
	});

	it.runIf(existsSync(CLI))("reads --body-file from stdin when the path is '-'", () => {
		const res = run(["comments", "create", "ENG-1", "--body-file", "-"], "");
		expect(res.status).toBe(2);
		expect(res.stderr).toContain("stdin");
		expect(res.stderr).toContain("contained no text");
	});
});
