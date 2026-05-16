// TypeScript types mirroring schemas/*.json. Manually kept in sync.
// The runtime loader validates parsed JSON against the schemas, so these
// types describe the post-validation shape callers can rely on.

export type ReferenceName = "teams" | "projects" | "users" | "slack" | "repos" | "signal-sources" | "workflows";

export const REFERENCE_NAMES: ReferenceName[] = [
	"teams",
	"projects",
	"users",
	"slack",
	"repos",
	"signal-sources",
	"workflows",
];

interface MetaFlags {
	$schema?: string;
	_placeholder?: boolean;
	_example?: boolean;
	_populated_by?: string;
}

export interface Team {
	key: string;
	name: string;
	description?: string;
	default_project?: string;
}

export interface TeamsConfig extends MetaFlags {
	teams: Team[];
}

export type ProjectPriority = "Urgent" | "High" | "Normal" | "Low";
export type ProjectStatus = "Planned" | "In Progress" | "Backlog" | "Completed" | "Canceled";

export interface Project {
	name: string;
	team: string;
	lead?: string;
	priority?: ProjectPriority;
	status?: ProjectStatus;
	description?: string;
	sla?: string;
}

export interface ProjectsConfig extends MetaFlags {
	projects: Project[];
}

export interface User {
	key: string;
	name: string;
	email?: string;
	linear_user_id?: string;
	slack_user_id?: string;
}

export interface UsersConfig extends MetaFlags {
	users: User[];
}

export interface SlackChannel {
	id: string;
	name: string;
	purpose?: string;
}

export interface SlackConfig extends MetaFlags {
	channels: SlackChannel[];
	allowed_channels: string[];
	allowed_dm_users: string[];
}

export interface Repo {
	name: string;
	org?: string;
	local_path?: string;
	default_branch?: string;
}

export interface ReposConfig extends MetaFlags {
	repos: Repo[];
}

export type SignalSourceType =
	| "github_commits"
	| "github_pr"
	| "slack_messages"
	| "linear_issues"
	| "external_command"
	| "mcp_tool";

export interface SignalSourceBase {
	type: SignalSourceType;
	name: string;
	enabled?: boolean;
}

export interface GithubCommitsSource extends SignalSourceBase {
	type: "github_commits";
	repos?: string[];
	lookback_days?: number;
}

export interface GithubPrSource extends SignalSourceBase {
	type: "github_pr";
	repos?: string[];
}

export interface SlackMessagesSource extends SignalSourceBase {
	type: "slack_messages";
	channels?: string[];
	match_patterns?: string[];
}

export interface LinearIssuesSource extends SignalSourceBase {
	type: "linear_issues";
}

export interface ExternalCommandSource extends SignalSourceBase {
	type: "external_command";
	command: string;
	parse_as?: "json" | "lines" | "regex";
	issue_match_field?: string;
}

export interface McpToolSource extends SignalSourceBase {
	type: "mcp_tool";
	server: string;
	tool: string;
	args?: Record<string, unknown>;
}

export type SignalSource =
	| GithubCommitsSource
	| GithubPrSource
	| SlackMessagesSource
	| LinearIssuesSource
	| ExternalCommandSource
	| McpToolSource;

export interface SignalSourcesConfig extends MetaFlags {
	sources: SignalSource[];
}

export type WorkflowStateType = "backlog" | "unstarted" | "started" | "completed" | "canceled" | "triage";

export interface WorkflowState {
	name: string;
	type: WorkflowStateType;
}

export type WorkflowRuleTier = "high" | "medium" | "low";

export interface WorkflowRule {
	id: string;
	tier: WorkflowRuleTier;
	description: string;
	when: Record<string, unknown>;
	action: Record<string, unknown>;
}

export interface WorkflowsConfig extends MetaFlags {
	states: WorkflowState[];
	rules: WorkflowRule[];
}

// How a particular reference file was resolved on disk.
//   "user-file"   — populated <name>.json found in references dir
//   "placeholder" — only the bundled / user <name>.placeholder.json was found
//   "missing"     — neither found (loader threw before returning)
export type ReferenceSource = "user-file" | "placeholder" | "missing";

export interface LinearConfig {
	teams: TeamsConfig;
	projects: ProjectsConfig;
	users: UsersConfig;
	slack: SlackConfig;
	repos: ReposConfig;
	signalSources: SignalSourcesConfig;
	workflows: WorkflowsConfig;
	meta: {
		referencesDir: string;
		bundledReferencesDir: string;
		sources: Record<ReferenceName, ReferenceSource>;
	};
}
