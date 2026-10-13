#!/usr/bin/env node
// Bundles the CLI and every package it imports into dist/cli.js, the bin.
// The published package then lists no runtime dependencies, so a Claude Code
// plugin install has nothing to fetch. Claude Code installs a plugin's
// packages only from an npm or Bun lockfile and flags this plugin's pnpm one.
//
// Run locally:   pnpm build

import { rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

await build({
	entryPoints: ["src/cli.ts"],
	outfile: "dist/cli.js",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node20",
	// Bundled CommonJS packages call require() for Node built-ins; an ES module has no require.
	banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
	logLevel: "warning",
});
