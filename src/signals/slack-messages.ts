// `slack_messages` signal source.
//
// Polls Slack `conversations.history` for the configured channel IDs and
// filters messages by `match_patterns` (case-insensitive substring match
// against `text`). Issue identifiers in matched messages are extracted via
// the team-prefix regex derived from references/teams.json.
//
// Auth: requires SLACK_TOKEN (Bot or User token) in the environment. Without
// it the source emits one warning signal and returns.

import type { LinearConfig } from "../config/types.js";
import { _internal as commitsInternal } from "./github-commits.js";
import type { Signal, SignalSourceContext, SignalSourceImpl } from "./types.js";

const SLACK_API = "https://slack.com/api";
const DEFAULT_LOOKBACK_HOURS = 24;
const HISTORY_LIMIT = 200;
const TIMEOUT_MS = 30_000;

export interface SlackMessagesConfig {
	type: "slack_messages";
	name: string;
	enabled?: boolean;
	channels?: string[];
	match_patterns?: string[];
	lookback_hours?: number;
}

interface SlackMessage {
	ts: string;
	user?: string;
	text?: string;
	subtype?: string;
}

interface HistoryResponse {
	ok: boolean;
	error?: string;
	messages?: SlackMessage[];
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;
export function setSlackFetchForTesting(impl: FetchLike | null): void {
	fetchImpl = impl ?? fetch;
}

export class SlackMessagesSource implements SignalSourceImpl {
	readonly config: SlackMessagesConfig;
	private readonly linearConfig: LinearConfig;

	constructor(config: SlackMessagesConfig, linearConfig: LinearConfig) {
		this.config = config;
		this.linearConfig = linearConfig;
	}

	async collect(ctx: SignalSourceContext): Promise<Signal[]> {
		const receivedAt = ctx.now.toISOString();
		const token = process.env.SLACK_TOKEN;

		if (!token) {
			return [
				{
					source: this.config.name,
					type: this.config.type,
					payload: { warning: "SLACK_TOKEN not set; skipped" },
					receivedAt,
				},
			];
		}

		const teamKeys = this.linearConfig.teams.teams.map((t) => t.key);
		const issueRegex = commitsInternal.buildTeamRegex(teamKeys);
		const patterns = (this.config.match_patterns ?? []).map((p) => p.toLowerCase());

		const lookback = (this.config.lookback_hours ?? DEFAULT_LOOKBACK_HOURS) * 3600;
		const oldest = (ctx.now.getTime() / 1000 - lookback).toFixed(3);

		const channels =
			this.config.channels && this.config.channels.length > 0
				? this.config.channels
				: this.linearConfig.slack.allowed_channels;

		const signals: Signal[] = [];
		for (const channel of channels) {
			let payload: HistoryResponse;
			try {
				const url = new URL(`${SLACK_API}/conversations.history`);
				url.searchParams.set("channel", channel);
				url.searchParams.set("limit", String(HISTORY_LIMIT));
				url.searchParams.set("oldest", oldest);
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
				let res: Response;
				try {
					res = await fetchImpl(url, {
						headers: { Authorization: `Bearer ${token}` },
						signal: controller.signal,
					});
				} finally {
					clearTimeout(timer);
				}
				payload = (await res.json()) as HistoryResponse;
			} catch (err) {
				signals.push({
					source: this.config.name,
					type: this.config.type,
					payload: { warning: `slack history failed for "${channel}": ${(err as Error).message}` },
					receivedAt,
				});
				continue;
			}

			if (!payload.ok) {
				signals.push({
					source: this.config.name,
					type: this.config.type,
					payload: { warning: `slack returned error for "${channel}": ${payload.error ?? "unknown"}` },
					receivedAt,
				});
				continue;
			}

			for (const msg of payload.messages ?? []) {
				if (!msg.text) continue;
				if (msg.subtype === "bot_message" || msg.subtype === "channel_join") continue;

				const lower = msg.text.toLowerCase();
				if (patterns.length > 0 && !patterns.some((p) => lower.includes(p))) continue;

				const ids = commitsInternal.extractIssueIds(msg.text, issueRegex);
				const base = {
					channel,
					ts: msg.ts,
					user: msg.user ?? null,
					text: msg.text,
				};
				if (ids.length === 0) {
					signals.push({ source: this.config.name, type: this.config.type, payload: base, receivedAt });
					continue;
				}
				for (const id of ids) {
					signals.push({
						source: this.config.name,
						type: this.config.type,
						issueIdentifier: id,
						payload: base,
						receivedAt,
					});
				}
			}
		}
		return signals;
	}
}
