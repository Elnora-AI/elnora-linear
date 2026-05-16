import { describe, expect, it } from "vitest";

import { buildReactionInput } from "../../src/commands/reactions.js";
import { ValidationError } from "../../src/utils/errors.js";

describe("buildReactionInput", () => {
	it("returns issueId for issue-identifier targets", () => {
		const input = buildReactionInput("ENG-42", "+1", false);
		expect(input).toEqual({ emoji: "+1", issueId: "ENG-42" });
	});

	it("returns issueId when --issue + UUID", () => {
		const uuid = "12345678-1234-1234-1234-1234567890ab";
		const input = buildReactionInput(uuid, "+1", true);
		expect(input).toEqual({ emoji: "+1", issueId: uuid });
	});

	it("defaults UUID targets to commentId", () => {
		const uuid = "12345678-1234-1234-1234-1234567890ab";
		const input = buildReactionInput(uuid, "+1", false);
		expect(input).toEqual({ emoji: "+1", commentId: uuid });
	});

	it("throws when emoji missing", () => {
		expect(() => buildReactionInput("ENG-1", "", false)).toThrow(ValidationError);
	});

	it("throws on garbage target", () => {
		expect(() => buildReactionInput("not-anything", "+1", false)).toThrow(ValidationError);
	});
});
