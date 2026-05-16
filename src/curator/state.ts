// Curator state file — persists pending questions, processed thread keys,
// and per-run stats across invocations.
//
// Default path: ~/.config/elnora-linear/state/curator-state.json (overridable via
// LINEAR_CURATOR_STATE_DIR env var). Append-only report at
// ~/.config/elnora-linear/state/curator-report.jsonl.
//
// File-locked write — we open with a `.lock` sibling to make sure a second
// curator run doesn't trample a first one mid-write.

import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PendingQuestion } from "./snapshot.js";

export interface CuratorRunStats {
	ranAt: string;
	durationMs: number;
	signalsCollected: number;
	highApplied: number;
	mediumQueued: number;
	lowReported: number;
	errors: string[];
}

export interface CuratorState {
	$schema?: string;
	version: 1;
	pending_questions: PendingQuestion[];
	processed_thread_keys: string[];
	out_of_band_queue: { issue_id: string; mentioned_in_thread_key: string; mentioned_at: string }[];
	last_run_ended_at: string | null;
	stats: CuratorRunStats[];
}

const PROCESSED_KEYS_CAP = 1000;
const STATS_CAP = 30;

export interface StateDirOptions {
	stateDir?: string;
}

export function resolveStateDir(opts: StateDirOptions = {}): string {
	if (opts.stateDir) return opts.stateDir;
	if (process.env.LINEAR_CURATOR_STATE_DIR) return process.env.LINEAR_CURATOR_STATE_DIR;
	return join(homedir(), ".config", "elnora-linear", "state");
}

export function statePath(opts: StateDirOptions = {}): string {
	return join(resolveStateDir(opts), "curator-state.json");
}

export function reportPath(opts: StateDirOptions = {}): string {
	return join(resolveStateDir(opts), "curator-report.jsonl");
}

function emptyState(): CuratorState {
	return {
		version: 1,
		pending_questions: [],
		processed_thread_keys: [],
		out_of_band_queue: [],
		last_run_ended_at: null,
		stats: [],
	};
}

export function loadState(opts: StateDirOptions = {}): CuratorState {
	const path = statePath(opts);
	if (!existsSync(path)) return emptyState();
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as Partial<CuratorState>;
		if (parsed.version !== 1) {
			process.stderr.write(`Warning: curator-state.json has unexpected version ${parsed.version}; resetting.\n`);
			return emptyState();
		}
		return {
			version: 1,
			pending_questions: parsed.pending_questions ?? [],
			processed_thread_keys: parsed.processed_thread_keys ?? [],
			out_of_band_queue: parsed.out_of_band_queue ?? [],
			last_run_ended_at: parsed.last_run_ended_at ?? null,
			stats: parsed.stats ?? [],
		};
	} catch (err) {
		process.stderr.write(`Warning: failed to read curator-state.json: ${(err as Error).message}; resetting.\n`);
		return emptyState();
	}
}

export function saveState(state: CuratorState, opts: StateDirOptions = {}): void {
	const dir = resolveStateDir(opts);
	mkdirSync(dir, { recursive: true });
	const path = statePath(opts);
	const lockPath = `${path}.lock`;

	// Best-effort single-writer guarantee. If a stale lock exists we replace it
	// — the curator runs at most once at a time per cron/launchd schedule, so a
	// surviving lock means the previous run crashed.
	if (existsSync(lockPath)) {
		process.stderr.write(`Warning: stale lock ${lockPath} found; overwriting.\n`);
	}
	const fd = openSync(lockPath, "w");
	try {
		// Trim caps before serializing.
		if (state.processed_thread_keys.length > PROCESSED_KEYS_CAP) {
			state.processed_thread_keys = state.processed_thread_keys.slice(-PROCESSED_KEYS_CAP);
		}
		if (state.stats.length > STATS_CAP) {
			state.stats = state.stats.slice(-STATS_CAP);
		}
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
		renameSync(tmp, path);
	} finally {
		closeSync(fd);
		try {
			renameSync(lockPath, `${lockPath}.released`);
		} catch {}
		// Clean up the released marker (best effort).
		try {
			const releasedPath = `${lockPath}.released`;
			if (existsSync(releasedPath)) {
				unlinkSync(releasedPath);
			}
		} catch {}
	}
}

export function appendReportLine(entry: Record<string, unknown>, opts: StateDirOptions = {}): void {
	const dir = resolveStateDir(opts);
	mkdirSync(dir, { recursive: true });
	const path = reportPath(opts);
	const line = `${JSON.stringify({ ...entry, _ts: new Date().toISOString() })}\n`;
	const fd = openSync(path, "a");
	try {
		writeFileSync(fd, line, { encoding: "utf-8" });
	} finally {
		closeSync(fd);
	}
}

/**
 * Debounce key for a proposed action: `${issue_id}:${stable-hash(action)}`.
 * Used to avoid re-asking the same question or re-applying the same change
 * within a configurable lookback window (default 14 days).
 */
export function debounceKey(issueId: string, action: Record<string, unknown>): string {
	return `${issueId}:${JSON.stringify(action)}`;
}

export const _internal = { emptyState, PROCESSED_KEYS_CAP, STATS_CAP };
