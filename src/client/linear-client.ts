// Thin singleton wrapper around @linear/sdk's LinearClient.
//
// Process-wide cache so a single CLI invocation only auths + constructs once,
// no matter how many commands invoke it. Tests can reset via resetLinearClient.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LinearClient } from "@linear/sdk";
import { PACKAGE_ROOT } from "../package-root.js";
import { type GetApiKeyOptions, getApiKey } from "./auth.js";

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };
const USER_AGENT = `@elnora-ai/linear/${pkg.version}`;

let cached: LinearClient | null = null;

export async function getLinearClient(opts?: GetApiKeyOptions): Promise<LinearClient> {
	if (cached) return cached;
	const apiKey = await getApiKey(opts);
	cached = new LinearClient({ apiKey, headers: { "User-Agent": USER_AGENT } });
	return cached;
}

/**
 * Alias for getLinearClient with allowPrompt=true.
 *
 * Provided so ports from the private CLI (which used a synchronous `getClient()`)
 * can keep the same call site shape (`const client = await getClient()`).
 */
export async function getClient(opts?: GetApiKeyOptions): Promise<LinearClient> {
	return getLinearClient({ allowPrompt: true, ...opts });
}

export function resetLinearClient(): void {
	cached = null;
}
