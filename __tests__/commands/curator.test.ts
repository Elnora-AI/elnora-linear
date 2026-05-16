import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CuratorReport, formatCuratorReport, runCurator } from "../../src/commands/curator.js";

let tmp: string;
let originalEnv: string | undefined;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "elnora-linear-curator-"));
	originalEnv = process.env.LINEAR_REFERENCES_DIR;
	delete process.env.LINEAR_REFERENCES_DIR;
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	if (originalEnv === undefined) delete process.env.LINEAR_REFERENCES_DIR;
	else process.env.LINEAR_REFERENCES_DIR = originalEnv;
});

function writeSignalSources(dir: string, sources: unknown[]): void {
	writeFileSync(join(dir, "signal-sources.json"), JSON.stringify({ sources }));
}

describe("runCurator", () => {
	it("reports 'no enabled sources' when references dir is empty (placeholder fallback)", async () => {
		const report = await runCurator({ referencesDir: tmp, output: "json", collectOnly: true });
		expect(report.sources).toEqual([]);
	});

	it("skips entries explicitly disabled with enabled: false", async () => {
		writeSignalSources(tmp, [
			{ type: "external_command", name: "off", enabled: false, command: "node -e console.log(JSON.stringify([]))" },
		]);
		const report = await runCurator({ referencesDir: tmp, output: "json", collectOnly: true });
		expect(report.sources).toEqual([]);
	});

	it("collects signals from an enabled external_command source", async () => {
		writeSignalSources(tmp, [
			{
				type: "external_command",
				name: "node-array",
				enabled: true,
				command: `node -e console.log(JSON.stringify([{linear_id:"X-1"},{linear_id:"X-2"}]))`,
				parse_as: "json",
				issue_match_field: "linear_id",
			},
		]);
		const report = await runCurator({ referencesDir: tmp, output: "json", collectOnly: true });
		expect(report.sources).toHaveLength(1);
		expect(report.sources[0].signalCount).toBe(2);
		expect(report.sources[0].signals[0].issueIdentifier).toBe("X-1");
	});

	it("filters to a single source when --source is given", async () => {
		writeSignalSources(tmp, [
			{ type: "external_command", name: "first", command: `node -e console.log(JSON.stringify([{x:1}]))` },
			{ type: "external_command", name: "second", command: `node -e console.log(JSON.stringify([{x:2}]))` },
		]);
		const report = await runCurator({ referencesDir: tmp, output: "json", source: "second", collectOnly: true });
		expect(report.sources).toHaveLength(1);
		expect(report.sources[0].name).toBe("second");
	});

	it("records an error for unimplemented source types but keeps going", async () => {
		writeSignalSources(tmp, [
			{ type: "mcp_tool", name: "future", server: "s", tool: "t" },
			{
				type: "external_command",
				name: "works",
				command: `node -e console.log(JSON.stringify([{x:1}]))`,
			},
		]);
		const report = await runCurator({ referencesDir: tmp, output: "json", collectOnly: true });
		expect(report.sources).toHaveLength(2);
		const future = report.sources.find((s) => s.name === "future");
		const works = report.sources.find((s) => s.name === "works");
		expect(future?.error).toContain("not yet implemented");
		expect(works?.signalCount).toBe(1);
	});
});

describe("formatCuratorReport", () => {
	it("prints a no-sources message when empty", () => {
		const out = formatCuratorReport({ sources: [] });
		expect(out).toContain("No enabled signal sources");
	});

	it("shows [ok] and signal counts", () => {
		const report: CuratorReport = {
			sources: [{ name: "x", type: "external_command", enabled: true, signalCount: 3, signals: [] }],
		};
		const out = formatCuratorReport(report);
		expect(out).toContain("[ok] x (external_command): 3 signal(s)");
	});

	it("shows [!!] and the error message on failure", () => {
		const report: CuratorReport = {
			sources: [{ name: "x", type: "github_commits", enabled: true, signalCount: 0, signals: [], error: "boom" }],
		};
		const out = formatCuratorReport(report);
		expect(out).toContain("[!!] x (github_commits) — error: boom");
	});

	it("truncates long signal lists with a '… N more' line", () => {
		const signals = Array.from({ length: 15 }, (_, i) => ({
			source: "x",
			type: "external_command",
			payload: { i },
			receivedAt: "2026-05-16T00:00:00Z",
		}));
		const report: CuratorReport = {
			sources: [{ name: "x", type: "external_command", enabled: true, signalCount: 15, signals }],
		};
		const out = formatCuratorReport(report);
		expect(out).toContain("… 5 more");
	});
});
