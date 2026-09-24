import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ValidationError } from "../../src/utils/errors.js";
import { resolveTextOption } from "../../src/utils/index.js";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "elnora-linear-text-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeBody(name: string, contents: string): string {
	const path = join(tmp, name);
	writeFileSync(path, contents);
	return path;
}

const FLAGS = { inlineFlag: "--description", fileFlag: "--description-file" };

describe("resolveTextOption — inline value", () => {
	it("returns the inline string byte-for-byte", () => {
		expect(resolveTextOption({ inline: "Just a line", ...FLAGS })).toBe("Just a line");
	});

	it("does not touch an inline empty string (callers keep their own truthiness rules)", () => {
		expect(resolveTextOption({ inline: "", ...FLAGS })).toBe("");
	});

	it("returns undefined when neither option is given", () => {
		expect(resolveTextOption({ ...FLAGS })).toBeUndefined();
	});
});

describe("resolveTextOption — file value", () => {
	// The whole point of the file option: markdown that a shell would mangle.
	const MARKDOWN = [
		"## Overview",
		"",
		"A body with `backticks`, 'single quotes' and \"double quotes\".",
		"",
		"```ts",
		'const cmd = `echo "$HOME" && rm -rf /`;',
		"```",
		"",
		"- bullet one",
		"- bullet two",
		"",
	].join("\n");

	it("reads the file contents verbatim, including code fences, quotes and newlines", () => {
		const path = writeBody("body.md", MARKDOWN);
		expect(resolveTextOption({ file: path, ...FLAGS })).toBe(MARKDOWN);
	});

	it("preserves leading and trailing whitespace rather than trimming it", () => {
		const path = writeBody("indented.md", "  indented first line\n\ntrailing blank line\n\n");
		expect(resolveTextOption({ file: path, ...FLAGS })).toBe("  indented first line\n\ntrailing blank line\n\n");
	});

	it("rejects a missing file, naming the flag, the path and the underlying reason", () => {
		const missing = join(tmp, "nope.md");
		try {
			resolveTextOption({ file: missing, ...FLAGS });
			throw new Error("expected resolveTextOption to throw");
		} catch (e) {
			expect((e as ValidationError).name).toBe("ValidationError");
			expect((e as ValidationError).message).toContain("--description-file");
			expect((e as ValidationError).message).toContain(missing);
			expect((e as ValidationError).message).toMatch(/ENOENT|no such file/i);
		}
	});

	it("rejects a directory the same way as a missing file", () => {
		expect(() => resolveTextOption({ file: tmp, ...FLAGS })).toThrow(/Cannot read --description-file/);
	});

	// An empty file is almost always a wrong path or a truncated write. Sending
	// it would wipe the field and report success — the exact failure this option
	// exists to prevent.
	it("rejects an empty file instead of writing an empty value", () => {
		const path = writeBody("empty.md", "");
		expect(() => resolveTextOption({ file: path, ...FLAGS })).toThrow(/contained no text/);
	});

	it("rejects a whitespace-only file", () => {
		const path = writeBody("blank.md", "\n\n   \n");
		expect(() => resolveTextOption({ file: path, ...FLAGS })).toThrow(/contained no text/);
	});
});

describe("resolveTextOption — mutual exclusion", () => {
	it("rejects both options together instead of silently picking one", () => {
		const path = writeBody("body.md", "from the file");
		try {
			resolveTextOption({ inline: "from the flag", file: path, ...FLAGS });
			throw new Error("expected resolveTextOption to throw");
		} catch (e) {
			expect((e as ValidationError).name).toBe("ValidationError");
			// Both flag names appear, so the caller knows which pair collided.
			expect((e as ValidationError).message).toContain("--description");
			expect((e as ValidationError).message).toContain("--description-file");
			expect((e as ValidationError).suggestion).toMatch(/not both/);
		}
	});

	it("rejects an inline empty string combined with a file", () => {
		const path = writeBody("body.md", "from the file");
		expect(() => resolveTextOption({ inline: "", file: path, ...FLAGS })).toThrow(/mutually exclusive/);
	});
});

describe("resolveTextOption — required", () => {
	it("rejects neither-given when the value is required, naming both options", () => {
		try {
			resolveTextOption({ inlineFlag: "--body", fileFlag: "--body-file", required: true });
			throw new Error("expected resolveTextOption to throw");
		} catch (e) {
			expect((e as ValidationError).name).toBe("ValidationError");
			expect((e as ValidationError).message).toContain("--body");
			expect((e as ValidationError).message).toContain("--body-file");
		}
	});

	it("accepts either option on its own when required", () => {
		const path = writeBody("comment.md", "looks good");
		expect(
			resolveTextOption({ inline: "looks good", inlineFlag: "--body", fileFlag: "--body-file", required: true }),
		).toBe("looks good");
		expect(resolveTextOption({ file: path, inlineFlag: "--body", fileFlag: "--body-file", required: true })).toBe(
			"looks good",
		);
	});
});
