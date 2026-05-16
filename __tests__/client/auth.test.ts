import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _internal, AuthError, getApiKey } from "../../src/client/auth.js";

let tmp: string;
let envFile: string;
let originalKey: string | undefined;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "elnora-linear-auth-"));
	envFile = join(tmp, ".env");
	originalKey = process.env.LINEAR_API_KEY;
	delete process.env.LINEAR_API_KEY;
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	if (originalKey === undefined) delete process.env.LINEAR_API_KEY;
	else process.env.LINEAR_API_KEY = originalKey;
});

describe("getApiKey", () => {
	it("returns LINEAR_API_KEY env var", async () => {
		process.env.LINEAR_API_KEY = "lin_api_envtestkey123";
		expect(await getApiKey({ envFilePath: envFile })).toBe("lin_api_envtestkey123");
	});

	it("trims whitespace and strips quotes from env var", async () => {
		process.env.LINEAR_API_KEY = ' "lin_api_quotedkey"  ';
		expect(await getApiKey({ envFilePath: envFile })).toBe("lin_api_quotedkey");
	});

	it("throws AuthError when env var has wrong prefix", async () => {
		process.env.LINEAR_API_KEY = "not_a_real_key";
		await expect(getApiKey({ envFilePath: envFile })).rejects.toThrow(AuthError);
	});

	it("reads from env file when env var missing", async () => {
		writeFileSync(envFile, "LINEAR_API_KEY=lin_api_fromfile123\n");
		expect(await getApiKey({ envFilePath: envFile })).toBe("lin_api_fromfile123");
	});

	it("env var takes precedence over file", async () => {
		writeFileSync(envFile, "LINEAR_API_KEY=lin_api_fromfile\n");
		process.env.LINEAR_API_KEY = "lin_api_fromenv";
		expect(await getApiKey({ envFilePath: envFile })).toBe("lin_api_fromenv");
	});

	it("throws when neither env nor file has a key and prompting is off", async () => {
		await expect(getApiKey({ envFilePath: envFile })).rejects.toThrow(/not found/);
	});
});

describe("_internal helpers", () => {
	it("validateKey rejects bad prefix", () => {
		expect(() => _internal.validateKey("bad_key")).toThrow(AuthError);
	});

	it("validateKey error never echoes the bad value", () => {
		const secretLikeValue = "lin_api_THIS_IS_A_SECRET_TOKEN_DO_NOT_LEAK";
		// Replace the prefix with something else so it fails validation, but keep
		// the secret tail intact; the thrown message must not contain it.
		const corrupted = `not_lin_${secretLikeValue.slice(8)}`;
		try {
			_internal.validateKey(corrupted);
			throw new Error("validateKey should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(AuthError);
			expect((err as Error).message).not.toContain("THIS_IS_A_SECRET_TOKEN");
		}
	});

	it("validateKey trims whitespace and quotes", () => {
		expect(_internal.validateKey('  "lin_api_clean"  ')).toBe("lin_api_clean");
	});

	it("saveKeyToEnvFile writes mode 0600", () => {
		_internal.saveKeyToEnvFile("lin_api_test", envFile);
		expect(readFileSync(envFile, "utf8")).toContain("LINEAR_API_KEY=lin_api_test");
		const mode = statSync(envFile).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it("readKeyFromEnvFile returns null when file missing", () => {
		expect(_internal.readKeyFromEnvFile(join(tmp, "nope.env"))).toBeNull();
	});

	it("readKeyFromEnvFile parses LINEAR_API_KEY line, ignoring others", () => {
		writeFileSync(envFile, "# comment\nOTHER=foo\nLINEAR_API_KEY=lin_api_xyz\n");
		expect(_internal.readKeyFromEnvFile(envFile)).toBe("lin_api_xyz");
	});
});
