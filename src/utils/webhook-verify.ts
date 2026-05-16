// Webhook signature verification.
//
// Linear's signing scheme is HMAC-SHA256 of the raw request body, hex-encoded,
// delivered in the `linear-signature` header. The SDK ships a
// LinearWebhookClient but its verify method is private. We compute the digest
// ourselves with node:crypto and use timingSafeEqual to prevent timing attacks
// — this is also the pattern Linear's docs recommend.
//
// Beyond HMAC, the payload carries a `webhookTimestamp` (Unix ms). When the
// caller passes that timestamp into verify(), we reject deltas older than
// maxAgeMs (default 60 seconds, per Linear's published recommendation) so a
// captured request can't be replayed indefinitely.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The header Linear sends with every webhook payload. Re-exported as a
 * constant so server templates can import it from one place.
 */
export const LINEAR_SIGNATURE_HEADER = "linear-signature";

/**
 * Default replay window: 60 seconds. Matches Linear's published recommendation
 * (https://linear.app/developers/webhooks): "verify it's within a minute of
 * the time your system sees it to guard against replay attacks."
 */
export const DEFAULT_WEBHOOK_MAX_AGE_MS = 60 * 1000;

export interface VerifyOptions {
	/** Raw request body, exactly as Linear sent it (do not re-stringify a parsed object). */
	rawBody: string | Buffer;
	/** Value of the `linear-signature` header. */
	signature: string;
	/** The webhook signing secret stored in your env. */
	secret: string;
	/**
	 * The `webhookTimestamp` field from the parsed body (Unix ms). When set,
	 * the verifier rejects payloads older than maxAgeMs. Strongly recommended
	 * for any production receiver — without it, captured requests replay
	 * forever.
	 */
	timestamp?: number;
	/** Replay window in milliseconds. Defaults to 60 seconds. Only consulted when timestamp is set. */
	maxAgeMs?: number;
	/** Override the current time (for testing). Defaults to Date.now(). */
	nowMs?: number;
}

/**
 * Verify a Linear webhook payload's HMAC-SHA256 signature. Returns true on
 * match, false otherwise. Never throws.
 *
 * Both inputs are length-checked before timingSafeEqual since timingSafeEqual
 * itself throws on length mismatch — that throw would itself be a timing leak.
 *
 * If timestamp is provided, the function also enforces a replay window:
 * payloads older than maxAgeMs are rejected even with a valid HMAC.
 */
export function verifyLinearWebhook(opts: VerifyOptions): boolean {
	if (!opts.signature || !opts.secret) return false;

	const body = typeof opts.rawBody === "string" ? Buffer.from(opts.rawBody, "utf-8") : opts.rawBody;
	const expectedHex = createHmac("sha256", opts.secret).update(body).digest("hex");
	const expected = Buffer.from(expectedHex, "hex");
	let received: Buffer;
	try {
		received = Buffer.from(opts.signature, "hex");
	} catch {
		return false;
	}
	if (received.length !== expected.length) return false;
	if (!timingSafeEqual(received, expected)) return false;

	if (typeof opts.timestamp === "number") {
		const maxAgeMs = opts.maxAgeMs ?? DEFAULT_WEBHOOK_MAX_AGE_MS;
		const now = opts.nowMs ?? Date.now();
		// Reject anything outside [now - maxAgeMs, now + maxAgeMs]. The forward
		// bound catches future-dated forgeries (clock skew + a small grace).
		if (!Number.isFinite(opts.timestamp)) return false;
		const delta = Math.abs(now - opts.timestamp);
		if (delta > maxAgeMs) return false;
	}

	return true;
}
