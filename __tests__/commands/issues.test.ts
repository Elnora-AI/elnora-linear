import { describe, expect, it } from "vitest";

import { resolveBulkOpTeamKey } from "../../src/commands/issues.js";

describe("resolveBulkOpTeamKey", () => {
	const teamMap = {
		ENG: { id: "team-eng", key: "ENG" },
		Engineering: { id: "team-eng", key: "ENG" },
		SEC: { id: "team-sec", key: "SEC" },
	};

	it("uses explicit op.team when present + resolvable", () => {
		expect(resolveBulkOpTeamKey({ team: "Engineering" }, teamMap, "OPS")).toBe("ENG");
		expect(resolveBulkOpTeamKey({ team: "SEC" }, teamMap, "OPS")).toBe("SEC");
	});

	it("falls back to default when op.team is unknown", () => {
		expect(resolveBulkOpTeamKey({ team: "DoesNotExist" }, teamMap, "OPS")).toBe("OPS");
	});

	it("derives team from issue prefix on update ops (cross-team safeguard)", () => {
		expect(resolveBulkOpTeamKey({ kind: "update", id: "SEC-5" }, teamMap, "ENG")).toBe("SEC");
		expect(resolveBulkOpTeamKey({ kind: "update", id: "ENG-99" }, teamMap, "OPS")).toBe("ENG");
	});

	it("uses default when update id has no prefix match", () => {
		expect(resolveBulkOpTeamKey({ kind: "update", id: "not-an-identifier" }, teamMap, "OPS")).toBe("OPS");
	});

	it("uses default when op has no team and is not an update", () => {
		expect(resolveBulkOpTeamKey({ kind: "create", title: "x" }, teamMap, "OPS")).toBe("OPS");
		expect(resolveBulkOpTeamKey({ kind: "comment" }, teamMap, "OPS")).toBe("OPS");
	});

	it("explicit op.team beats id-derived prefix", () => {
		expect(resolveBulkOpTeamKey({ team: "SEC", kind: "update", id: "ENG-5" }, teamMap, "OPS")).toBe("SEC");
	});
});
