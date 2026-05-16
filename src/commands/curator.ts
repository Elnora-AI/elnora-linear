// `elnora-linear curator-run` — collect signals, build a snapshot, call the
// LLM rule engine, dispatch HIGH/MEDIUM/LOW actions per tier.
//
// Without ANTHROPIC_API_KEY (or with --collect-only), the curator stays in
// diagnostic mode and just reports collected signals. With the key set the
// full pipeline runs:
//   1. Collect signals from every enabled source.
//   2. List open issues for curator-active teams via bulk-graphql.
//   3. Build a markdown snapshot.
//   4. Call Anthropic with the curator system prompt.
//   5. Dispatch the actions (HIGH auto-apply, MEDIUM queue, LOW report).
//   6. Persist state + append jsonl report.

import { getClient } from "../client/index.js";
import { loadConfig } from "../config/index.js";
import {
	type CuratorResponse,
	callCuratorLlm,
	type DispatchResult,
	dispatchActions,
	loadState,
	saveState,
} from "../curator/index.js";
import { buildSnapshot } from "../curator/snapshot.js";
import { bulkListIssues } from "../lib/bulk-graphql.js";
import type { OutputMode } from "../output/index.js";
import { buildSignalSource, type Signal } from "../signals/index.js";

export interface CuratorOptions {
	/** Run only the named source (matches signal_sources[].name). */
	source?: string;
	referencesDir?: string;
	output: OutputMode;
	/** Skip the LLM phase even if ANTHROPIC_API_KEY is set. */
	collectOnly?: boolean;
	/** Stage HIGH actions in the report but do not call the Linear API. */
	dryRun?: boolean;
	/** Override state directory (defaults to ~/.config/elnora-linear/state/). */
	stateDir?: string;
}

export interface CuratorSourceReport {
	name: string;
	type: string;
	enabled: boolean;
	signalCount: number;
	signals: Signal[];
	error?: string;
}

export interface CuratorReport {
	sources: CuratorSourceReport[];
	pipeline?: {
		ranLlm: boolean;
		skippedReason?: string;
		llm?: CuratorResponse;
		dispatch?: DispatchResult;
		error?: string;
	};
}

export async function runCurator(opts: CuratorOptions): Promise<CuratorReport> {
	const cfg = loadConfig({ referencesDir: opts.referencesDir, strict: false });
	const configured = cfg.signalSources.sources;
	const enabledSources = configured.filter((s) => s.enabled !== false);
	const targeted = opts.source ? enabledSources.filter((s) => s.name === opts.source) : enabledSources;

	const now = new Date();
	const report: CuratorReport = { sources: [] };
	const allSignals: Signal[] = [];

	for (const sourceConfig of targeted) {
		const entry: CuratorSourceReport = {
			name: sourceConfig.name,
			type: sourceConfig.type,
			enabled: sourceConfig.enabled !== false,
			signalCount: 0,
			signals: [],
		};
		try {
			const source = buildSignalSource(sourceConfig, cfg);
			const signals = await source.collect({ now });
			entry.signalCount = signals.length;
			entry.signals = signals;
			allSignals.push(...signals);
		} catch (err) {
			entry.error = err instanceof Error ? err.message : String(err);
		}
		report.sources.push(entry);
	}

	const llmGate = shouldRunLlm(opts);
	if (!llmGate.run) {
		report.pipeline = { ranLlm: false, skippedReason: llmGate.reason };
	} else {
		report.pipeline = await runRuleEnginePhase(allSignals, opts);
	}

	if (opts.output === "json") {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		process.stdout.write(formatCuratorReport(report));
	}
	return report;
}

function shouldRunLlm(opts: CuratorOptions): { run: true } | { run: false; reason: string } {
	if (opts.collectOnly) return { run: false, reason: "--collect-only passed" };
	if (!process.env.ANTHROPIC_API_KEY) {
		return { run: false, reason: "ANTHROPIC_API_KEY not set" };
	}
	return { run: true };
}

async function runRuleEnginePhase(
	signals: Signal[],
	opts: CuratorOptions,
): Promise<NonNullable<CuratorReport["pipeline"]>> {
	try {
		const client = await getClient();
		// Pull a workspace-wide bulk list — for production deployments this should
		// be team-filtered via the curator config. v1 keeps it simple.
		const issues = await bulkListIssues(
			{ state: { type: { in: ["unstarted", "started", "backlog"] } } },
			{ max: 500, includeDescription: true },
		);
		const state = loadState({ stateDir: opts.stateDir });
		const snapshot = buildSnapshot({
			issues,
			signals,
			pendingQuestions: state.pending_questions,
			referencesDir: opts.referencesDir,
		});
		const llm = await callCuratorLlm(snapshot);
		const dispatch = await dispatchActions(client, llm.actions, state, {
			dryRun: opts.dryRun,
			stateDir: opts.stateDir,
		});
		state.last_run_ended_at = new Date().toISOString();
		state.stats.push({
			ranAt: state.last_run_ended_at,
			durationMs: 0,
			signalsCollected: signals.length,
			highApplied: dispatch.applied.length,
			mediumQueued: dispatch.queued.length,
			lowReported: dispatch.reported.length,
			errors: [],
		});
		saveState(state, { stateDir: opts.stateDir });
		return { ranLlm: true, llm, dispatch };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ranLlm: false, skippedReason: "error", error: msg };
	}
}

/** Pure: render a curator report as human-readable text. */
export function formatCuratorReport(report: CuratorReport): string {
	const lines: string[] = [];
	if (report.sources.length === 0) {
		lines.push("No enabled signal sources configured. Add entries to references/signal-sources.json and rerun.");
	} else {
		for (const s of report.sources) {
			if (s.error) {
				lines.push(`[!!] ${s.name} (${s.type}) — error: ${s.error}`);
				continue;
			}
			lines.push(`[ok] ${s.name} (${s.type}): ${s.signalCount} signal(s)`);
			for (const sig of s.signals.slice(0, 10)) {
				const id = sig.issueIdentifier ?? "-";
				const preview = JSON.stringify(sig.payload).slice(0, 80);
				lines.push(`     ${id.padEnd(10)} ${preview}`);
			}
			if (s.signals.length > 10) {
				lines.push(`     … ${s.signals.length - 10} more`);
			}
		}
	}
	if (report.pipeline) {
		lines.push("");
		if (report.pipeline.ranLlm && report.pipeline.dispatch) {
			const d = report.pipeline.dispatch;
			lines.push(
				`[curator] HIGH: ${d.applied.length} applied | MEDIUM: ${d.queued.length} queued | LOW: ${d.reported.length} reported | SKIPPED: ${d.skipped.length}`,
			);
		} else if (report.pipeline.error) {
			lines.push(`[curator] rule engine error: ${report.pipeline.error}`);
		} else if (report.pipeline.skippedReason) {
			lines.push(`[curator] rule engine skipped: ${report.pipeline.skippedReason}`);
		}
	}
	return `${lines.join("\n")}\n`;
}
