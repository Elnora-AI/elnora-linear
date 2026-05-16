import { describe, expect, it } from "vitest";

import { titleSimilarity } from "../../src/signals/linear-issues.js";

describe("titleSimilarity", () => {
	it("returns 1 for identical strings", () => {
		expect(titleSimilarity("Fix the bug", "fix the bug")).toBe(1);
	});

	it("returns 0 for fully disjoint sets", () => {
		expect(titleSimilarity("apple banana", "cherry date")).toBe(0);
	});

	it("ignores punctuation and case", () => {
		expect(titleSimilarity("Investigate: bug in auth!", "investigate bug in auth")).toBe(1);
	});

	it("detects partial overlap", () => {
		const sim = titleSimilarity("fix login bug", "login bug investigation");
		expect(sim).toBeGreaterThan(0.3);
		expect(sim).toBeLessThan(0.8);
	});

	it("returns 0 when one side is empty", () => {
		expect(titleSimilarity("", "anything")).toBe(0);
		expect(titleSimilarity("anything", "")).toBe(0);
	});
});
