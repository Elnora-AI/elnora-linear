// Team-specific label requirements.
//
// Source of truth for which labels each team requires on every issue. Read by
// `projects get`, `teams get`, `context`, and the `issues create` validator.
// Agents never read the underlying JSON directly — they consume policies
// through the CLI responses, which is the point: keep the policy in one place
// and let the CLI expose it instead of having every agent re-encode it.
//
// Loaded via the existing config layer (LinearConfig) so it honors the same
// placeholder + sync + sanitization-gate machinery as the other references.

import { loadConfig } from "../config/index.js";

export interface RequirementGroup {
	prefixes: string[];
	min: number;
	max?: number | null;
	description?: string;
}

export interface TeamLabelPolicy {
	name: string;
	required: RequirementGroup[];
	allowedPrefixes: string[];
	requiresProject?: boolean;
}

export interface LabelPolicyConfig {
	$schema?: string;
	_placeholder?: boolean;
	_example?: boolean;
	_populated_by?: string;
	policies: Record<string, TeamLabelPolicy>;
}

export interface LoadLabelPolicyOptions {
	referencesDir?: string;
	/** Force reload (default false — module-level cache used for repeat calls in the same process). */
	noCache?: boolean;
}

let cached: LabelPolicyConfig | null = null;
let cachedKey: string | undefined;

/** Load the label-policy config from references/label-policy.json. */
export function loadLabelPolicies(opts: LoadLabelPolicyOptions = {}): LabelPolicyConfig {
	const key = opts.referencesDir ?? "(default)";
	if (!opts.noCache && cached && cachedKey === key) return cached;
	const cfg = loadConfig({ referencesDir: opts.referencesDir, strict: false });
	cached = cfg.labelPolicy;
	cachedKey = key;
	return cached;
}

/** Reset the module-level cache (used in tests). */
export function resetLabelPolicyCache(): void {
	cached = null;
	cachedKey = undefined;
}

export function getTeamLabelPolicy(teamKey: string, opts: LoadLabelPolicyOptions = {}): TeamLabelPolicy | null {
	return loadLabelPolicies(opts).policies[teamKey] ?? null;
}

/**
 * Group labels by their first matching prefix. Labels not matching any known
 * prefix go to "_unprefixed". Order of knownPrefixes matters: the first match
 * wins, so put more specific prefixes earlier if any overlap.
 */
export function groupLabelsByPrefix(labelNames: string[], knownPrefixes: string[]): Record<string, string[]> {
	const result: Record<string, string[]> = { _unprefixed: [] };
	for (const prefix of knownPrefixes) result[prefix] = [];
	for (const name of labelNames) {
		const prefix = knownPrefixes.find((p) => name.startsWith(p));
		if (prefix) {
			result[prefix].push(name);
		} else {
			result._unprefixed.push(name);
		}
	}
	return result;
}

export interface LabelValidationFailure {
	group: RequirementGroup;
	count: number;
	reason: "missing" | "excess";
}

export interface LabelValidationResult {
	valid: boolean;
	failures: LabelValidationFailure[];
	passed: string[];
	availableForPrefix: Record<string, string[]>;
}

/**
 * Validate that the proposed labels satisfy the team's required prefix groups.
 * Unknown teams pass through (no enforcement) so workspaces without a config
 * entry don't break.
 */
export function validateLabelsAgainstTeam(
	teamKey: string,
	passedLabels: string[],
	teamLabelCatalog: string[],
	opts: LoadLabelPolicyOptions = {},
): LabelValidationResult {
	const policy = getTeamLabelPolicy(teamKey, opts);
	if (!policy) {
		return { valid: true, failures: [], passed: passedLabels, availableForPrefix: {} };
	}

	const passedByPrefix = groupLabelsByPrefix(passedLabels, policy.allowedPrefixes);
	const catalogByPrefix = groupLabelsByPrefix(teamLabelCatalog, policy.allowedPrefixes);

	const failures: LabelValidationFailure[] = [];
	const failedPrefixes = new Set<string>();

	for (const group of policy.required) {
		let count = 0;
		for (const prefix of group.prefixes) {
			count += (passedByPrefix[prefix] ?? []).length;
		}
		if (count < group.min) {
			failures.push({ group, count, reason: "missing" });
			for (const p of group.prefixes) failedPrefixes.add(p);
		} else if (group.max != null && count > group.max) {
			failures.push({ group, count, reason: "excess" });
			for (const p of group.prefixes) failedPrefixes.add(p);
		}
	}

	const availableForPrefix: Record<string, string[]> = {};
	for (const prefix of failedPrefixes) {
		availableForPrefix[prefix] = catalogByPrefix[prefix] ?? [];
	}

	return {
		valid: failures.length === 0,
		failures,
		passed: passedLabels,
		availableForPrefix,
	};
}
