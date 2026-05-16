import { describe, expect, it } from "vitest";

import {
	parseColor,
	parseDate,
	parseHealth,
	parseLimit,
	parsePositiveInt,
	parsePriority,
	parseProjectState,
	parseTimeoutSeconds,
	requireNonEmptyUpdate,
	requireYes,
	ValidationError,
} from "../../src/utils/index.js";

describe("parseLimit", () => {
	it("returns default when value is undefined", () => {
		expect(parseLimit(undefined)).toBe(50);
		expect(parseLimit(undefined, 25)).toBe(25);
	});

	it("parses valid integers", () => {
		expect(parseLimit("100")).toBe(100);
	});

	it("caps at 250 with a stderr warning", () => {
		// stderr writes; just confirm value is capped.
		expect(parseLimit("999")).toBe(250);
	});

	it("throws on non-integer / negative / zero", () => {
		expect(() => parseLimit("abc")).toThrow(ValidationError);
		expect(() => parseLimit("0")).toThrow(ValidationError);
		expect(() => parseLimit("-5")).toThrow(ValidationError);
		expect(() => parseLimit("1.5")).toThrow(ValidationError);
	});
});

describe("parsePositiveInt", () => {
	it("returns Infinity by default", () => {
		expect(parsePositiveInt(undefined, "--max")).toBe(Infinity);
	});

	it("returns the custom default", () => {
		expect(parsePositiveInt(undefined, "--max", 1000)).toBe(1000);
	});

	it("parses positive integers above 250", () => {
		expect(parsePositiveInt("500", "--max")).toBe(500);
	});

	it("throws on invalid input", () => {
		expect(() => parsePositiveInt("0", "--max")).toThrow(ValidationError);
		expect(() => parsePositiveInt("-1", "--max")).toThrow(ValidationError);
	});
});

describe("parsePriority", () => {
	it("returns undefined for missing", () => {
		expect(parsePriority(undefined)).toBeUndefined();
	});

	it.each([0, 1, 2, 3, 4])("accepts %s", (n) => {
		expect(parsePriority(String(n))).toBe(n);
	});

	it("rejects out-of-range or non-numeric", () => {
		expect(() => parsePriority("5")).toThrow(ValidationError);
		expect(() => parsePriority("-1")).toThrow(ValidationError);
		expect(() => parsePriority("urgent")).toThrow(ValidationError);
	});
});

describe("parseDate", () => {
	it("accepts a valid YYYY-MM-DD", () => {
		expect(parseDate("2026-05-16")).toBe("2026-05-16");
	});

	it("rejects malformed format", () => {
		expect(() => parseDate("5/16/2026")).toThrow(ValidationError);
		expect(() => parseDate("2026-5-16")).toThrow(ValidationError);
	});

	it("rejects impossible calendar dates", () => {
		expect(() => parseDate("2026-02-30")).toThrow(ValidationError);
		expect(() => parseDate("2026-13-01")).toThrow(ValidationError);
	});
});

describe("parseColor", () => {
	it("accepts 3-char hex with #", () => {
		expect(parseColor("#F00")).toBe("#F00");
	});

	it("adds # if missing", () => {
		expect(parseColor("FF0000")).toBe("#FF0000");
	});

	it("rejects invalid hex", () => {
		expect(() => parseColor("#GGG")).toThrow(ValidationError);
		expect(() => parseColor("#12")).toThrow(ValidationError);
	});
});

describe("parseHealth", () => {
	it.each(["onTrack", "atRisk", "offTrack"])("accepts %s", (v) => {
		expect(parseHealth(v)).toBe(v);
	});

	it("rejects unknown", () => {
		expect(() => parseHealth("great")).toThrow(ValidationError);
	});
});

describe("parseProjectState", () => {
	it.each(["backlog", "planned", "started", "paused", "completed", "canceled"])("accepts %s", (v) => {
		expect(parseProjectState(v)).toBe(v);
	});

	it("rejects unknown", () => {
		expect(() => parseProjectState("Done")).toThrow(ValidationError);
	});
});

describe("parseTimeoutSeconds", () => {
	it("converts seconds to ms", () => {
		expect(parseTimeoutSeconds("5")).toBe(5000);
		expect(parseTimeoutSeconds("0.5")).toBe(500);
	});

	it("rejects zero, negatives, NaN, Infinity", () => {
		expect(() => parseTimeoutSeconds("0")).toThrow(ValidationError);
		expect(() => parseTimeoutSeconds("-1")).toThrow(ValidationError);
		expect(() => parseTimeoutSeconds("abc")).toThrow(ValidationError);
		expect(() => parseTimeoutSeconds("Infinity")).toThrow(ValidationError);
		expect(() => parseTimeoutSeconds("")).toThrow(ValidationError);
	});
});

describe("requireNonEmptyUpdate", () => {
	it("does not throw when at least one field is set", () => {
		expect(() => requireNonEmptyUpdate({ name: "x" })).not.toThrow();
		expect(() => requireNonEmptyUpdate({ name: "x", description: undefined })).not.toThrow();
	});

	it("throws when all fields are undefined", () => {
		expect(() => requireNonEmptyUpdate({})).toThrow(ValidationError);
		expect(() => requireNonEmptyUpdate({ a: undefined })).toThrow(ValidationError);
	});
});

describe("requireYes", () => {
	it("does not throw when --yes is set", () => {
		expect(() => requireYes({ yes: true }, "delete")).not.toThrow();
	});

	it("throws when --yes is not set", () => {
		expect(() => requireYes({}, "delete")).toThrow(ValidationError);
		expect(() => requireYes({ yes: false }, "delete")).toThrow(ValidationError);
	});
});
