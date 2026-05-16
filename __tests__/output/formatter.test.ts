import { describe, expect, it } from "vitest";

import { type FormattedIssue, formatIssues, formatIssuesJson, formatIssuesText } from "../../src/output/formatter.js";

const sample: FormattedIssue[] = [
	{ identifier: "ENG-101", title: "Add bulk import", state: "In Progress", assignee: "Alice Smith" },
	{ identifier: "ENG-102", title: "Fix flaky test", state: "Todo", assignee: "Bob" },
];

describe("formatIssues — json mode", () => {
	it("returns parseable JSON of the input", () => {
		const out = formatIssues(sample, "json");
		expect(JSON.parse(out)).toEqual(sample);
	});

	it("formatIssuesJson is equivalent", () => {
		expect(formatIssuesJson(sample)).toBe(formatIssues(sample, "json"));
	});
});

describe("formatIssues — text mode", () => {
	it("includes a header and one line per issue", () => {
		const out = formatIssues(sample, "text");
		const lines = out.split("\n");
		expect(lines.length).toBe(3);
		expect(lines[0]).toContain("ID");
		expect(lines[0]).toContain("State");
		expect(lines[0]).toContain("Assignee");
		expect(lines[0]).toContain("Title");
		expect(lines[1]).toContain("ENG-101");
		expect(lines[1]).toContain("In Progress");
		expect(lines[1]).toContain("Alice Smith");
		expect(lines[2]).toContain("ENG-102");
	});

	it("shows 'No issues found.' when empty", () => {
		expect(formatIssues([], "text")).toBe("No issues found.");
	});

	it("renders '-' for missing optional fields", () => {
		const out = formatIssuesText([{ identifier: "OPS-1", title: "Untriaged" }]);
		const dataLine = out.split("\n")[1];
		expect(dataLine).toContain("OPS-1");
		expect(dataLine).toContain("-");
	});

	it("truncates long titles with an ellipsis", () => {
		const out = formatIssuesText([{ identifier: "ENG-1", title: "x".repeat(200) }]);
		const dataLine = out.split("\n")[1];
		expect(dataLine.length).toBeLessThan(160);
		expect(dataLine).toContain("…");
	});
});
