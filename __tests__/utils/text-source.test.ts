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

/** Writes exact bytes, so a test can hand the reader a non-UTF-8 file. */
function writeBytes(name: string, bytes: Buffer): string {
	const path = join(tmp, name);
	writeFileSync(path, bytes);
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

// Decoding a non-UTF-8 file as UTF-8 replaces every undecodable byte with
// U+FFFD, and the result is still non-empty text, so the command would report
// success while writing mojibake. The reader refuses instead of guessing an
// encoding — same reasoning as the empty-file rule.
describe("resolveTextOption — file encoding", () => {
	const MARKDOWN = "# Repro\n\nAccented: café\n";

	it("rejects a UTF-16LE file, naming the byte-order mark rather than just 'invalid'", () => {
		const path = writeBytes("utf16le.md", Buffer.from(`﻿${MARKDOWN}`, "utf16le"));
		try {
			resolveTextOption({ file: path, ...FLAGS });
			throw new Error("expected resolveTextOption to throw");
		} catch (e) {
			expect((e as ValidationError).name).toBe("ValidationError");
			expect((e as ValidationError).message).toContain("--description-file");
			expect((e as ValidationError).message).toContain(path);
			expect((e as ValidationError).message).toContain("UTF-16");
			expect((e as ValidationError).suggestion).toMatch(/utf8|UTF-8/);
		}
	});

	it("rejects a UTF-16BE file the same way", () => {
		const path = writeBytes("utf16be.md", Buffer.from(`﻿${MARKDOWN}`, "utf16le").swap16());
		try {
			resolveTextOption({ file: path, ...FLAGS });
			throw new Error("expected resolveTextOption to throw");
		} catch (e) {
			expect((e as ValidationError).name).toBe("ValidationError");
			expect((e as ValidationError).message).toContain("UTF-16");
		}
	});

	// No BOM to name here — just bytes that cannot be UTF-8.
	it("rejects a latin-1 file with accented characters as invalid UTF-8", () => {
		const path = writeBytes("latin1.md", Buffer.from("# Café résumé naïve\n", "latin1"));
		try {
			resolveTextOption({ file: path, ...FLAGS });
			throw new Error("expected resolveTextOption to throw");
		} catch (e) {
			expect((e as ValidationError).name).toBe("ValidationError");
			expect((e as ValidationError).message).toContain("--description-file");
			expect((e as ValidationError).message).toContain(path);
			expect((e as ValidationError).message).toMatch(/not valid UTF-8/i);
			expect((e as ValidationError).suggestion).toMatch(/utf8|UTF-8/);
		}
	});

	// A UTF-8 BOM is valid UTF-8 and is what Windows PowerShell writes for
	// `-Encoding utf8`, so it is accepted — but the marker itself is dropped,
	// because a leading U+FEFF stops the first line parsing as a heading.
	it("accepts a UTF-8 file with a BOM and strips the marker", () => {
		const path = writeBytes("utf8-bom.md", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(MARKDOWN)]));
		expect(resolveTextOption({ file: path, ...FLAGS })).toBe(MARKDOWN);
	});

	it("accepts a UTF-8 file without a BOM, unchanged", () => {
		const path = writeBytes("utf8.md", Buffer.from(MARKDOWN));
		expect(resolveTextOption({ file: path, ...FLAGS })).toBe(MARKDOWN);
	});

	it("passes multi-byte UTF-8 through untouched", () => {
		const text = "Protein å→β, 温度 37 °C, emoji 🧬, math ∑∆\n";
		const path = writeBytes("multibyte.md", Buffer.from(text, "utf8"));
		const resolved = resolveTextOption({ file: path, ...FLAGS });
		expect(resolved).toBe(text);
		expect(Buffer.from(resolved as string, "utf8")).toEqual(Buffer.from(text, "utf8"));
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
