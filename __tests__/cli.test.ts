import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
});
