#!/usr/bin/env node
// Enforces that every committed file under references/ is either a placeholder
// or an example. A "populated" file (real workspace data) must never enter the
// public repo — those live in the user's private space, pointed to at runtime
// via LINEAR_REFERENCES_DIR.
//
// Run locally:   node scripts/check-no-populated-references.mjs
// Run in CI:     same; failure exits non-zero and surfaces the violators.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REFERENCES_DIR = "references";

function listJsonFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const s = statSync(full);
		if (s.isDirectory()) continue; // schemas live at top-level, not in references/
		if (entry.endsWith(".json")) out.push(full);
	}
	return out;
}

const files = listJsonFiles(REFERENCES_DIR);
const violations = [];

for (const path of files) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		violations.push(`${path}: invalid JSON (${err.message})`);
		continue;
	}
	const isPlaceholder = parsed?._placeholder === true;
	const isExample = parsed?._example === true;
	if (!isPlaceholder && !isExample) {
		violations.push(`${path}: missing "_placeholder": true or "_example": true at top level`);
	}
}

if (violations.length > 0) {
	console.error("Populated reference files found in repo. These must NOT be committed:\n");
	for (const v of violations) console.error(`  - ${v}`);
	console.error(
		"\nReal reference data lives in the user's private space (env var LINEAR_REFERENCES_DIR; default ~/.config/elnora-linear/). " +
			"Move populated files there and replace the committed copy with a placeholder or example.",
	);
	process.exit(1);
}

console.log(`Checked ${files.length} files in ${REFERENCES_DIR}/. All carry _placeholder or _example.`);
