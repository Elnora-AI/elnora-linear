// `external_command` signal source.
//
// Runs a user-configured shell command and converts the stdout into Signal
// objects. Two parse modes:
//   - "json" (default): expects either a JSON object or a JSON array of
//     objects. Each object becomes one Signal. If `issue_match_field` is
//     set, that field's string value is lifted onto Signal.issueIdentifier.
//   - "lines": each non-empty line becomes one Signal whose payload is
//     `{ line: "..." }`.
//
// The command is run via execFile (NOT a shell), so the command string is
// split into argv directly with parseCommand — no shell expansion, no glob,
// no $VAR interpolation. There's a 30s timeout and a 10MB stdout cap.
//
// Security: this source runs user-configured arbitrary commands. By design —
// it's the generic extension point for the curator. Document accordingly.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Signal, SignalSourceContext, SignalSourceImpl } from "./types.js";

const execFileAsync = promisify(execFile);

export interface ExternalCommandConfig {
	type: "external_command";
	name: string;
	enabled?: boolean;
	command: string;
	parse_as?: "json" | "lines";
	issue_match_field?: string;
}

export class ExternalCommandSource implements SignalSourceImpl {
	readonly config: ExternalCommandConfig;

	constructor(config: ExternalCommandConfig) {
		this.config = config;
	}

	async collect(ctx: SignalSourceContext): Promise<Signal[]> {
		const argv = parseCommand(this.config.command);
		const cmd = argv[0];
		const args = argv.slice(1);
		const { stdout } = await execFileAsync(cmd, args, { timeout: 30_000, maxBuffer: 10_000_000 });
		return parseOutput(stdout, this.config, ctx.now);
	}
}

/**
 * Split a shell-ish command string into argv.
 *
 * Honors double-quoted runs as a single arg. Does NOT interpolate environment
 * variables, handle single-quotes, or process backslash escapes —
 * intentionally simple. For anything fancier, wrap the command in a shell
 * script and reference that.
 */
export function parseCommand(input: string): string[] {
	const parts: string[] = [];
	const re = /"([^"]*)"|(\S+)/g;
	let match: RegExpExecArray | null = re.exec(input);
	while (match !== null) {
		parts.push(match[1] !== undefined ? match[1] : match[2]);
		match = re.exec(input);
	}
	if (parts.length === 0) {
		throw new Error("external_command: command string is empty");
	}
	return parts;
}

export function parseOutput(
	stdout: string,
	config: { name: string; type: string; parse_as?: "json" | "lines"; issue_match_field?: string },
	now: Date,
): Signal[] {
	const mode = config.parse_as ?? "json";
	const receivedAt = now.toISOString();

	if (mode === "lines") {
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((line) => ({
				source: config.name,
				type: config.type,
				payload: { line },
				receivedAt,
			}));
	}

	if (mode === "json") {
		const trimmed = stdout.trim();
		if (trimmed.length === 0) return [];
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (err) {
			throw new Error(`external_command "${config.name}": stdout is not valid JSON: ${(err as Error).message}`);
		}
		const records: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
		return records.map((rec) => {
			const isObj = typeof rec === "object" && rec !== null && !Array.isArray(rec);
			const payload: Record<string, unknown> = isObj ? (rec as Record<string, unknown>) : { value: rec };
			const idCandidate = config.issue_match_field && isObj ? payload[config.issue_match_field] : undefined;
			return {
				source: config.name,
				type: config.type,
				...(typeof idCandidate === "string" ? { issueIdentifier: idCandidate } : {}),
				payload,
				receivedAt,
			};
		});
	}

	throw new Error(`external_command "${config.name}": unsupported parse_as "${mode}". Use "json" or "lines".`);
}
