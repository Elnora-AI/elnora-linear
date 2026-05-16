// Error hierarchy for elnora-linear CLI.
//
// Every error class carries a userMessage + suggestion + structured exit code
// so the CLI dispatcher can map them to predictable shell exit codes and emit
// machine-readable JSON envelopes that agents can parse + self-correct from.

/**
 * Dedicated exit codes per error type.
 * 0 = success, 1 = general/unknown, 2 = validation, 3 = auth, 4 = not found.
 */
export const EXIT_CODES = {
	SUCCESS: 0,
	GENERAL: 1,
	VALIDATION: 2,
	AUTH: 3,
	NOT_FOUND: 4,
} as const;

export class CliError extends Error {
	readonly userMessage: string;
	readonly suggestion?: string;
	readonly exitCode: number;
	/**
	 * Optional structured payload merged into the JSON error envelope. Used by
	 * validation errors that need to expose machine-readable detail (e.g. which
	 * labels are missing, what the team's accepted set is) so an agent can
	 * self-correct without re-reading reference files.
	 */
	readonly data?: Record<string, unknown>;

	constructor(message: string, options?: { suggestion?: string; exitCode?: number; data?: Record<string, unknown> }) {
		super(message);
		this.name = "CliError";
		this.userMessage = message;
		this.suggestion = options?.suggestion;
		this.exitCode = options?.exitCode ?? EXIT_CODES.GENERAL;
		this.data = options?.data;
	}
}

export class AuthError extends CliError {
	constructor(message?: string) {
		super(message ?? "No Linear API key found. Set LINEAR_API_KEY in your environment.", {
			suggestion:
				"Add LINEAR_API_KEY=lin_api_... to your environment, or place it in ~/.config/elnora-linear/.env (mode 0600).",
			exitCode: EXIT_CODES.AUTH,
		});
		this.name = "AuthError";
	}
}

/** Maps entity names to the correct CLI command for listing them. */
const ENTITY_LIST_COMMANDS: Record<string, string> = {
	team: "elnora-linear teams list",
	project: "elnora-linear projects list",
	user: "elnora-linear users list",
	label: "elnora-linear labels list",
	state: "elnora-linear states list --team <team>",
	issue: "elnora-linear issues list",
	initiative: "elnora-linear initiatives list",
	milestone: "elnora-linear milestones list --project <project>",
	"workflow state": "elnora-linear states list --team <team>",
};

export class NotFoundError extends CliError {
	constructor(entity: string, identifier: string) {
		const command = ENTITY_LIST_COMMANDS[entity.toLowerCase()] ?? `elnora-linear ${entity.toLowerCase()}s list`;
		super(`${entity} not found: ${identifier}`, {
			suggestion: `Check the identifier and try again. Use '${command}' to see available ${entity.toLowerCase()}s.`,
			exitCode: EXIT_CODES.NOT_FOUND,
		});
		this.name = "NotFoundError";
	}
}

export class ValidationError extends CliError {
	constructor(message: string, suggestion?: string, data?: Record<string, unknown>) {
		super(message, { suggestion, exitCode: EXIT_CODES.VALIDATION, data });
		this.name = "ValidationError";
	}
}

/**
 * Specialized validation error for label-policy violations on `issues create`.
 * The structured `data` field is the load-bearing part — agents read it to
 * self-correct in one retry instead of re-reading workspace-labels.md.
 */
export class LabelValidationError extends ValidationError {
	constructor(data: {
		error: "labels_invalid";
		team: string;
		teamKey: string;
		missing: { prefixes: string[]; min: number; description?: string }[];
		excess: { prefixes: string[]; max: number; passed: string[] }[];
		passed: string[];
		availableForPrefix: Record<string, string[]>;
		suggestedRetry: string;
	}) {
		const summary: string[] = [];
		for (const m of data.missing) {
			summary.push(`missing ≥${m.min} from ${m.prefixes.join(" or ")}`);
		}
		for (const e of data.excess) {
			summary.push(`too many ${e.prefixes.join(" or ")} (max ${e.max})`);
		}
		const message = `Label policy violation for team "${data.team}": ${summary.join("; ")}.`;
		const suggestion =
			"Pass labels matching the prefixes shown in availableForPrefix, or run the suggestedRetry command verbatim.";
		super(message, suggestion, { ...data });
		this.name = "LabelValidationError";
	}
}

/**
 * Specialized validation error for project-policy violations on `issues create`.
 * Fires when a team requires a project (default) and `--project` was not passed,
 * provided the team has at least one project to choose from. Structured `data`
 * lets the agent self-correct in one retry.
 */
export class ProjectValidationError extends ValidationError {
	constructor(data: {
		error: "project_required";
		team: string;
		teamKey: string;
		availableProjects: { name: string; status: string | null }[];
		suggestedRetry: string;
	}) {
		const message =
			data.availableProjects.length === 1
				? `Team "${data.team}" requires every issue to have a project. Available: "${data.availableProjects[0].name}".`
				: `Team "${data.team}" requires every issue to have a project. ${data.availableProjects.length} projects available.`;
		const suggestion =
			"Pass --project <name> from availableProjects, or re-run the suggestedRetry command. To bypass (e.g. a placeholder issue), pass --skip-project-check.";
		super(message, suggestion, { ...data });
		this.name = "ProjectValidationError";
	}
}
