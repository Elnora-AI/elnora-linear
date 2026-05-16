// `github_pr` signal source.
//
// Uses the GitHub CLI (`gh pr list`) to enumerate pull requests across the
// configured repos. Issue identifiers are extracted from PR title + body
// using the team-prefix regex derived from references/teams.json.
//
// Required: the `gh` CLI must be installed and authenticated (`gh auth status`).
// Without it, the source emits one warning signal and returns.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { LinearConfig } from "../config/types.js";
import { _internal as commitsInternal } from "./github-commits.js";
import type { Signal, SignalSourceContext, SignalSourceImpl } from "./types.js";

const runCmd = promisify(execFile);
const PR_LIMIT_DEFAULT = 100;
const MAX_BUFFER = 10_000_000;
const TIMEOUT_MS = 30_000;

export interface GithubPrConfig {
	type: "github_pr";
	name: string;
	enabled?: boolean;
	repos?: string[];
	limit?: number;
}

interface PrRow {
	number: number;
	title: string;
	body: string;
	state: string;
	mergedAt: string | null;
	author: { login: string } | null;
	url: string;
}

export class GithubPrSource implements SignalSourceImpl {
	readonly config: GithubPrConfig;
	private readonly linearConfig: LinearConfig;

	constructor(config: GithubPrConfig, linearConfig: LinearConfig) {
		this.config = config;
		this.linearConfig = linearConfig;
	}

	async collect(ctx: SignalSourceContext): Promise<Signal[]> {
		const receivedAt = ctx.now.toISOString();
		const teamKeys = this.linearConfig.teams.teams.map((t) => t.key);
		const issueRegex = commitsInternal.buildTeamRegex(teamKeys);
		const limit = this.config.limit ?? PR_LIMIT_DEFAULT;

		const repoNames = this.config.repos ?? this.linearConfig.repos.repos.map((r) => r.name);
		const reposByName = new Map(this.linearConfig.repos.repos.map((r) => [r.name, r]));

		const signals: Signal[] = [];
		for (const name of repoNames) {
			const repo = reposByName.get(name);
			if (!repo?.org) {
				signals.push({
					source: this.config.name,
					type: this.config.type,
					payload: { warning: `repo "${name}" has no org configured; skipped` },
					receivedAt,
				});
				continue;
			}

			const slug = `${repo.org}/${name}`;
			let prs: PrRow[];
			try {
				const { stdout } = await runCmd(
					"gh",
					[
						"pr",
						"list",
						"--repo",
						slug,
						"--state",
						"all",
						"--limit",
						String(limit),
						"--json",
						"number,title,body,state,mergedAt,author,url",
					],
					{ timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
				);
				prs = JSON.parse(stdout) as PrRow[];
			} catch (err) {
				signals.push({
					source: this.config.name,
					type: this.config.type,
					payload: { warning: `gh pr list failed for "${slug}": ${(err as Error).message}` },
					receivedAt,
				});
				continue;
			}

			for (const pr of prs) {
				const haystack = `${pr.title}\n${pr.body ?? ""}`;
				const ids = commitsInternal.extractIssueIds(haystack, issueRegex);
				const payload = {
					repo: name,
					number: pr.number,
					title: pr.title,
					state: pr.state,
					mergedAt: pr.mergedAt,
					author: pr.author?.login ?? null,
					url: pr.url,
				};
				if (ids.length === 0) {
					signals.push({ source: this.config.name, type: this.config.type, payload, receivedAt });
					continue;
				}
				for (const id of ids) {
					signals.push({
						source: this.config.name,
						type: this.config.type,
						issueIdentifier: id,
						payload,
						receivedAt,
					});
				}
			}
		}
		return signals;
	}
}
