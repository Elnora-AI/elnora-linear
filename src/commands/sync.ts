// `elnora-linear sync` — populate or refresh the reference data files.
//
// Subcommands:
//   sync                       Refresh every auto-discoverable target (no prompts)
//   sync teams|projects|users|workflows   Fetch and write one target from the Linear API
//   sync verify                Validate all references against their schemas
//   sync import --from <path>  Import a JSON bundle into individual reference files
//
// Where it writes:
//   - LINEAR_REFERENCES_DIR (if set)
//   - ~/.config/elnora-linear/ (auto-created if it would otherwise fall back to bundled)
//   - Never writes to the bundled `references/` shipped in the npm package.
//
// What it does NOT do (yet — coming with the curator PR):
//   - Interactive prompts for slack channels, repos, signal sources

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { LinearClient } from "@linear/sdk";

import { getLinearClient } from "../client/index.js";
import {
	BUNDLED_REFERENCES_DIR,
	loadConfig,
	REFERENCE_NAMES,
	type ReferenceName,
	resolveReferencesDir,
} from "../config/index.js";
import type { OutputMode } from "../output/index.js";
import { ValidationError } from "../utils/errors.js";

export type AutoSyncTarget = "teams" | "projects" | "users" | "workflows";
export const AUTO_SYNC_TARGETS: AutoSyncTarget[] = ["teams", "projects", "users", "workflows"];

export interface SyncOptions {
	referencesDir?: string;
	output: OutputMode;
}

export interface SyncImportOptions extends SyncOptions {
	from: string;
}

export interface SyncReport {
	target: string;
	written: number;
	path: string;
}

/**
 * Resolves the directory the sync command should write to.
 *
 * Refuses to write to the bundled `references/` dir shipped in the npm package
 * (would corrupt the install). Instead, falls back to ~/.config/elnora-linear/
 * (auto-creating it).
 */
export function resolveSyncWriteDir(override?: string): string {
	const dir = resolveReferencesDir(override);
	if (dir === BUNDLED_REFERENCES_DIR) {
		const home = join(homedir(), ".config", "elnora-linear");
		mkdirSync(home, { recursive: true });
		return home;
	}
	return dir;
}

// ---------- pure mappers (testable without a Linear client) ----------

export interface MappedTeam {
	key: string;
	name: string;
	description?: string;
}

export function mapTeam(t: { key: string; name: string; description?: string | null }): MappedTeam {
	return {
		key: t.key,
		name: t.name,
		...(t.description ? { description: t.description } : {}),
	};
}

type LinearProjectState = "backlog" | "planned" | "started" | "paused" | "completed" | "canceled" | string;
type SchemaProjectStatus = "Planned" | "In Progress" | "Backlog" | "Completed" | "Canceled";

export function mapProjectStatus(linearState: LinearProjectState | null | undefined): SchemaProjectStatus | undefined {
	if (!linearState) return undefined;
	const m: Record<string, SchemaProjectStatus> = {
		backlog: "Backlog",
		planned: "Planned",
		started: "In Progress",
		paused: "In Progress",
		completed: "Completed",
		canceled: "Canceled",
	};
	return m[linearState.toLowerCase()];
}

export interface MappedProject {
	name: string;
	team: string;
	status?: SchemaProjectStatus;
	description?: string;
}

export function mapProject(
	p: { name: string; description?: string | null; state?: string | null },
	teamKey: string,
): MappedProject {
	const status = mapProjectStatus(p.state);
	return {
		name: p.name,
		team: teamKey,
		...(status ? { status } : {}),
		...(p.description ? { description: p.description } : {}),
	};
}

export interface MappedUser {
	key: string;
	name: string;
	email?: string;
	linear_user_id: string;
}

export function mapUser(u: {
	id: string;
	name: string;
	email?: string | null;
	displayName?: string | null;
}): MappedUser {
	const source = u.displayName ?? u.email?.split("@")[0] ?? u.name;
	const key =
		source
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "user";
	return {
		key,
		name: u.name,
		...(u.email ? { email: u.email } : {}),
		linear_user_id: u.id,
	};
}

