// `new:N` placeholders let one batch refer to issues it is about to create.
//
// A create declares `"id": "new:1"`; any later op may target `new:1` (`id`, `from`,
// `to`, `issue`, `parent`), and any title, description or comment body may mention it.
// Linear assigns identifiers only on create, so the CLI creates first, then rewrites
// every mention to the identifier it got back. Before this, nothing resolved the
// mentions inside text: they landed in Linear as the literal string `new:1`.

import { ValidationError } from "./errors.js";

const PLACEHOLDER = /^new:\d+$/;
/** A placeholder mentioned in text. The lookarounds keep `renew:1` and `new:10` apart from `new:1`. */
const MENTION = /(?<![\w:])new:\d+(?!\w)/g;

export const PLACEHOLDER_REF_KEYS = ["id", "from", "to", "issue", "parent"] as const;
export const PLACEHOLDER_TEXT_KEYS = ["title", "description", "body"] as const;

export const isPlaceholder = (v: unknown): v is string => typeof v === "string" && PLACEHOLDER.test(v);

/** Every distinct placeholder mentioned in `text`, in order of first mention. */
export function placeholdersIn(text: string): string[] {
	return [...new Set(text.match(MENTION) ?? [])];
}

/** Placeholders an item mentions, in its reference fields and its text fields. */
export function placeholdersOf(item: Record<string, unknown>): string[] {
	const found = new Set<string>();
	for (const k of PLACEHOLDER_REF_KEYS) if (isPlaceholder(item[k])) found.add(item[k] as string);
	for (const k of PLACEHOLDER_TEXT_KEYS) {
		const v = item[k];
		if (typeof v === "string") for (const p of placeholdersIn(v)) found.add(p);
	}
	return [...found];
}

/**
 * Validate a batch's placeholders before anything is written, and return each
 * declared placeholder's item index.
 *
 * `isCreate` picks the items that may declare one (in its `id` key). Throws when a
 * declaration is malformed or repeated, when anything mentions a placeholder nothing
 * declares, and when a create names a new issue as its parent: every create in a batch
 * goes out before any placeholder has an identifier.
 */
export function collectPlaceholders(
	items: Array<Record<string, unknown>>,
	isCreate: (item: Record<string, unknown>) => boolean,
	label: (index: number) => string,
): Map<string, number> {
	const declared = new Map<string, number>();
	items.forEach((item, i) => {
		if (!isCreate(item) || item.id === undefined) return;
		if (!isPlaceholder(item.id)) {
			throw new ValidationError(
				`${label(i)}: "id" on a create must be a placeholder like "new:1", got ${JSON.stringify(item.id)}.`,
			);
		}
		if (declared.has(item.id)) {
			throw new ValidationError(
				`${label(i)}: placeholder ${item.id} is already declared by ${label(declared.get(item.id) as number)}.`,
			);
		}
		declared.set(item.id, i);
	});
	items.forEach((item, i) => {
		const undeclared = placeholdersOf(item).filter((p) => !declared.has(p));
		if (undeclared.length > 0) {
			throw new ValidationError(
				`${label(i)}: ${undeclared.join(", ")} ${undeclared.length === 1 ? "is" : "are"} not declared by any create.`,
				'Declare each placeholder once, on the create that makes that issue: "id": "new:1".',
			);
		}
		if (isCreate(item) && isPlaceholder(item.parent)) {
			throw new ValidationError(
				`${label(i)}: parent ${item.parent} is created in the same batch, so it has no identifier yet.`,
				"Create the child without a parent, then set it with an update op.",
			);
		}
	});
	return declared;
}

/**
 * Rewrite every placeholder in an item to the identifier it resolved to.
 *
 * Returns the placeholders it could not resolve (their create failed) instead of a
 * half-rewritten item, so the caller can skip the op rather than send `new:2` to Linear.
 */
export function resolvePlaceholders(
	item: Record<string, unknown>,
	identifiers: ReadonlyMap<string, string>,
): { item: Record<string, unknown>; missing: string[] } {
	const missing = placeholdersOf(item).filter((p) => !identifiers.has(p));
	if (missing.length > 0) return { item, missing };
	const out = { ...item };
	for (const k of PLACEHOLDER_REF_KEYS) {
		if (isPlaceholder(out[k])) out[k] = identifiers.get(out[k] as string);
	}
	for (const k of PLACEHOLDER_TEXT_KEYS) {
		const v = out[k];
		if (typeof v === "string") out[k] = v.replace(MENTION, (p) => identifiers.get(p) as string);
	}
	return { item: out, missing };
}
