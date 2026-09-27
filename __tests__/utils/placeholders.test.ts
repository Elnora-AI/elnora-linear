import { describe, expect, it } from "vitest";
import { collectPlaceholders, placeholdersIn, resolvePlaceholders } from "../../src/utils/placeholders.js";

const isCreate = (op: Record<string, unknown>) => op.kind === "create";
const label = (i: number) => `Op #${i}`;

describe("placeholdersIn", () => {
	it("finds each placeholder once, and not inside longer tokens", () => {
		expect(placeholdersIn("Done when: x — new:1\nRelated: new:1, new:12 · renew:3 · new:2's")).toEqual([
			"new:1",
			"new:12",
			"new:2",
		]);
	});

	it("ignores prose that only looks similar", () => {
		expect(placeholdersIn("What's new: the new:x flag")).toEqual([]);
	});
});

describe("collectPlaceholders", () => {
	it("maps each declared placeholder to its create", () => {
		const ops = [
			{ kind: "create", id: "new:1", title: "A" },
			{ kind: "relate", from: "ENG-1", to: "new:1" },
		];
		expect(collectPlaceholders(ops, isCreate, label)).toEqual(new Map([["new:1", 0]]));
	});

	it("rejects a mention nothing declares, before anything is written", () => {
		const ops = [
			{ kind: "create", id: "new:1", title: "A" },
			{ kind: "update", id: "ENG-1", description: "Related: new:1, new:2" },
		];
		expect(() => collectPlaceholders(ops, isCreate, label)).toThrow(/Op #1: new:2 is not declared/);
	});

	it("leaves a batch that declares nothing as it was: its text goes out as written", () => {
		const ops = [{ kind: "create", title: "A", description: "Related: new:2" }];
		expect(collectPlaceholders(ops, isCreate, label)).toEqual(new Map());
	});

	it("rejects a malformed or repeated declaration", () => {
		expect(() => collectPlaceholders([{ kind: "create", id: "ENG-9", title: "A" }], isCreate, label)).toThrow(
			/must be a placeholder/,
		);
		const twice = [
			{ kind: "create", id: "new:1", title: "A" },
			{ kind: "create", id: "new:1", title: "B" },
		];
		expect(() => collectPlaceholders(twice, isCreate, label)).toThrow(/already declared by Op #0/);
	});

	it("rejects a create whose parent is created in the same batch", () => {
		const ops = [
			{ kind: "create", id: "new:1", title: "A" },
			{ kind: "create", id: "new:2", title: "B", parent: "new:1" },
		];
		expect(() => collectPlaceholders(ops, isCreate, label)).toThrow(/parent new:1 is created in the same batch/);
	});
});

describe("resolvePlaceholders", () => {
	const identifiers = new Map([
		["new:1", "ENG-41"],
		["new:12", "ENG-42"],
	]);

	it("rewrites reference fields and every mention in text", () => {
		const { item, missing } = resolvePlaceholders(
			{ kind: "update", id: "new:1", description: "Done when: a — new:12\nRelated: new:1, new:12" },
			identifiers,
		);
		expect(missing).toEqual([]);
		expect(item).toEqual({
			kind: "update",
			id: "ENG-41",
			description: "Done when: a — ENG-42\nRelated: ENG-41, ENG-42",
		});
	});

	it("returns the op untouched, with what is missing, when a create failed", () => {
		const op = { kind: "comment", issue: "ENG-1", body: "split into new:3" };
		expect(resolvePlaceholders(op, identifiers)).toEqual({ item: op, missing: ["new:3"] });
	});
});