export type WorkflowStateType = "backlog" | "unstarted" | "started" | "completed" | "canceled" | "triage";
const WORKFLOW_STATE_TYPES = new Set<WorkflowStateType>([
	"backlog",
	"unstarted",
	"started",
	"completed",
	"canceled",
	"triage",
]);

export interface MappedWorkflowState {
	name: string;
	type: WorkflowStateType;
}

export function mapWorkflowState(s: { name: string; type: string }): MappedWorkflowState | null {
	if (!WORKFLOW_STATE_TYPES.has(s.type as WorkflowStateType)) return null;
	return { name: s.name, type: s.type as WorkflowStateType };
}

// ---------- file write helpers ----------

function writeReferenceJson(dir: string, name: ReferenceName, body: object): string {
	const path = join(dir, `${name}.json`);
	const tmp = `${path}.tmp`;
	// Atomic write: stage into a sibling, fsync-style rename. A crash mid-write
	// leaves the prior file intact rather than corrupting the reference.
	writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
	renameSync(tmp, path);
	return path;
}

/**
 * Read the existing reference file as a parsed object, or null if absent or a
 * placeholder/example template. Used by sync to preserve manually-curated
 * fields that the Linear API doesn't return (e.g. users.slack_user_id,
 * projects.lead, workflows.rules).
 */
export function readExistingReferenceDoc(dir: string, name: ReferenceName): Record<string, unknown> | null {
	const path = join(dir, `${name}.json`);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof parsed !== "object" || parsed === null) return null;
		const obj = parsed as Record<string, unknown>;
		if (obj._placeholder === true || obj._example === true) return null;
		return obj;
	} catch {
		return null;
	}
}

/**
 * Merge fields the mapper didn't produce from the prior entry. Mapped fields
 * always win — they're the source of truth from Linear. Anything else in the
 * prior entry (manual curation: slack_user_id, lead, sla, default_project,
 * etc.) survives the sync.
 */
function mergePreservedFields<T extends object>(mapped: T, prior: Record<string, unknown> | undefined): T {
	if (!prior) return mapped;
	return { ...prior, ...mapped } as T;
}

/**
 * Build a `Map<string, entry>` from an `unknown` array, deriving each entry's
 * key via `keyFn`. Returns null keys are skipped so callers don't have to
 * pre-filter. Entries that aren't objects are dropped.
 */
function indexBy(
	items: unknown,
	keyFn: (item: Record<string, unknown>) => string | null,
): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	if (!Array.isArray(items)) return map;
	for (const item of items) {
		if (typeof item !== "object" || item === null) continue;
		const obj = item as Record<string, unknown>;
		const key = keyFn(obj);
		if (key !== null) map.set(key, obj);
	}
	return map;
}

function projectMergeKey(team: unknown, name: unknown): string | null {
	if (typeof team !== "string" || typeof name !== "string") return null;
	return `${team}::${name}`;
}

function emitReport(report: SyncReport, mode: OutputMode): void {
	if (mode === "json") {
		process.stdout.write(`${JSON.stringify(report)}\n`);
	} else {
		process.stdout.write(`Wrote ${report.written} ${report.target} to ${report.path}\n`);
	}
}

// ---------- live sync (network) ----------

/**
 * Drain a Linear SDK Connection (paged result) into a flat array. Uses the
 * SDK's own `pageInfo.hasNextPage` + `fetchNext()` to follow cursors so we
 * never silently truncate a workspace with more than `first` results.
 */
