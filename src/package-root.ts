// Package root: where package.json, schemas/, references/, agents/,
// bridges/ and templates/ live. This module sits one level under the root in
// every layout: src/package-root.ts during development and tests, and
// dist/cli.js once esbuild bundles every module into that one file.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
