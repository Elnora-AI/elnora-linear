// `elnora-linear agent-activities` — streaming output an agent emits during
// a session.
//
// Linear's agent framework expects a `thought` activity within 10 seconds of
// receiving an `agentSessionEvent.created` webhook, then any number of
// follow-ups (action / response / elicitation / error) up to ~30 minutes
// before the session goes stale.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { type AgentActivity, AgentActivitySignal, type LinearClient } from "@linear/sdk";
import type { Command } from "commander";
import { getClient } from "../client/index.js";
import { handleAsyncCommand, outputSuccess } from "../output/index.js";
import { CliError, parseLimit, ValidationError } from "../utils/index.js";

type AgentActivityCreateInput = Parameters<LinearClient["createAgentActivity"]>[0];

const VALID_TYPES = ["thought", "action", "elicitation", "response", "error"] as const;
type ActivityType = (typeof VALID_TYPES)[number];

function buildContent(
	type: ActivityType,
	body: string,
	action?: string,
	parameter?: string,
	resultJson?: string,
): Record<string, unknown> {
	switch (type) {
		case "thought":
		case "elicitation":
		case "response":
		case "error":
			if (!body) {
				throw new ValidationError(`--body is required for type "${type}".`);
			}
			return { type, body };
		case "action": {
			if (!action) {
				throw new ValidationError('--action is required for type "action".');
			}
			const content: Record<string, unknown> = { type: "action", action };
			if (parameter !== undefined) content.parameter = parameter;
			if (resultJson !== undefined) {
				try {
					content.result = JSON.parse(resultJson);
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					throw new ValidationError(`Invalid --result JSON: ${msg}`);
				}
			}
			return content;
		}
	}
}

function readSignalMetadata(file: string): Record<string, unknown> {
	const raw = readFileSync(resolvePath(file), "utf-8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(`Invalid --signal-metadata JSON: ${msg}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new ValidationError("--signal-metadata must be a JSON object.");
	}
	return parsed as Record<string, unknown>;
}

async function formatActivity(a: AgentActivity): Promise<Record<string, unknown>> {
	const session = await a.agentSession;
	return {
		id: a.id,
		sessionId: session?.id ?? null,
		signal: a.signal ?? null,
		ephemeral: a.ephemeral ?? null,
		content: a.content,
		createdAt: a.createdAt,
	};
}

export function setupAgentActivitiesCommand(program: Command): void {
	const activities = program
		.command("agent-activities")
		.description("Manage Linear agent activities (thought / action / elicitation / response / error)");

	activities
		.command("list <sessionId>")
		.description("List activities on an agent session")
		.option("--limit <n>", "Max results", "100")
		.action(
			handleAsyncCommand(async (sessionId: string, opts: Record<string, string>) => {
				const client = await getClient();
				const session = await client.agentSession(sessionId);
				const conn = await session.activities({ first: parseLimit(opts.limit, 100) });
				const items = await Promise.all(conn.nodes.map(formatActivity));
				outputSuccess({ activities: items, count: items.length });
			}),
		);

	activities
		.command("get <id>")
		.description("Get a single agent activity")
		.action(
			handleAsyncCommand(async (id: string) => {
				const client = await getClient();
				const a = await client.agentActivity(id);
				outputSuccess(await formatActivity(a));
			}),
		);

	activities
		.command("create <sessionId>")
		.description("Emit an activity into an agent session")
		.requiredOption("--type <type>", `One of: ${VALID_TYPES.join(", ")}`)
		.option("--body <text>", "Body text (required for thought/elicitation/response/error)")
		.option("--action <name>", "Action name (required for type=action)")
		.option("--parameter <text>", "Action parameter (free-form)")
		.option("--result <json>", "Action result (JSON string)")
		.option("--signal <signal>", "elicitation only: select | auth | continue | stop")
		.option("--signal-metadata <jsonFile>", "Path to JSON metadata file for signal")
		.option("--ephemeral", "Activity disappears after the next one")
		.action(
			handleAsyncCommand(async (sessionId: string, opts: Record<string, string | boolean>) => {
				const type = String(opts.type);
				if (!(VALID_TYPES as readonly string[]).includes(type)) {
					throw new ValidationError(`Invalid --type "${type}". Must be one of: ${VALID_TYPES.join(", ")}.`);
				}
				if (opts.signal && type !== "elicitation") {
					throw new ValidationError("--signal is only valid with --type elicitation.");
				}
				const content = buildContent(
					type as ActivityType,
					typeof opts.body === "string" ? opts.body : "",
					typeof opts.action === "string" ? opts.action : undefined,
					typeof opts.parameter === "string" ? opts.parameter : undefined,
					typeof opts.result === "string" ? opts.result : undefined,
				);
				const input: AgentActivityCreateInput = { agentSessionId: sessionId, content };
				if (opts.ephemeral) input.ephemeral = true;
				if (opts.signal) {
					const sig = String(opts.signal).toLowerCase();
					if (sig === "select") input.signal = AgentActivitySignal.Select;
					else if (sig === "auth") input.signal = AgentActivitySignal.Auth;
					else if (sig === "continue") input.signal = AgentActivitySignal.Continue;
					else if (sig === "stop") input.signal = AgentActivitySignal.Stop;
					else throw new ValidationError(`Invalid --signal "${opts.signal}". Use select, auth, continue, or stop.`);
				}
				if (typeof opts.signalMetadata === "string") {
					input.signalMetadata = readSignalMetadata(opts.signalMetadata);
				}
				const client = await getClient();
				const payload = await client.createAgentActivity(input);
				if (!payload.success) throw new CliError("Failed to create agent activity");
				const activity = await payload.agentActivity;
				outputSuccess({
					created: true,
					activity: activity ? await formatActivity(activity) : null,
				});
			}),
		);
}
