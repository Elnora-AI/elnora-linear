import { describe, expect, it } from "vitest";

import {
	type ExternalCommandConfig,
	ExternalCommandSource,
	parseCommand,
	parseOutput,
} from "../../src/signals/external-command.js";

const NOW = new Date("2026-05-16T12:00:00Z");

describe("parseCommand", () => {
	it("splits on whitespace", () => {
		expect(parseCommand("ls -la /tmp")).toEqual(["ls", "-la", "/tmp"]);
	});

	it("respects double-quoted runs", () => {
		expect(parseCommand('echo "hello world" goodbye')).toEqual(["echo", "hello world", "goodbye"]);
	});

	it("handles consecutive whitespace", () => {
		expect(parseCommand("cmd   a   b")).toEqual(["cmd", "a", "b"]);
	});

	it("throws on empty input", () => {
		expect(() => parseCommand("")).toThrow(/empty/);
		expect(() => parseCommand("   ")).toThrow(/empty/);
	});
});

describe("parseOutput — lines mode", () => {
	const config = { name: "lines-source", type: "external_command", parse_as: "lines" as const };

	it("emits one signal per non-empty line", () => {
		const out = parseOutput("alpha\nbeta\n\ngamma\n", config, NOW);
		expect(out.length).toBe(3);
		expect(out[0].payload).toEqual({ line: "alpha" });
		expect(out[2].payload).toEqual({ line: "gamma" });
	});

	it("trims whitespace and skips blank lines", () => {
		const out = parseOutput("  one\n\n\t\ntwo  \n", config, NOW);
		expect(out.map((s) => s.payload.line)).toEqual(["one", "two"]);
	});

	it("includes source name + type + receivedAt", () => {
		const out = parseOutput("x\n", config, NOW);
		expect(out[0].source).toBe("lines-source");
		expect(out[0].type).toBe("external_command");
		expect(out[0].receivedAt).toBe(NOW.toISOString());
	});
});

describe("parseOutput — json mode", () => {
	const config = { name: "json-source", type: "external_command", parse_as: "json" as const };

	it("parses a single JSON object as one signal", () => {
		const out = parseOutput(JSON.stringify({ id: "X-1", status: "fail" }), config, NOW);
		expect(out.length).toBe(1);
		expect(out[0].payload).toEqual({ id: "X-1", status: "fail" });
	});

	it("parses a JSON array as N signals", () => {
		const out = parseOutput(JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }]), config, NOW);
		expect(out.length).toBe(3);
		expect(out[1].payload).toEqual({ a: 2 });
	});

	it("returns empty array for empty stdout", () => {
		expect(parseOutput("", config, NOW)).toEqual([]);
		expect(parseOutput("   \n\n  ", config, NOW)).toEqual([]);
	});

	it("lifts issue_match_field onto issueIdentifier", () => {
		const cfg = { ...config, issue_match_field: "linear_id" };
		const out = parseOutput(JSON.stringify([{ linear_id: "ENG-5", failed: true }]), cfg, NOW);
		expect(out[0].issueIdentifier).toBe("ENG-5");
	});

	it("omits issueIdentifier when match field is not a string", () => {
		const cfg = { ...config, issue_match_field: "linear_id" };
		const out = parseOutput(JSON.stringify([{ linear_id: 42 }]), cfg, NOW);
		expect(out[0].issueIdentifier).toBeUndefined();
	});

	it("wraps non-object values in { value: ... }", () => {
		const out = parseOutput(JSON.stringify(["a", "b"]), config, NOW);
		expect(out[0].payload).toEqual({ value: "a" });
	});

	it("throws on malformed JSON", () => {
		expect(() => parseOutput("{ not json", config, NOW)).toThrow(/not valid JSON/);
	});

	it("defaults parse_as to json when missing", () => {
		const cfg = { name: "x", type: "external_command" };
		const out = parseOutput(JSON.stringify({ a: 1 }), cfg, NOW);
		expect(out[0].payload).toEqual({ a: 1 });
	});
});

describe("parseOutput — unsupported mode", () => {
	it("throws", () => {
		expect(() => parseOutput("x", { name: "x", type: "external_command", parse_as: "yaml" as never }, NOW)).toThrow(
			/unsupported parse_as/,
		);
	});
});

describe("ExternalCommandSource — integration via node -e", () => {
	it("runs a node one-liner and parses its stdout", async () => {
		const config: ExternalCommandConfig = {
			type: "external_command",
			name: "node-echo",
			command: `node -e console.log(JSON.stringify([{linear_id:"X-1"},{linear_id:"X-2"}]))`,
			parse_as: "json",
			issue_match_field: "linear_id",
		};
		const source = new ExternalCommandSource(config);
		const out = await source.collect({ now: NOW });
		expect(out.length).toBe(2);
		expect(out[0].issueIdentifier).toBe("X-1");
		expect(out[1].issueIdentifier).toBe("X-2");
	});
});
