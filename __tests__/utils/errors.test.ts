import { describe, expect, it } from "vitest";

import {
	AuthError,
	CliError,
	EXIT_CODES,
	LabelValidationError,
	NotFoundError,
	ValidationError,
} from "../../src/utils/index.js";

describe("CliError hierarchy", () => {
	it("CliError exposes userMessage + suggestion + exitCode + data", () => {
		const err = new CliError("something bad", {
			suggestion: "try again",
			exitCode: EXIT_CODES.GENERAL,
			data: { extra: "info" },
		});
		expect(err.userMessage).toBe("something bad");
		expect(err.suggestion).toBe("try again");
		expect(err.exitCode).toBe(EXIT_CODES.GENERAL);
		expect(err.data).toEqual({ extra: "info" });
	});

	it("AuthError uses AUTH exit code", () => {
		const err = new AuthError();
		expect(err.exitCode).toBe(EXIT_CODES.AUTH);
		expect(err.userMessage).toMatch(/Linear API key/);
		expect(err.suggestion).toMatch(/~\/.config\/elnora-linear/);
	});

	it("NotFoundError uses NOT_FOUND exit code and references the right list command", () => {
		const err = new NotFoundError("team", "ENG");
		expect(err.exitCode).toBe(EXIT_CODES.NOT_FOUND);
		expect(err.userMessage).toContain("team not found: ENG");
		expect(err.suggestion).toContain("elnora-linear teams list");
	});

	it("NotFoundError falls back to a pluralised command for unknown entities", () => {
		const err = new NotFoundError("Widget", "abc");
		expect(err.suggestion).toContain("elnora-linear widgets list");
	});

	it("ValidationError uses VALIDATION exit code", () => {
		const err = new ValidationError("bad input", "fix it");
		expect(err.exitCode).toBe(EXIT_CODES.VALIDATION);
		expect(err.suggestion).toBe("fix it");
	});

	it("LabelValidationError summarises missing + excess", () => {
		const err = new LabelValidationError({
			error: "labels_invalid",
			team: "Engineering",
			teamKey: "ENG",
			missing: [{ prefixes: ["Type:"], min: 1, description: "Type label required" }],
			excess: [{ prefixes: ["Layer:"], max: 1, passed: ["Layer:frontend", "Layer:backend"] }],
			passed: ["Layer:frontend", "Layer:backend"],
			availableForPrefix: { "Type:": ["Type:bug", "Type:feature"] },
			suggestedRetry: 'issues create --team ENG --label "Type:bug"',
		});
		expect(err.exitCode).toBe(EXIT_CODES.VALIDATION);
		expect(err.userMessage).toContain("Engineering");
		expect(err.userMessage).toContain("missing");
		expect(err.userMessage).toContain("too many");
		expect(err.data?.teamKey).toBe("ENG");
		expect(err.data?.availableForPrefix).toBeDefined();
	});
});
