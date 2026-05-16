// Rate-limit retry wrapper for Linear SDK calls.
//
// Linear returns rate-limit errors two ways depending on the surface:
//   - GraphQL: HTTP 400 with errors[].extensions.code === "RATELIMITED"
//     (current canonical signal — see https://linear.app/developers/rate-limiting)
//   - Some paths: HTTP 429
// The SDK normalises both into RatelimitedLinearError (errors[0].type ===
// "ratelimited"), exposing retryAfter (seconds) parsed from the retry-after
// header. We catch the SDK error, honour its retryAfter, and re-run the fn up
// to MAX_RETRIES times.

import { sleep } from "./sleep.js";

const MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 60_000;
// Cap so a hostile or buggy retry-after header can't stall the process for
// hours. Linear's rate-limit windows reset in seconds-to-minutes.
const MAX_RETRY_AFTER_MS = 60_000;

function isRateLimitError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const e = error as {
		name?: string;
		type?: string;
		status?: number;
		response?: { status?: number };
	};
	return (
		e.name === "RatelimitedLinearError" ||
		e.type === "Ratelimited" ||
		e.type === "ratelimited" ||
		e.status === 429 ||
		e.response?.status === 429
	);
}

/**
 * Pull the retry delay (ms) out of a Linear SDK error.
 *
 * RatelimitedLinearError exposes `retryAfter` (seconds) directly — the SDK
 * already parsed the retry-after header into a number. Earlier code tried to
 * read `error.response.headers["retry-after"]`, but `headers` is a Fetch
 * Headers object whose values are only readable via `.get()` — bracket access
 * always returned undefined, so the wrapper silently fell back to the 60s
 * default on every retry instead of honouring Linear's hint.
 */
function parseRetryAfter(error: unknown): number {
	const raw = readRetryAfterMs(error);
	const ms = raw ?? DEFAULT_RETRY_AFTER_MS;
	return Math.min(ms, MAX_RETRY_AFTER_MS);
}

function readRetryAfterMs(error: unknown): number | null {
	if (!error || typeof error !== "object") return null;
	const e = error as {
		retryAfter?: number;
		response?: { headers?: Headers | Record<string, string> };
	};
	if (typeof e.retryAfter === "number" && e.retryAfter > 0) {
		return e.retryAfter * 1000;
	}
	// Defensive fallback: also try to read the raw header in case a non-SDK
	// caller wraps an error without the parsed retryAfter property.
	const headers = e.response?.headers;
	let rawHeader: string | null | undefined;
	if (headers && typeof (headers as Headers).get === "function") {
		rawHeader = (headers as Headers).get("retry-after");
	} else if (headers && typeof headers === "object") {
		rawHeader = (headers as Record<string, string>)["retry-after"];
	}
	if (rawHeader) {
		const seconds = parseInt(rawHeader, 10);
		if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
	}
	return null;
}

/**
 * Run fn, retry on 429 with Retry-After. Max 3 retries — after that the
 * original error propagates.
 */
export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			if (!isRateLimitError(error) || attempt === MAX_RETRIES) throw error;
			const waitMs = parseRetryAfter(error);
			process.stderr.write(
				`Linear API rate-limited: retrying in ${Math.ceil(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})...\n`,
			);
			await sleep(waitMs);
		}
	}
	throw lastError;
}

// Exported for testing
export const _internal = { isRateLimitError, parseRetryAfter, MAX_RETRY_AFTER_MS };
