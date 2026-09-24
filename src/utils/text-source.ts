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

/**
 * Reads a text file for a `--<name>-file` option. `-` reads stdin, matching the
 * convention already used by `issues batch-create` and friends. Paths are
 * resolved against the working directory; `~` is not expanded (no shell here).
 */
function readTextFile(file: string, fileFlag: string): string {
	const label = file === "-" ? "stdin" : `"${file}"`;
	try {
		return file === "-" ? readFileSync(0, "utf-8") : readFileSync(resolvePath(file), "utf-8");
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(
			`Cannot read ${fileFlag} ${label}: ${msg}`,
			"Pass a readable path (relative paths resolve against the working directory; '~' is not expanded), or '-' to read stdin.",
		);
	}
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
 * cannot be read, or when the file holds no text. An empty file is almost
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
