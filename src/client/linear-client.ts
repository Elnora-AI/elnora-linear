// Thin singleton wrapper around @linear/sdk's LinearClient.
//
// Process-wide cache so a single CLI invocation only auths + constructs once,
// no matter how many commands invoke it. Tests can reset via resetLinearClient.

import { LinearClient } from "@linear/sdk";
import { type GetApiKeyOptions, getApiKey } from "./auth.js";

let cached: LinearClient | null = null;

export async function getLinearClient(opts?: GetApiKeyOptions): Promise<LinearClient> {
	if (cached) return cached;
	const apiKey = await getApiKey(opts);
	cached = new LinearClient({ apiKey });
	return cached;
}

export function resetLinearClient(): void {
	cached = null;
}
