// `elnora-linear curator-run` — collect signals from configured signal sources.
//
// This PR ships the COLLECTION + REPORTING half of the curator. A follow-up PR
// will add the rule engine that consumes these signals + the workflows.json
// rules and proposes/applies issue mutations. For now, curator-run is a
// diagnostic — it tells you what each configured signal source is seeing.

import { loadConfig } from "../config/index.js";
import type { OutputMode } from "../output/index.js";
import { buildSignalSource, type Signal } from "../signals/index.js";

export interface CuratorOptions {
	/** Run only the named source (matches signal_sources[].name). */
	source?: string;
	referencesDir?: string;
	output: OutputMode;
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
}

export async function runCurator(opts: CuratorOptions): Promise<CuratorReport> {
	const cfg = loadConfig({ referencesDir: opts.referencesDir, strict: false });
	const configured = cfg.signalSources.sources;
	const enabledSources = configured.filter((s) => s.enabled !== false);
	const targeted = opts.source ? enabledSources.filter((s) => s.name === opts.source) : enabledSources;

	const now = new Date();
	const report: CuratorReport = { sources: [] };
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
		} catch (err) {
			entry.error = err instanceof Error ? err.message : String(err);
		}
		report.sources.push(entry);
	}

	if (opts.output === "json") {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		process.stdout.write(formatCuratorReport(report));
	}
	return report;
}

/** Pure: render a curator report as human-readable text. */
export function formatCuratorReport(report: CuratorReport): string {
	if (report.sources.length === 0) {
		return "No enabled signal sources configured. Add entries to references/signal-sources.json and rerun.\n";
	}
	const lines: string[] = [];
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
	return `${lines.join("\n")}\n`;
}
