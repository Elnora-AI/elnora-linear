import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _internal, AuthError, getApiKey, loadEnvFile } from "../../src/client/auth.js";

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

	it("parseEnvFile returns every KEY=value pair, stripping quotes and comments", () => {
		writeFileSync(
			envFile,
			[
				"# header comment",
				"",
				"LINEAR_API_KEY=lin_api_xyz",
				'ANTHROPIC_API_KEY="sk-ant-quoted"',
				"SLACK_TOKEN='xoxb-quoted'",
				"INVALID LINE NO EQUALS",
			].join("\n"),
		);
		const parsed = _internal.parseEnvFile(envFile);
		expect(parsed).toEqual({
			LINEAR_API_KEY: "lin_api_xyz",
			ANTHROPIC_API_KEY: "sk-ant-quoted",
			SLACK_TOKEN: "xoxb-quoted",
		});
	});

	it("parseEnvFile returns empty object when file missing", () => {
		expect(_internal.parseEnvFile(join(tmp, "nope.env"))).toEqual({});
	});
});

describe("loadEnvFile", () => {
	const trackedKeys = ["ANTHROPIC_API_KEY", "SLACK_TOKEN", "ELNORA_LINEAR_TEST_VAR"];
	const originals: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const k of trackedKeys) {
			originals[k] = process.env[k];
			delete process.env[k];
		}
	});

	afterEach(() => {
		for (const k of trackedKeys) {
			if (originals[k] === undefined) delete process.env[k];
			else process.env[k] = originals[k];
		}
	});

	it("populates missing process.env entries from the env file", () => {
		writeFileSync(envFile, "ANTHROPIC_API_KEY=sk-ant-from-file\nSLACK_TOKEN=xoxb-from-file\n");
		loadEnvFile(envFile);
		expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-from-file");
		expect(process.env.SLACK_TOKEN).toBe("xoxb-from-file");
	});

	it("never overwrites a value that is already set in process.env", () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-from-shell";
		writeFileSync(envFile, "ANTHROPIC_API_KEY=sk-ant-from-file\n");
		loadEnvFile(envFile);
		expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-from-shell");
	});

	it("is a no-op when the env file does not exist", () => {
		loadEnvFile(join(tmp, "absent.env"));
		expect(process.env.ELNORA_LINEAR_TEST_VAR).toBeUndefined();
	});
});
