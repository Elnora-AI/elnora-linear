// Input parsing and validation utilities.
// Pure functions — no side effects, no API calls.

import { ValidationError } from "./errors.js";

/**
 * Parse and validate a --limit option (or any positive-integer flag capped at
 * Linear's 250-per-page API max). Returns the parsed number. Throws
 * ValidationError for invalid values. Pass `flagName` to customize the label
 * that appears in the error and warning text — defaults to "--limit".
 */
export function parseLimit(value: string | undefined, defaultValue = 50, flagName = "--limit"): number {
	if (!value) return defaultValue;
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) {
		throw new ValidationError(`Invalid ${flagName} value: "${value}". Must be a positive integer.`);
	}
	if (n > 250) {
		process.stderr.write(`Warning: ${flagName} ${n} capped to 250 (Linear API max).\n`);
		return 250;
	}
	return n;
}

/**
 * Parse a positive integer with no upper cap. Use for flags like --max where
 * the value can legitimately exceed the API page limit (we just paginate).
 * Returns `defaultValue` (default Infinity) when unset.
 */
export function parsePositiveInt(value: string | undefined, flagName: string, defaultValue: number = Infinity): number {
	if (!value) return defaultValue;
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) {
		throw new ValidationError(`Invalid ${flagName} value: "${value}". Must be a positive integer.`);
	}
	return n;
}

/**
 * Parse and validate a --priority option. Returns the parsed number. Throws
 * ValidationError for invalid values (must be 0-4).
 */
export function parsePriority(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const n = parseInt(value, 10);
	if (Number.isNaN(n) || n < 0 || n > 4) {
		throw new ValidationError(
			`Invalid --priority value: "${value}". Must be 0 (None), 1 (Urgent), 2 (High), 3 (Normal), or 4 (Low).`,
		);
	}
	return n;
}

/**
 * Parse and validate a customer-need --priority option. CustomerNeed priority
 * is a 0/1 importance flag, not the Issue priority enum: `0 = Not important`,
 * `1 = Important`. Routing this through parsePriority would silently let
 * 2/3/4 through to the server, which then rejects them — confusing.
 */
export function parseNeedPriority(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const n = parseInt(value, 10);
	if (Number.isNaN(n) || (n !== 0 && n !== 1)) {
		throw new ValidationError(
			`Invalid --priority value: "${value}". Customer needs only accept 0 (Not important) or 1 (Important).`,
		);
	}
	return n;
}

/**
 * Parse and validate a date option (YYYY-MM-DD). Returns the validated string
 * or undefined if not provided.
 */
export function parseDate(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new ValidationError(`Invalid date: "${value}". Must be in YYYY-MM-DD format.`);
	}
	const d = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) {
		throw new ValidationError(`Invalid date: "${value}". Not a valid calendar date.`);
	}
	// Reject silent rollover (e.g., 2026-02-30 → 2026-03-02).
	if (d.toISOString().slice(0, 10) !== value) {
		throw new ValidationError(`Invalid date: "${value}". Not a real calendar date.`);
	}
	return value;
}

/**
 * Parse and validate a hex color option. Accepts formats: #RGB, #RRGGBB
 * (with or without #).
 */
export function parseColor(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const hex = value.startsWith("#") ? value : `#${value}`;
	if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
		throw new ValidationError(`Invalid color: "${value}". Must be a hex color (e.g., #FF0000 or #F00).`);
	}
	return hex;
}

const VALID_HEALTH_VALUES = ["onTrack", "atRisk", "offTrack"] as const;

export function parseHealth(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (!(VALID_HEALTH_VALUES as readonly string[]).includes(value)) {
		throw new ValidationError(`Invalid --health value: "${value}". Must be one of: ${VALID_HEALTH_VALUES.join(", ")}.`);
	}
	return value;
}

const VALID_PROJECT_STATES = ["backlog", "planned", "started", "paused", "completed", "canceled"] as const;

export function parseProjectState(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (!(VALID_PROJECT_STATES as readonly string[]).includes(value)) {
		throw new ValidationError(`Invalid --state value: "${value}". Must be one of: ${VALID_PROJECT_STATES.join(", ")}.`);
	}
	return value;
}

/**
 * Parse and validate a --timeout value (seconds). Returns milliseconds for
 * direct use with setTimeout. Accepts fractional values; rejects 0, negatives,
 * NaN, and Infinity.
 */
export function parseTimeoutSeconds(value: string): number {
	const n = Number(value);
	if (value === "" || !Number.isFinite(n) || n <= 0) {
		throw new ValidationError(`Invalid --timeout value: "${value}". Must be a positive number of seconds.`);
	}
	return Math.round(n * 1000);
}

/**
 * Guard: throws if an update object has no fields set. Use in update commands
 * to catch empty updates before sending to the API.
 */
export function requireNonEmptyUpdate(update: Record<string, unknown>): void {
	const keys = Object.keys(update).filter((k) => update[k] !== undefined);
	if (keys.length === 0) {
		throw new ValidationError("No update options provided. Use --help to see available options.");
	}
}

/**
 * Guard: throws if `--yes` flag isn't set on a destructive command. Forces an
 * explicit confirmation step that prompt-injected agents can't skip by talking
 * themselves out of it.
 */
export function requireYes(opts: Record<string, unknown>, action: string): void {
	if (!opts.yes) {
		throw new ValidationError(
			`Refusing to ${action} without --yes. This operation is irreversible.`,
			"Re-run with --yes to confirm.",
		);
	}
}
