import { describe, expect, it } from "vitest";

import { recommendedStateForStatus } from "../../src/utils/index.js";

describe("recommendedStateForStatus", () => {
	it("maps backlog → Backlog", () => {
		expect(recommendedStateForStatus("backlog")).toEqual({ state: "Backlog" });
	});

	it.each(["planned", "started"])("maps %s → Todo", (status) => {
		expect(recommendedStateForStatus(status)).toEqual({ state: "Todo" });
	});

	it("paused returns null with a warning", () => {
		const result = recommendedStateForStatus("paused");
		expect(result.state).toBeNull();
		expect(result.warning).toContain("paused");
	});

	it.each(["completed", "canceled"])("%s returns null with a 'pick a different project' warning", (status) => {
		const result = recommendedStateForStatus(status);
		expect(result.state).toBeNull();
		expect(result.warning).toContain("pick a different project");
	});

	it("unknown status returns null with no warning", () => {
		expect(recommendedStateForStatus("weird")).toEqual({ state: null });
		expect(recommendedStateForStatus(null)).toEqual({ state: null });
		expect(recommendedStateForStatus(undefined)).toEqual({ state: null });
	});
});
