import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	getTeamLabelPolicy,
	groupLabelsByPrefix,
	loadLabelPolicies,
	resetLabelPolicyCache,
	validateLabelsAgainstTeam,
} from "../../src/utils/index.js";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "elnora-linear-policy-"));
	resetLabelPolicyCache();
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	resetLabelPolicyCache();
});

function writePolicies(policies: Record<string, unknown>): void {
	writeFileSync(join(tmp, "label-policy.json"), JSON.stringify({ policies }));
}

describe("groupLabelsByPrefix", () => {
	it("groups labels by first matching prefix", () => {
		const result = groupLabelsByPrefix(
			["Type:bug", "Layer:frontend", "Layer:backend", "Misc:thing"],
			["Type:", "Layer:"],
		);
		expect(result["Type:"]).toEqual(["Type:bug"]);
		expect(result["Layer:"]).toEqual(["Layer:frontend", "Layer:backend"]);
		expect(result._unprefixed).toEqual(["Misc:thing"]);
	});

	it("empty labels list returns empty groups", () => {
		const result = groupLabelsByPrefix([], ["Type:"]);
		expect(result["Type:"]).toEqual([]);
		expect(result._unprefixed).toEqual([]);
	});
});

describe("loadLabelPolicies + getTeamLabelPolicy", () => {
	it("loads an empty placeholder cleanly", () => {
		const cfg = loadLabelPolicies({ referencesDir: tmp });
		expect(cfg.policies).toEqual({});
	});

	it("returns null for unknown team", () => {
		expect(getTeamLabelPolicy("ENG", { referencesDir: tmp })).toBeNull();
	});

	it("loads a populated policy", () => {
		writePolicies({
			ENG: {
				name: "Engineering",
				required: [{ prefixes: ["Type:"], min: 1, max: 1 }],
				allowedPrefixes: ["Type:", "Layer:"],
				requiresProject: true,
			},
		});
		const policy = getTeamLabelPolicy("ENG", { referencesDir: tmp });
		expect(policy?.name).toBe("Engineering");
		expect(policy?.requiresProject).toBe(true);
		expect(policy?.required[0].prefixes).toEqual(["Type:"]);
	});
});

describe("validateLabelsAgainstTeam", () => {
	it("passes through unknown teams (no enforcement)", () => {
		const result = validateLabelsAgainstTeam("UNKNOWN", ["any"], [], { referencesDir: tmp });
		expect(result.valid).toBe(true);
		expect(result.failures).toEqual([]);
	});

	it("passes when labels satisfy the required group", () => {
		writePolicies({
			ENG: {
				name: "Engineering",
				required: [{ prefixes: ["Type:"], min: 1, max: 1 }],
				allowedPrefixes: ["Type:"],
			},
		});
		const result = validateLabelsAgainstTeam("ENG", ["Type:bug"], ["Type:bug", "Type:feature"], { referencesDir: tmp });
		expect(result.valid).toBe(true);
		expect(result.failures).toEqual([]);
	});

	it("fails when required group is unmet", () => {
		writePolicies({
			ENG: {
				name: "Engineering",
				required: [{ prefixes: ["Type:"], min: 1, max: 1, description: "must pick a Type" }],
				allowedPrefixes: ["Type:", "Layer:"],
			},
		});
		const result = validateLabelsAgainstTeam("ENG", ["Layer:frontend"], ["Type:bug", "Type:feature"], {
			referencesDir: tmp,
		});
		expect(result.valid).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].reason).toBe("missing");
		expect(result.availableForPrefix["Type:"]).toEqual(["Type:bug", "Type:feature"]);
	});

	it("fails when required group exceeds max", () => {
		writePolicies({
			ENG: {
				name: "Engineering",
				required: [{ prefixes: ["Type:"], min: 1, max: 1 }],
				allowedPrefixes: ["Type:"],
			},
		});
		const result = validateLabelsAgainstTeam("ENG", ["Type:bug", "Type:feature"], ["Type:bug", "Type:feature"], {
			referencesDir: tmp,
		});
		expect(result.valid).toBe(false);
		expect(result.failures[0].reason).toBe("excess");
	});
});
