// `linear_issues` signal source.
//
// Cross-issue scanning against Linear itself. Surfaces title near-duplicates,
// issues that mention other issue IDs in description, and orphan candidates
// (no project, no assignee, no parent). Used by curator M5 (title near-dup)
// and H3 (duplicate-of-Done) class rules.
//
// Uses the bulk-graphql helper to keep round-trips low — one paginated query
// returns identifier + title + description + state.type + project + assignee
// + parent in a single GraphQL call.

import { bulkListIssues } from "../lib/bulk-graphql.js";
import { _internal as commitsInternal } from "./github-commits.js";
import type { Signal, SignalSourceContext, SignalSourceImpl } from "./types.js";

const DEFAULT_LOOKBACK_DAYS = 30;

export interface LinearIssuesConfig {
	type: "linear_issues";
	name: string;
	enabled?: boolean;
	teams?: string[];
	lookback_days?: number;
	near_duplicate_threshold?: number;
}

function normaliseTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/**
 * Jaccard similarity over whitespace-tokenised word sets.
 * Cheap, language-agnostic, good enough for "did someone just file the same thing".
 */
export function titleSimilarity(a: string, b: string): number {
	const ta = new Set(normaliseTitle(a).split(/\s+/).filter(Boolean));
	const tb = new Set(normaliseTitle(b).split(/\s+/).filter(Boolean));
	if (ta.size === 0 || tb.size === 0) return 0;
	let inter = 0;
	for (const t of ta) if (tb.has(t)) inter++;
	const union = ta.size + tb.size - inter;
	return union === 0 ? 0 : inter / union;
}

export class LinearIssuesSource implements SignalSourceImpl {
	readonly config: LinearIssuesConfig;

	constructor(config: LinearIssuesConfig) {
		this.config = config;
	}

	async collect(ctx: SignalSourceContext): Promise<Signal[]> {
		const receivedAt = ctx.now.toISOString();
		const lookbackDays = this.config.lookback_days ?? DEFAULT_LOOKBACK_DAYS;
		const threshold = this.config.near_duplicate_threshold ?? 0.7;

		const cutoff = new Date(ctx.now.getTime() - lookbackDays * 24 * 3600 * 1000).toISOString();
		const filter: Record<string, unknown> = { updatedAt: { gt: cutoff } };
		if (this.config.teams && this.config.teams.length > 0) {
			filter.team = { key: { in: this.config.teams } };
		}

		const nodes = await bulkListIssues(filter, { includeDescription: true, includeRelations: true });
		const signals: Signal[] = [];

		const teamKeys = [...new Set(nodes.map((n) => n.team?.key).filter((k): k is string => Boolean(k)))];
		const issueRegex = commitsInternal.buildTeamRegex(teamKeys);

		const knownIds = new Set(nodes.map((n) => n.identifier));
		for (const node of nodes) {
			if (!node.description) continue;
			const refs = commitsInternal.extractIssueIds(node.description, issueRegex);
			for (const ref of refs) {
				if (ref === node.identifier) continue;
				if (!knownIds.has(ref)) continue;
				signals.push({
					source: this.config.name,
					type: this.config.type,
					issueIdentifier: node.identifier,
					payload: { kind: "cross_reference", references: ref },
					receivedAt,
				});
			}
		}

		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				if (a.team?.key !== b.team?.key) continue;
				const sim = titleSimilarity(a.title, b.title);
				if (sim < threshold) continue;
				signals.push({
					source: this.config.name,
					type: this.config.type,
					issueIdentifier: a.identifier,
					payload: {
						kind: "near_duplicate",
						with: b.identifier,
						similarity: Math.round(sim * 100) / 100,
					},
					receivedAt,
				});
			}
		}

		for (const node of nodes) {
			if (node.state?.type !== "unstarted" && node.state?.type !== "backlog") continue;
			if (node.project || node.assignee || node.parent) continue;
			signals.push({
				source: this.config.name,
				type: this.config.type,
				issueIdentifier: node.identifier,
				payload: {
					kind: "orphan",
					title: node.title,
					state: node.state?.name ?? null,
				},
				receivedAt,
			});
		}

		return signals;
	}
}
