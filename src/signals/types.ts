// Signal-source layer shared types.
//
// A SignalSource is a runtime implementation that fetches "signals" (things
// happening outside Linear) which the curator can correlate with Linear
// issue state. Each source is configured by a JSON entry in
// references/signal-sources.json; the registry (registry.ts) turns that
// config into a concrete SignalSource instance.

export interface Signal {
	/** Name of the signal source (from config), e.g. "ci-failing-tests". */
	source: string;
	/** Signal source type, e.g. "external_command". */
	type: string;
	/** If known, the Linear issue this signal is about (e.g. "ENG-101"). */
	issueIdentifier?: string;
	/** Free-form payload — whatever the source produced for this signal. */
	payload: Record<string, unknown>;
	/** ISO timestamp at which the signal was collected. */
	receivedAt: string;
}

export interface SignalSourceContext {
	/** Reference "now" for any time-relative logic. Tests inject a fixed value. */
	now: Date;
}

export interface SignalSourceImpl {
	readonly config: { type: string; name: string; enabled?: boolean };
	collect(ctx: SignalSourceContext): Promise<Signal[]>;
}
