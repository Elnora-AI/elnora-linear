// CLI output helpers for elnora-linear commands.
//
// Provides a single contract every command-handler uses:
//   - outputSuccess(data) → stdout, exit 0
//   - outputError(err) inside handleAsyncCommand → stderr, exit 1+
//
// Supports JSON (default), table (`--output table`), and CSV (`--output csv`)
// formats, optional pretty-printing (`--pretty`), and field filtering
// (`--fields name,email`). JSON is compact by default — agents are the primary
// consumer and pretty-printing burns ~30% extra tokens for nothing.

import { CliError, EXIT_CODES, ValidationError } from "../utils/errors.js";
import { withRateLimit } from "../utils/rate-limit.js";
import { redactSecrets } from "./formatter.js";

let prettyMode = false;
export function setPrettyMode(value: boolean): void {
	prettyMode = value;
}

type OutputFormat = "json" | "table" | "csv";
let outputFormat: OutputFormat = "json";
export function setOutputFormat(value: string): void {
	const valid: OutputFormat[] = ["json", "table", "csv"];
	if (!valid.includes(value as OutputFormat)) {
		throw new ValidationError(`Invalid --output value: "${value}". Must be one of: ${valid.join(", ")}.`);
	}
	outputFormat = value as OutputFormat;
}

let fieldFilter: string[] | null = null;
export function setFields(value: string): void {
	const fields = value
		.split(",")
		.map((f) => f.trim())
		.filter(Boolean);
	if (fields.length === 0) {
		throw new ValidationError(`Invalid --fields value: "${value}". Provide comma-separated field names.`);
	}
	fieldFilter = fields;
}

export function getFields(): string[] | null {
	return fieldFilter;
}

/** Test-only: reset module-level state between tests. */
export function _resetOutputState(): void {
	prettyMode = false;
	outputFormat = "json";
	fieldFilter = null;
}

function findDataArray(data: unknown): { key: string; rows: Record<string, unknown>[] } | null {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
	const obj = data as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0) {
			const first = (obj[key] as unknown[])[0];
			if (typeof first === "object" && first !== null) {
				return { key, rows: obj[key] as Record<string, unknown>[] };
			}
		}
	}
	return null;
}

function formatCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function unionKeys(rows: Record<string, unknown>[]): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const row of rows) {
		for (const k of Object.keys(row)) {
			if (!seen.has(k)) {
				seen.add(k);
				ordered.push(k);
			}
		}
	}
	return ordered;
}

function outputTable(data: unknown): void {
	const found = findDataArray(data);
	if (!found) {
		process.stderr.write("Warning: --output table requested but response is not a list. Falling back to JSON.\n");
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
		return;
	}

	const { rows } = found;
	const keys = unionKeys(rows);
	const cells = rows.map((row) => keys.map((k) => formatCell(row[k])));

	const MAX_COL_WIDTH = 60;
	const widths = keys.map((k, i) => Math.min(MAX_COL_WIDTH, Math.max(k.length, ...cells.map((row) => row[i].length))));

	function truncateCell(value: string, maxWidth: number): string {
		return value.length > maxWidth ? `${value.slice(0, maxWidth - 3)}...` : value;
	}

	const header = keys.map((k, i) => k.toUpperCase().padEnd(widths[i])).join("  ");
	const separator = widths.map((w) => "-".repeat(w)).join("  ");
	process.stdout.write(`${header}\n`);
	process.stdout.write(`${separator}\n`);

	for (const row of cells) {
		process.stdout.write(`${row.map((c, i) => truncateCell(c, widths[i]).padEnd(widths[i])).join("  ")}\n`);
	}

	const obj = data as Record<string, unknown>;
	const meta: string[] = [];
	for (const [k, v] of Object.entries(obj)) {
		if (k !== found.key && typeof v !== "object") {
			meta.push(`${k}: ${v}`);
		}
	}
	if (meta.length > 0) {
		process.stdout.write(`\n${meta.join(" | ")}\n`);
	}
}

