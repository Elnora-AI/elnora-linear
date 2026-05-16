import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DEFAULT_WEBHOOK_MAX_AGE_MS, LINEAR_SIGNATURE_HEADER, verifyLinearWebhook } from "../../src/utils/index.js";

const SECRET = "test-secret";
const BODY = JSON.stringify({ webhookTimestamp: 1_700_000_000_000, data: { id: "abc" } });

function sign(body: string, secret = SECRET): string {
	return createHmac("sha256", secret).update(body).digest("hex");
}

describe("LINEAR_SIGNATURE_HEADER", () => {
	it("exports the expected header name", () => {
		expect(LINEAR_SIGNATURE_HEADER).toBe("linear-signature");
	});
});

describe("verifyLinearWebhook", () => {
	it("returns true on valid HMAC, no timestamp check", () => {
		const sig = sign(BODY);
		expect(verifyLinearWebhook({ rawBody: BODY, signature: sig, secret: SECRET })).toBe(true);
	});

	it("accepts Buffer rawBody", () => {
		const sig = sign(BODY);
		expect(verifyLinearWebhook({ rawBody: Buffer.from(BODY, "utf-8"), signature: sig, secret: SECRET })).toBe(true);
	});

	it("returns false on tampered body", () => {
		const sig = sign(BODY);
		expect(verifyLinearWebhook({ rawBody: `${BODY}x`, signature: sig, secret: SECRET })).toBe(false);
	});

	it("returns false on wrong secret", () => {
		const sig = sign(BODY, "other-secret");
		expect(verifyLinearWebhook({ rawBody: BODY, signature: sig, secret: SECRET })).toBe(false);
	});

	it("returns false on missing inputs", () => {
		expect(verifyLinearWebhook({ rawBody: BODY, signature: "", secret: SECRET })).toBe(false);
		expect(verifyLinearWebhook({ rawBody: BODY, signature: sign(BODY), secret: "" })).toBe(false);
	});

	it("returns false on garbage signature hex (length mismatch)", () => {
		expect(verifyLinearWebhook({ rawBody: BODY, signature: "abcd", secret: SECRET })).toBe(false);
	});

	it("returns false on non-hex signature", () => {
		expect(verifyLinearWebhook({ rawBody: BODY, signature: "not-hex!", secret: SECRET })).toBe(false);
	});

	it("accepts when timestamp within window", () => {
		const ts = 1_700_000_000_000;
		const sig = sign(BODY);
		expect(
			verifyLinearWebhook({
				rawBody: BODY,
				signature: sig,
				secret: SECRET,
				timestamp: ts,
				nowMs: ts + 1000,
			}),
		).toBe(true);
	});

	it("rejects when timestamp outside default window", () => {
		const ts = 1_700_000_000_000;
		const sig = sign(BODY);
		expect(
			verifyLinearWebhook({
				rawBody: BODY,
				signature: sig,
				secret: SECRET,
				timestamp: ts,
				nowMs: ts + DEFAULT_WEBHOOK_MAX_AGE_MS + 1,
			}),
		).toBe(false);
	});

	it("rejects future-dated payloads outside the window", () => {
		const ts = 1_700_000_000_000;
		const sig = sign(BODY);
		expect(
			verifyLinearWebhook({
				rawBody: BODY,
				signature: sig,
				secret: SECRET,
				timestamp: ts + DEFAULT_WEBHOOK_MAX_AGE_MS + 1,
				nowMs: ts,
			}),
		).toBe(false);
	});

	it("rejects non-finite timestamp", () => {
		const sig = sign(BODY);
		expect(
			verifyLinearWebhook({ rawBody: BODY, signature: sig, secret: SECRET, timestamp: Number.POSITIVE_INFINITY }),
		).toBe(false);
	});

	it("honours custom maxAgeMs", () => {
		const ts = 1_700_000_000_000;
		const sig = sign(BODY);
		expect(
			verifyLinearWebhook({
				rawBody: BODY,
				signature: sig,
				secret: SECRET,
				timestamp: ts,
				maxAgeMs: 5_000,
				nowMs: ts + 4_999,
			}),
		).toBe(true);
		expect(
			verifyLinearWebhook({
				rawBody: BODY,
				signature: sig,
				secret: SECRET,
				timestamp: ts,
				maxAgeMs: 5_000,
				nowMs: ts + 5_001,
			}),
		).toBe(false);
	});
});
