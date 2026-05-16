// Runtime loader for elnora-linear's reference data.
//
// Resolution precedence for the references directory (highest first):
//   1. explicit `referencesDir` option
//   2. LINEAR_REFERENCES_DIR env var
//   3. ~/.config/elnora-linear/ (if it exists)
//   4. the bundled `references/` shipped in the npm package (placeholders only)
//
// For each of the 7 reference names, the loader looks for `<name>.json` first
// (populated by the user) and falls back to `<name>.placeholder.json`. Missing
// schemas or invalid JSON throw. Schema-validation failures throw in strict
// mode (default) and warn-and-continue in non-strict mode.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ErrorObject, ValidateFunction } from "ajv";

// ajv@8 and ajv-formats@3 ship as CommonJS. TypeScript's Node16 module
// resolution doesn't synthesize default exports cleanly for CJS, so we load
// them via createRequire. Types still come from the package via `import type`.
const cjsRequire = createRequire(import.meta.url);
const { Ajv2020 } = cjsRequire("ajv/dist/2020.js") as typeof import("ajv/dist/2020.js");
const addFormats = cjsRequire("ajv-formats") as typeof import("ajv-formats").default;

import {
	type LinearConfig,
	type ProjectsConfig,
	REFERENCE_NAMES,
	type ReferenceName,
	type ReferenceSource,
	type ReposConfig,
	type SignalSourcesConfig,
	type SlackConfig,
	type TeamsConfig,
	type UsersConfig,
	type WorkflowsConfig,
} from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// In source: src/config/loader.ts → repo root is two up.
// In dist:   dist/config/loader.js → package root is two up.
// Either way, schemas/ and references/ are siblings of src/dist.
const PACKAGE_ROOT = resolve(HERE, "..", "..");
export const BUNDLED_SCHEMAS_DIR = join(PACKAGE_ROOT, "schemas");
export const BUNDLED_REFERENCES_DIR = join(PACKAGE_ROOT, "references");

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validators: Record<ReferenceName, ValidateFunction> = (() => {
	const out: Partial<Record<ReferenceName, ValidateFunction>> = {};
	for (const name of REFERENCE_NAMES) {
		const schema = JSON.parse(readFileSync(join(BUNDLED_SCHEMAS_DIR, `${name}.json`), "utf8"));
		out[name] = ajv.compile(schema);
	}
	return out as Record<ReferenceName, ValidateFunction>;
})();

export interface LoadConfigOptions {
	/** Explicit references directory; overrides env var and home/bundled defaults. */
	referencesDir?: string;
	/** If false, schema-validation failures warn instead of throwing. Default true. */
	strict?: boolean;
}

export function resolveReferencesDir(override?: string): string {
	if (override) return resolve(override);
	if (process.env.LINEAR_REFERENCES_DIR) return resolve(process.env.LINEAR_REFERENCES_DIR);
	const home = join(homedir(), ".config", "elnora-linear");
	if (existsSync(home)) return home;
	return BUNDLED_REFERENCES_DIR;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
	if (!errors || errors.length === 0) return "(no error details)";
	return errors
		.map((e) => {
			const path = e.instancePath || "/";
			return `  - ${path}: ${e.message}`;
		})
		.join("\n");
}

interface LoadedReference<T> {
	data: T;
	source: ReferenceSource;
	path: string;
}

function loadReference<T>(name: ReferenceName, dir: string, strict: boolean): LoadedReference<T> {
	const populated = join(dir, `${name}.json`);
	const placeholder = join(dir, `${name}.placeholder.json`);
	const bundledPlaceholder = join(BUNDLED_REFERENCES_DIR, `${name}.placeholder.json`);

	let path: string;
	let source: ReferenceSource;
	if (existsSync(populated)) {
		path = populated;
		source = "user-file";
	} else if (existsSync(placeholder)) {
		path = placeholder;
		source = "placeholder";
	} else if (existsSync(bundledPlaceholder)) {
		path = bundledPlaceholder;
		source = "placeholder";
	} else {
		throw new Error(
			`Could not find ${name}.json or ${name}.placeholder.json in ${dir} or bundled defaults at ${BUNDLED_REFERENCES_DIR}.`,
		);
	}

	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		throw new Error(`Failed to read ${path}: ${(err as Error).message}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`${path}: invalid JSON: ${(err as Error).message}`);
	}

	const validate = validators[name];
	if (!validate(parsed)) {
		const message = `${path} failed schema validation:\n${formatAjvErrors(validate.errors)}`;
		if (strict) {
			throw new Error(message);
		}
		console.warn(message);
	}

	return { data: parsed as T, source, path };
}

export function loadConfig(opts: LoadConfigOptions = {}): LinearConfig {
	const strict = opts.strict !== false;
	const referencesDir = resolveReferencesDir(opts.referencesDir);

	const teams = loadReference<TeamsConfig>("teams", referencesDir, strict);
	const projects = loadReference<ProjectsConfig>("projects", referencesDir, strict);
	const users = loadReference<UsersConfig>("users", referencesDir, strict);
	const slack = loadReference<SlackConfig>("slack", referencesDir, strict);
	const repos = loadReference<ReposConfig>("repos", referencesDir, strict);
	const signalSources = loadReference<SignalSourcesConfig>("signal-sources", referencesDir, strict);
	const workflows = loadReference<WorkflowsConfig>("workflows", referencesDir, strict);

	return {
		teams: teams.data,
		projects: projects.data,
		users: users.data,
		slack: slack.data,
		repos: repos.data,
		signalSources: signalSources.data,
		workflows: workflows.data,
		meta: {
			referencesDir,
			bundledReferencesDir: BUNDLED_REFERENCES_DIR,
			sources: {
				teams: teams.source,
				projects: projects.source,
				users: users.source,
				slack: slack.source,
				repos: repos.source,
				"signal-sources": signalSources.source,
				workflows: workflows.source,
			},
		},
	};
}