async function drainConnection<T>(initial: {
	nodes: T[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<{ nodes: T[]; pageInfo: { hasNextPage: boolean }; fetchNext: () => Promise<unknown> }>;
}): Promise<T[]> {
	const all: T[] = [...initial.nodes];
	let cursor = initial as {
		nodes: T[];
		pageInfo: { hasNextPage: boolean };
		fetchNext: () => Promise<unknown>;
	};
	while (cursor.pageInfo.hasNextPage) {
		cursor = (await cursor.fetchNext()) as typeof cursor;
		all.push(...cursor.nodes);
	}
	return all;
}

async function listAllTeams(client: LinearClient) {
	const first = await client.teams({ first: 250 });
	return drainConnection(first);
}

async function syncTeams(client: LinearClient, dir: string): Promise<SyncReport> {
	const teamNodes = await listAllTeams(client);
	const prior = readExistingReferenceDoc(dir, "teams");
	const priorByKey = indexBy(prior?.teams, (t) => (typeof t.key === "string" ? t.key : null));
	const teams = teamNodes.map((t) => {
		const mapped = mapTeam({ key: t.key, name: t.name, description: t.description });
		return mergePreservedFields(mapped, priorByKey.get(mapped.key));
	});
	const path = writeReferenceJson(dir, "teams", { teams });
	return { target: "teams", written: teams.length, path };
}

async function syncProjects(client: LinearClient, dir: string): Promise<SyncReport> {
	const teamNodes = await listAllTeams(client);
	const prior = readExistingReferenceDoc(dir, "projects");
	const priorByTeamName = indexBy(prior?.projects, (p) => projectMergeKey(p.team, p.name));
	const projects: MappedProject[] = [];
	for (const team of teamNodes) {
		const firstPage = await team.projects({ first: 100 });
		const projectNodes = await drainConnection(firstPage);
		for (const p of projectNodes) {
			const mapped = mapProject({ name: p.name, description: p.description, state: p.state }, team.key);
			projects.push(mergePreservedFields(mapped, priorByTeamName.get(`${mapped.team}::${mapped.name}`)));
		}
	}
	const path = writeReferenceJson(dir, "projects", { projects });
	return { target: "projects", written: projects.length, path };
}

async function syncUsers(client: LinearClient, dir: string): Promise<SyncReport> {
	const firstPage = await client.users({ first: 250 });
	const userNodes = await drainConnection(firstPage);
	const prior = readExistingReferenceDoc(dir, "users");
	// Prefer linear_user_id (stable across renames). Fall back to key for any
	// prior entry that predates the linear_user_id field.
	const priorByLinearId = indexBy(prior?.users, (u) =>
		typeof u.linear_user_id === "string" ? u.linear_user_id : null,
	);
	const priorByKey = indexBy(prior?.users, (u) =>
		typeof u.linear_user_id === "string" ? null : typeof u.key === "string" ? u.key : null,
	);
	const users = userNodes.map((u) => {
		const mapped = mapUser({ id: u.id, name: u.name, email: u.email, displayName: u.displayName });
		const priorEntry = priorByLinearId.get(mapped.linear_user_id) ?? priorByKey.get(mapped.key);
		return mergePreservedFields(mapped, priorEntry);
	});
	const path = writeReferenceJson(dir, "users", { users });
	return { target: "users", written: users.length, path };
}

async function syncWorkflows(client: LinearClient, dir: string): Promise<SyncReport> {
	const teamNodes = await listAllTeams(client);
	const prior = readExistingReferenceDoc(dir, "workflows");
	const priorByStateKey = indexBy(prior?.states, (s) =>
		typeof s.name === "string" && typeof s.type === "string" ? `${s.name}|${s.type}` : null,
	);
	const seen = new Set<string>();
	const states: MappedWorkflowState[] = [];
	for (const team of teamNodes) {
		const firstPage = await team.states({ first: 100 });
		const stateNodes = await drainConnection(firstPage);
		for (const s of stateNodes) {
			const mapped = mapWorkflowState({ name: s.name, type: s.type });
			if (!mapped) continue;
			const key = `${mapped.name}|${mapped.type}`;
			if (seen.has(key)) continue;
			seen.add(key);
			states.push(mergePreservedFields(mapped, priorByStateKey.get(key)));
		}
	}
	// Curator rules are entirely user-authored — never overwrite them on sync.
	const rules = Array.isArray(prior?.rules) ? prior.rules : [];
	const path = writeReferenceJson(dir, "workflows", { states, rules });
	return { target: "workflows", written: states.length, path };
}

async function dispatchSync(target: AutoSyncTarget, client: LinearClient, dir: string): Promise<SyncReport> {
	switch (target) {
		case "teams":
			return syncTeams(client, dir);
		case "projects":
			return syncProjects(client, dir);
		case "users":
			return syncUsers(client, dir);
		case "workflows":
			return syncWorkflows(client, dir);
	}
}

/** Internal entry points exported for tests — not part of the public API. */
export const _internal = {
	syncTeams,
	syncProjects,
	syncUsers,
	syncWorkflows,
	mergePreservedFields,
};

export async function runSyncTarget(target: AutoSyncTarget, opts: SyncOptions): Promise<void> {
	const dir = resolveSyncWriteDir(opts.referencesDir);
	const client = await getLinearClient({ allowPrompt: true });
	emitReport(await dispatchSync(target, client, dir), opts.output);
}

export async function runSyncAll(opts: SyncOptions): Promise<void> {
	const dir = resolveSyncWriteDir(opts.referencesDir);
	const client = await getLinearClient({ allowPrompt: true });
	for (const target of AUTO_SYNC_TARGETS) {
		emitReport(await dispatchSync(target, client, dir), opts.output);
	}
}

// ---------- verify ----------

export interface VerifyReport {
	referencesDir: string;
	sources: Record<ReferenceName, "user-file" | "placeholder" | "missing">;
}

export function runSyncVerify(opts: SyncOptions): VerifyReport {
	const cfg = loadConfig({ referencesDir: opts.referencesDir, strict: false });
	const report: VerifyReport = {
		referencesDir: cfg.meta.referencesDir,
		sources: cfg.meta.sources,
	};
	if (opts.output === "json") {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		process.stdout.write(`References dir: ${report.referencesDir}\n`);
		for (const name of REFERENCE_NAMES) {
			const source = report.sources[name];
			const label = source === "user-file" ? "[ok]" : source === "placeholder" ? "[--]" : "[!!]";
			process.stdout.write(`  ${label} ${name}: ${source}\n`);
		}
	}
	return report;
}

// ---------- import ----------

export interface ImportReport {
	written: Array<{ target: ReferenceName; path: string }>;
}

/** Pure: given parsed JSON, decide which reference targets to write. */
export function planImport(parsed: unknown): ReferenceName[] {
	if (typeof parsed !== "object" || parsed === null) {
		throw new ValidationError("Import file must be a JSON object.");
	}
	const obj = parsed as Record<string, unknown>;
	const targets = REFERENCE_NAMES.filter((n) => n in obj);
	if (targets.length === 0) {
		throw new ValidationError(
			`Import file must be a bundle with top-level keys matching reference names: ${REFERENCE_NAMES.join(", ")}.`,
		);
	}
	return targets;
}

export function runSyncImport(opts: SyncImportOptions): ImportReport {
	const dir = resolveSyncWriteDir(opts.referencesDir);
	let raw: string;
	try {
		raw = readFileSync(opts.from, "utf8");
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(`Cannot read import file ${opts.from}: ${msg}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new ValidationError(`Invalid JSON in ${opts.from}: ${msg}`);
	}
	const targets = planImport(parsed);

	const written: ImportReport["written"] = [];
	const obj = parsed as Record<string, unknown>;
	for (const target of targets) {
		const path = writeReferenceJson(dir, target, obj[target] as object);
		written.push({ target, path });
	}

	const report: ImportReport = { written };
	if (opts.output === "json") {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		for (const w of written) {
			process.stdout.write(`Wrote ${w.target} to ${w.path}\n`);
		}
	}
	return report;
}
