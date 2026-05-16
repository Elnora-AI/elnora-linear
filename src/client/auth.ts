// Linear API key resolution.
//
// Precedence (highest first):
//   1. LINEAR_API_KEY env var
//   2. ~/.config/elnora-linear/.env (or path passed via envFilePath)
//   3. Interactive prompt (only if allowPrompt: true and stdin is a TTY)
//
// All Linear keys must start with "lin_api_" — validated before return.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { Writable } from "node:stream";

export class AuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthError";
	}
}

const KEY_PREFIX = "lin_api_";
const DEFAULT_ENV_FILE = join(homedir(), ".config", "elnora-linear", ".env");

function validateKey(key: string): string {
	const trimmed = key.trim().replace(/^["']|["']$/g, "");
	if (!trimmed.startsWith(KEY_PREFIX)) {
		// Don't echo any prefix of the value — if it doesn't start with
		// "lin_api_" we have no guarantee it isn't a different secret that the
		// user pasted by mistake. Use a fixed sentinel instead.
		throw new AuthError(`Linear API key must start with "${KEY_PREFIX}". Got: <redacted ${trimmed.length}-char value>`);
	}
	return trimmed;
}

function readKeyFromEnvFile(path: string): string | null {
	if (!existsSync(path)) return null;
	const content = readFileSync(path, "utf8");
	for (const line of content.split("\n")) {
		const match = line.match(/^LINEAR_API_KEY\s*=\s*(.+?)\s*$/);
		if (match) return match[1];
	}
	return null;
}

function saveKeyToEnvFile(key: string, path: string = DEFAULT_ENV_FILE): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `LINEAR_API_KEY=${key}\n`, { mode: 0o600 });
	chmodSync(path, 0o600);
}

export interface GetApiKeyOptions {
	/** Override env-file path (default: ~/.config/elnora-linear/.env). */
	envFilePath?: string;
	/** If true and key isn't found, prompt user interactively (requires TTY). */
	allowPrompt?: boolean;
}

export async function getApiKey(opts: GetApiKeyOptions = {}): Promise<string> {
	if (process.env.LINEAR_API_KEY) {
		return validateKey(process.env.LINEAR_API_KEY);
	}
	const envFile = opts.envFilePath ?? DEFAULT_ENV_FILE;
	const fileKey = readKeyFromEnvFile(envFile);
	if (fileKey) return validateKey(fileKey);

	if (!opts.allowPrompt) {
		throw new AuthError(`Linear API key not found. Set LINEAR_API_KEY env var, or place it in ${envFile} (mode 0600).`);
	}
	if (!process.stdin.isTTY) {
		throw new AuthError("Linear API key not found and stdin is not a TTY; cannot prompt. Set LINEAR_API_KEY env var.");
	}
	process.stdout.write("Linear API key not found.\nGet one at https://linear.app/settings/api\nPaste it here: ");
	// Suppress terminal echo so the pasted key doesn't appear in scrollback.
	const muted = new Writable({
		write(_chunk, _enc, cb) {
			cb();
		},
	});
	const rl: Interface = createInterface({ input: process.stdin, output: muted, terminal: true });
	let response: string;
	try {
		response = (await rl.question("")).trim();
	} finally {
		rl.close();
		process.stdout.write("\n");
	}
	const validated = validateKey(response);
	saveKeyToEnvFile(validated, envFile);
	process.stdout.write(`Saved to ${envFile} (mode 0600).\n`);
	return validated;
}

// Exported for testing.
export const _internal = { validateKey, readKeyFromEnvFile, saveKeyToEnvFile, DEFAULT_ENV_FILE };
