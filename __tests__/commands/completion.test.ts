import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(__dirname, "..", "..", "dist", "cli.js");

describe("elnora-linear completion (built)", () => {
	it.runIf(existsSync(CLI))("emits a bash completion script", () => {
		const out = execFileSync("node", [CLI, "completion", "bash"], { encoding: "utf8" });
		expect(out).toContain("complete -F");
		expect(out).toContain("elnora-linear");
		expect(out).toContain("search");
	});

	it.runIf(existsSync(CLI))("emits a zsh completion script", () => {
		const out = execFileSync("node", [CLI, "completion", "zsh"], { encoding: "utf8" });
		expect(out).toContain("compdef");
		expect(out).toContain("elnora-linear");
	});

	it.runIf(existsSync(CLI))("emits a fish completion script", () => {
		const out = execFileSync("node", [CLI, "completion", "fish"], { encoding: "utf8" });
		expect(out).toContain("complete -c elnora-linear");
	});

	it.runIf(existsSync(CLI))("emits a powershell completion script", () => {
		const out = execFileSync("node", [CLI, "completion", "powershell"], { encoding: "utf8" });
		expect(out).toContain("Register-ArgumentCompleter");
	});

	it.runIf(existsSync(CLI))("exits non-zero on unknown shell", () => {
		expect(() => execFileSync("node", [CLI, "completion", "csh"], { encoding: "utf8" })).toThrow();
	});

	it.runIf(existsSync(CLI))("registers users/states/cycles/quota in --help", () => {
		const out = execFileSync("node", [CLI, "--help"], { encoding: "utf8" });
		for (const cmd of ["users", "states", "cycles", "quota", "completion"]) {
			expect(out).toContain(cmd);
		}
	});
});
