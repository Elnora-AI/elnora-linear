// `github_commits` signal source.
//
// Shells out to `git log` on each configured repo and parses commits within
// the lookback window. Issue identifiers (e.g. ENG-101) are extracted from
// commit messages via the team-prefix regex derived from references/teams.json.
//
// The repo entries reference `references/repos.json` for the `local_path`. If
// a repo has no local_path, the source emits one warning signal per missing
// path and continues.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import type { LinearConfig } from "../config/types.js";
import type { Signal, SignalSourceContext, SignalSourceImpl } from "./types.js";

const runCmd = promisify(execFile);
const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_BUFFER = 10_000_000;
const TIMEOUT_MS = 30_000;

export interface GithubCommitsConfig {
	type: "github_commits";
	name: string;
	enabled?: boolean;
	repos?: string[];
	lookback_days?: number;
}

interface CommitRow {
	sha: string;
	author_email: string;
	message: string;
	subject: string;
}

function buildTeamRegex(teamKeys: string[]): RegExp {
	if (teamKeys.length === 0) return /\b([A-Z]{2,5})-(\d+)\b/g;
	const escaped = teamKeys.map((k) => k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
	return new RegExp(`\\b(${escaped})-(\\d+)\\b`, "g");
}

export function extractIssueIds(message: string, re: RegExp): string[] {
	const out = new Set<string>();
	re.lastIndex = 0;
	let m: RegExpExecArray | null = re.exec(message);
	while (m !== null) {
		out.add(`${m[1]}-${m[2]}`);
		m = re.exec(message);
	}
	return [...out];
}

function parseGitLog(stdout: string): CommitRow[] {
	if (!stdout.trim()) return [];
	const rows: CommitRow[] = [];
	for (const block of stdout.split("\x1e")) {
		const trimmed = block.trim();
		if (!trimmed) continue;
		const [sha, email, subject, body = ""] = trimmed.split("\x1f");
		rows.push({
			sha,
			author_email: email,
			subject,
			message: body ? `${subject}\n${body}` : subject,
		});
	}
	return rows;
}

export class GithubCommitsSource implements SignalSourceImpl {
	readonly config: GithubCommitsConfig;
	private readonly linearConfig: LinearConfig;

	constructor(config: GithubCommitsConfig, linearConfig: LinearConfig) {
		this.config = config;
		this.linearConfig = linearConfig;
	}

	async collect(ctx: SignalSourceContext): Promise<Signal[]> {
		const receivedAt = ctx.now.toISOString();
		const lookback = this.config.lookback_days ?? DEFAULT_LOOKBACK_DAYS;
		const teamKeys = this.linearConfig.teams.teams.map((t) => t.key);
		const issueRegex = buildTeamRegex(teamKeys);

		const repoNames = this.config.repos ?? this.linearConfig.repos.repos.map((r) => r.name);
		const reposByName = new Map(this.linearConfig.repos.repos.map((r) => [r.name, r]));

		const signals: Signal[] = [];
		for (const name of repoNames) {
			const repo = reposByName.get(name);
			if (!repo?.local_path || !existsSync(repo.local_path)) {
				signals.push({
					source: this.config.name,
					type: this.config.type,
					payload: { warning: `repo "${name}" has no local_path (or path does not exist); skipped` },
					receivedAt,
				});
				continue;
			}

			let rows: CommitRow[];
			try {
				const { stdout } = await runCmd(
					"git",
					["-C", repo.local_path, "log", `--since=${lookback} days ago`, "--format=%H%x1f%ae%x1f%s%x1f%b%x1e"],
					{ timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
				);
				rows = parseGitLog(stdout);
			} catch (err) {
				signals.push({
					source: this.config.name,
					type: this.config.type,
					payload: { warning: `git log failed for "${name}": ${(err as Error).message}` },
					receivedAt,
				});
				continue;
			}

			for (const row of rows) {
				const ids = extractIssueIds(row.message, issueRegex);
				if (ids.length === 0) {
					signals.push({
						source: this.config.name,
						type: this.config.type,
						payload: {
							repo: name,
							sha: row.sha,
							author_email: row.author_email,
							subject: row.subject,
						},
						receivedAt,
					});
					continue;
				}
				for (const id of ids) {
					signals.push({
						source: this.config.name,
						type: this.config.type,
						issueIdentifier: id,
						payload: {
							repo: name,
							sha: row.sha,
							author_email: row.author_email,
							subject: row.subject,
						},
						receivedAt,
					});
				}
			}
		}
		return signals;
	}
}

export const _internal = { buildTeamRegex, extractIssueIds, parseGitLog };