function csvEscape(value: string): string {
	if (value.includes(",") || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function outputCsv(data: unknown): void {
	const found = findDataArray(data);
	if (!found) {
		process.stderr.write("Warning: --output csv requested but response is not a list. Falling back to JSON.\n");
		process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
		return;
	}

	const { rows } = found;
	const keys = unionKeys(rows);

	process.stdout.write(`${keys.map((k) => csvEscape(k)).join(",")}\n`);

	for (const row of rows) {
		process.stdout.write(`${keys.map((k) => csvEscape(formatCell(row[k]))).join(",")}\n`);
	}
}

function pickFields(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
	const filtered: Record<string, unknown> = {};
	for (const field of fields) {
		if (field in row) filtered[field] = row[field];
	}
	return filtered;
}

function applyFieldFilter(data: unknown): unknown {
	if (!fieldFilter) return data;
	const found = findDataArray(data);

	if (found) {
		if (found.rows.length > 0) {
			const availableFields = Object.keys(found.rows[0]);
			const missingFields = fieldFilter.filter((f) => !(f in found.rows[0]));
			if (missingFields.length === fieldFilter.length) {
				throw new ValidationError(
					`--fields requested only non-existent field(s): ${missingFields.join(", ")}. Available: ${availableFields.join(", ")}`,
				);
			}
			if (missingFields.length > 0) {
				process.stderr.write(
					`Warning: --fields requested non-existent field(s): ${missingFields.join(", ")}. Available: ${availableFields.join(", ")}\n`,
				);
			}
		}

		const filteredRows = found.rows.map((row) => pickFields(row, fieldFilter as string[]));
		const obj = { ...(data as Record<string, unknown>) };
		obj[found.key] = filteredRows;
		return obj;
	}

	if (typeof data === "object" && data !== null && !Array.isArray(data)) {
		const obj = data as Record<string, unknown>;
		const availableFields = Object.keys(obj);
		const missingFields = fieldFilter.filter((f) => !(f in obj));
		if (missingFields.length === fieldFilter.length) {
			throw new ValidationError(
				`--fields requested only non-existent field(s): ${missingFields.join(", ")}. Available: ${availableFields.join(", ")}`,
			);
		}
		if (missingFields.length > 0) {
			process.stderr.write(
				`Warning: --fields requested non-existent field(s): ${missingFields.join(", ")}. Available: ${availableFields.join(", ")}\n`,
			);
		}
		return pickFields(obj, fieldFilter);
	}

	process.stderr.write("Warning: --fields requested but response is not a list or object. Field filter ignored.\n");
	return data;
}

export function outputSuccess(data: unknown): void {
	const filtered = applyFieldFilter(data);
	switch (outputFormat) {
		case "table":
			outputTable(filtered);
			break;
		case "csv":
			outputCsv(filtered);
			break;
		default:
			process.stdout.write(`${prettyMode ? JSON.stringify(filtered, null, 2) : JSON.stringify(filtered)}\n`);
	}
}

const AUDIT_PII_METADATA_KEYS = new Set(["apiKeyId", "apiKeyLabel", "oauthClientId", "oauthClientName"]);

/**
 * Mask PII / sensitive identifiers in a single Linear audit log entry.
 * Returns a NEW object — never mutates the input.
 */
export function redactAuditEntry(entry: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...entry };
	if ("ip" in out && out.ip != null && out.ip !== "") {
		out.ip = "[REDACTED]";
	}
	if (out.metadata && typeof out.metadata === "object" && !Array.isArray(out.metadata)) {
		const md = { ...(out.metadata as Record<string, unknown>) };
		for (const key of AUDIT_PII_METADATA_KEYS) {
			if (key in md && md[key] != null && md[key] !== "") {
				md[key] = "[REDACTED]";
			}
		}
		out.metadata = md;
	}
	return out;
}

export function outputError(error: unknown): void {
	if (error instanceof CliError) {
		const payload: Record<string, unknown> = {
			error: redactSecrets(error.userMessage),
		};
		if (error.suggestion) {
			payload.suggestion = error.suggestion;
		}
		if (error.data) {
			for (const [k, v] of Object.entries(error.data)) {
				if (!(k in payload)) payload[k] = v;
			}
		}
		process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
	} else if (error instanceof Error) {
		const payload: Record<string, string> = {
			error: redactSecrets(error.message),
			type: error.constructor.name,
		};
		if (process.env.LINEAR_CLI_DEBUG) {
			payload.stack = redactSecrets(error.stack ?? "");
		}
		process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
	} else {
		process.stderr.write(`${JSON.stringify({ error: redactSecrets(String(error)) }, null, 2)}\n`);
	}
}

// biome-ignore lint/suspicious/noExplicitAny: handler wrapper must accept any commander action shape
type AsyncHandler = (...args: any[]) => Promise<void>;

export function handleAsyncCommand<T extends AsyncHandler>(fn: T): T {
	return (async (...args: unknown[]) => {
		try {
			await withRateLimit(() => fn(...args));
		} catch (error) {
			outputError(error);
			const code = error instanceof CliError ? error.exitCode : EXIT_CODES.GENERAL;
			process.exit(code);
		}
	}) as T;
}
