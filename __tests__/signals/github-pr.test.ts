import { describe, expect, it } from "vitest";

import { BODY_EXCERPT_CHARS, excerptBody } from "../../src/signals/github-pr.js";

describe("excerptBody", () => {
	it("is empty for a missing body", () => {
		expect(excerptBody(null)).toBe("");
		expect(excerptBody(undefined)).toBe("");
		expect(excerptBody("")).toBe("");
	});

	it("collapses newlines so the excerpt survives one-line signal rendering", () => {
		expect(excerptBody("## Summary\n\nFixes the thing.\r\n\r\nDetails follow.")).toBe(
			"## Summary Fixes the thing. Details follow.",
		);
	});

	it("keeps a short body whole", () => {
		expect(excerptBody("Fixes ELN-1.")).toBe("Fixes ELN-1.");
	});

	// One signal is emitted per referenced issue, so an unbounded body would be
	// duplicated across every issue a PR touches.
	it("bounds a long body and marks the cut", () => {
		const out = excerptBody("x".repeat(5000));
		expect(out.length).toBe(BODY_EXCERPT_CHARS + 1);
		expect(out.endsWith("…")).toBe(true);
	});

	// The gap this closes: a merged-PR signal previously carried repo/number/title
	// only, so the curator knew a PR merged but nothing about what it changed.
	it("preserves the opening summary, which says what changed", () => {
		const body = "## Summary\n\nThe agent could not tell it had already won.\n\n## Details\n" + "d".repeat(2000);
		expect(excerptBody(body)).toContain("The agent could not tell it had already won.");
	});
});
