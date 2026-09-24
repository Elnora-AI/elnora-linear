// Long-form markdown — issue descriptions, comment bodies — is unsafe to pass
// as a shell argument. Fenced code blocks, backticks, `$`, and both quote kinds
// all mean something to the shell before the CLI ever sees them, and a body of
// any size runs into ARG_MAX. So every long-text option gets a `<name>-file`
// sibling that reads the text straight off disk, following the file-reading
// precedent already set by `webhooks verify --body <file>`.
//
// The two options are mutually exclusive on purpose: a silent precedence rule
// would let a caller believe the file was written when the inline string won.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { ValidationError } from "./errors.js";

/** UTF-16 byte-order marks, by the first two bytes of the file. */
const UTF16_BOMS = [
	{ bytes: [0xff, 0xfe], name: "UTF-16LE", mark: "FF FE" },
	{ bytes: [0xfe, 0xff], name: "UTF-16BE", mark: "FE FF" },
] as const;

const RE_ENCODE_HINT =
	"Re-save the file as UTF-8 and pass it again — PowerShell: `Set-Content -Encoding utf8 <path> -Value $text` (`>` and `Out-File` default to UTF-16LE, `Set-Content` to ANSI); macOS/Linux: `iconv -f <encoding> -t UTF-8`.";

/**
 * Decodes file bytes as UTF-8, refusing anything that is not valid UTF-8.
 *
 * Decoding invalid bytes leniently replaces each one with U+FFFD, which leaves
 * a non-empty string that passes every later check — so the command would print
 * success while writing mojibake. Guessing the real encoding would only make
 * that failure subtler, so the reader rejects instead, on the same reasoning as
 * the empty-file rule below: a file the caller did not mean to send is worth an
 * error, not a silent write.
 *
 * A UTF-16 byte-order mark is named explicitly because it is the likeliest way
 * to get here — PowerShell's `>` and `Out-File` write UTF-16LE by default, so a
 * caller who followed the docs to the letter lands on exactly these bytes.
 *
 * A UTF-8 BOM is valid UTF-8 and is what Windows PowerShell writes for
 * `-Encoding utf8`, so it is accepted; the marker itself is dropped, because a
 * leading U+FEFF stops the first line of a markdown document parsing as a
 * heading. Nothing else about the contents is changed.
 */
function decodeUtf8(bytes: Buffer, subject: string): string {
	const bom = UTF16_BOMS.find((b) => bytes[0] === b.bytes[0] && bytes[1] === b.bytes[1]);
	if (bom) {
		throw new ValidationError(
			`${subject} is ${bom.name}, not UTF-8 (it starts with a ${bom.name} byte-order mark, ${bom.mark}).`,
			RE_ENCODE_HINT,
		);
	}
	try {
		// ignoreBOM: false is what drops a leading UTF-8 BOM. It is the default,
		// but spelled out here because dropping the marker is a deliberate choice.
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
	} catch {
		throw new ValidationError(`${subject} is not valid UTF-8 text.`, RE_ENCODE_HINT);
	}
}

/**
 * Reads a text file for a `--<name>-file` option. `-` reads stdin, matching the
 * convention already used by `issues batch-create` and friends. Paths are
 * resolved against the working directory; `~` is not expanded (no shell here).
 */
function readTextFile(file: string, fileFlag: string): string {
	const label = file === "-" ? "stdin" : `"${file}"`;
	let bytes: Buffer;
	try {
		bytes = file === "-" ? readFileSync(0) : readFileSync(resolvePath(file));
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(
			`Cannot read ${fileFlag} ${label}: ${msg}`,
			"Pass a readable path (relative paths resolve against the working directory; '~' is not expanded), or '-' to read stdin.",
		);
	}
	return decodeUtf8(bytes, `${fileFlag} ${label}`);
}

export interface TextOptionSource {
	/** Value of the inline string option, as Commander parsed it. */
	inline?: string;
	/** Value of the `--<name>-file` option, as Commander parsed it. */
	file?: string;
	/** Inline option name, for error messages — e.g. `--description`. */
	inlineFlag: string;
	/** File option name, for error messages — e.g. `--description-file`. */
	fileFlag: string;
	/** Set when the command cannot run without the text at all. */
	required?: boolean;
}

/**
 * Resolves the text a long-form option carries from either the inline string or
 * the file, and returns it verbatim — no trimming, because leading whitespace
 * inside a fenced block is load-bearing.
 *
 * Throws {@link ValidationError} when both options are given, when the file
 * cannot be read, when it is not valid UTF-8, or when the file holds no text.
 * An empty file is almost
 * always a wrong path or a truncated write; accepting it would blank the field
 * and report success, which is the failure this option exists to prevent.
 */
export function resolveTextOption(source: TextOptionSource & { required: true }): string;
export function resolveTextOption(source: TextOptionSource): string | undefined;
export function resolveTextOption(source: TextOptionSource): string | undefined {
	const { inline, file, inlineFlag, fileFlag, required } = source;

	if (inline !== undefined && file !== undefined) {
		throw new ValidationError(
			`${inlineFlag} and ${fileFlag} are mutually exclusive.`,
			`Pass the text inline with ${inlineFlag}, or a path (or '-' for stdin) with ${fileFlag} — not both.`,
		);
	}

	if (file !== undefined) {
		const text = readTextFile(file, fileFlag);
		if (text.trim() === "") {
			throw new ValidationError(
				`${fileFlag} ${file === "-" ? "stdin" : `"${file}"`} contained no text.`,
				`Write the text to the file before passing it, or pass it inline with ${inlineFlag}.`,
			);
		}
		return text;
	}

	if (inline !== undefined) return inline;

	if (required) {
		throw new ValidationError(
			`One of ${inlineFlag} or ${fileFlag} is required.`,
			`Pass the text inline with ${inlineFlag}, or a path (or '-' for stdin) with ${fileFlag}.`,
		);
	}

	return undefined;
}
