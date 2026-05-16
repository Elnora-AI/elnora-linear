// Output formatters for issue lists.
// Text mode = aligned columns for humans. JSON mode = pretty-printed JSON for scripts / agents.

/**
 * Redact API keys and secrets from a string. Defensive — used in error
 * envelopes that may echo back fragments of request bodies or upstream HTTP
 * responses. Covers Linear (api/oauth/webhook) and Anthropic API keys.
 */
export function redactSecrets(text: string): string {
	return text
		.replace(/lin_(api|oauth|wh)_[a-zA-Z0-9_-]+/g, "lin_$1_[REDACTED]")
		.replace(/\bsk-ant-[a-zA-Z0-9_-]+/g, "sk-ant-[REDACTED]");
}

export type OutputMode = "text" | "json";

export interface FormattedIssue {
	identifier: string;
	title: string;
	state?: string;
	assignee?: string;
	team?: string;
	project?: string;
	priority?: number;
	url?: string;
	updatedAt?: string;
}

const COLUMN_WIDTHS = { identifier: 10, state: 14, assignee: 24 } as const;
const TITLE_MAX = 70;

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

function padRight(text: string, width: number): string {
	if (text.length >= width) return `${text.slice(0, width - 1)} `;
	return text + " ".repeat(width - text.length);
}

export function formatIssuesText(issues: FormattedIssue[]): string {
	if (issues.length === 0) return "No issues found.";
	const header =
		padRight("ID", COLUMN_WIDTHS.identifier) +
		padRight("State", COLUMN_WIDTHS.state) +
		padRight("Assignee", COLUMN_WIDTHS.assignee) +
		"Title";
	const rows = issues.map(
		(issue) =>
			padRight(issue.identifier, COLUMN_WIDTHS.identifier) +
			padRight(issue.state ?? "-", COLUMN_WIDTHS.state) +
			padRight(issue.assignee ?? "-", COLUMN_WIDTHS.assignee) +
			truncate(issue.title, TITLE_MAX),
	);
	return [header, ...rows].join("\n");
}

export function formatIssuesJson(issues: FormattedIssue[]): string {
	return JSON.stringify(issues, null, 2);
}

export function formatIssues(issues: FormattedIssue[], mode: OutputMode): string {
	return mode === "json" ? formatIssuesJson(issues) : formatIssuesText(issues);
}
