import { describe, expect, it } from "vitest";

import { _internal } from "../../src/signals/github-commits.js";

describe("buildTeamRegex", () => {
	it("falls back to a generic prefix regex when no team keys", () => {
		const re = _internal.buildTeamRegex([]);
		expect("Fix for ENG-1 closes ABC-99".match(re)).toEqual(["ENG-1", "ABC-99"]);
	});

	it("only matches configured team prefixes", () => {
		const re = _internal.buildTeamRegex(["ENG", "SEC"]);
		const matches = [..."fix ENG-1 and SEC-2 but not OTHER-9".matchAll(re)].map((m) => m[0]);
		expect(matches).toEqual(["ENG-1", "SEC-2"]);
	});

	it("escapes regex-special characters in keys", () => {
		const re = _internal.buildTeamRegex(["A.B"]);
		expect("A.B-1".match(re)).not.toBeNull();
		expect("AXB-1".match(re)).toBeNull();
	});
});

describe("extractIssueIds", () => {
	it("dedupes repeated identifiers", () => {
		const re = _internal.buildTeamRegex(["ENG"]);
		expect(_internal.extractIssueIds("ENG-1 again ENG-1 and ENG-2", re)).toEqual(["ENG-1", "ENG-2"]);
	});

	it("returns empty when no matches", () => {
		const re = _internal.buildTeamRegex(["ENG"]);
		expect(_internal.extractIssueIds("nothing here", re)).toEqual([]);
	});
});

describe("parseGitLog", () => {
	it("parses git log output with our record separators", () => {
		const stdout = "abc123\x1Falice@x.com\x1FFix ENG-1\x1Fbody line\x1Edef456\x1Fbob@x.com\x1FRefactor\x1F\x1E";
		const rows = _internal.parseGitLog(stdout);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			sha: "abc123",
			author_email: "alice@x.com",
			subject: "Fix ENG-1",
			message: "Fix ENG-1\nbody line",
		});
		expect(rows[1].sha).toBe("def456");
		expect(rows[1].message).toBe("Refactor");
	});

	it("returns empty array for empty input", () => {
		expect(_internal.parseGitLog("")).toEqual([]);
	});
});
