import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	_resetOutputState,
	getFields,
	handleAsyncCommand,
	outputError,
	outputSuccess,
	redactAuditEntry,
	setFields,
	setOutputFormat,
	setPrettyMode,
} from "../../src/output/cli.js";
import { AuthError, CliError, EXIT_CODES, ValidationError } from "../../src/utils/errors.js";

let stdout: string[] = [];
let stderr: string[] = [];
let exitCode: number | null = null;

beforeEach(() => {
	_resetOutputState();
	stdout = [];
	stderr = [];
	exitCode = null;
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
		stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
		return true;
	});
	vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
		stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
		return true;
	});
	vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
		exitCode = code ?? 0;
		throw new Error("__test_exit__");
	}) as never);
});

afterEach(() => {
	_resetOutputState();
	vi.restoreAllMocks();
});

describe("outputSuccess (json)", () => {
	it("writes compact JSON by default", () => {
		outputSuccess({ ok: true, n: 1 });
		expect(stdout.join("")).toBe('{"ok":true,"n":1}\n');
	});

	it("pretty-prints when setPrettyMode(true)", () => {
		setPrettyMode(true);
		outputSuccess({ ok: true });
		expect(stdout.join("")).toBe(`${JSON.stringify({ ok: true }, null, 2)}\n`);
	});
});

describe("outputSuccess (table)", () => {
	it("renders the largest array as a table", () => {
		setOutputFormat("table");
		outputSuccess({
			users: [
				{ name: "Alice", role: "lead" },
				{ name: "Bob", role: "ic" },
			],
			count: 2,
		});
		const out = stdout.join("");
		expect(out).toMatch(/NAME\s+ROLE/);
		expect(out).toMatch(/Alice\s+lead/);
		expect(out).toMatch(/count: 2/);
	});

	it("falls back to JSON when no array present", () => {
		setOutputFormat("table");
		outputSuccess({ ok: true });
		expect(stderr.join("")).toMatch(/Falling back to JSON/);
		expect(stdout.join("")).toMatch(/"ok": true/);
	});

	it("handles heterogeneous rows via unionKeys", () => {
		setOutputFormat("table");
		outputSuccess({ rows: [{ a: 1 }, { a: 2, b: 3 }] });
		const out = stdout.join("");
		expect(out).toMatch(/A\s+B/);
	});
});

describe("outputSuccess (csv)", () => {
	it("emits header + rows", () => {
		setOutputFormat("csv");
		outputSuccess({
			items: [
				{ x: 1, y: "two,three" },
				{ x: 4, y: "fine" },
			],
		});
		const out = stdout.join("");
		expect(out).toContain("x,y");
		expect(out).toContain('1,"two,three"');
		expect(out).toContain("4,fine");
	});

	it("escapes quotes inside cells", () => {
		setOutputFormat("csv");
		outputSuccess({ rows: [{ s: 'has "quote"' }] });
		expect(stdout.join("")).toContain(`"has ""quote"""`);
	});
});

describe("setOutputFormat", () => {
	it("rejects invalid formats", () => {
		expect(() => setOutputFormat("yaml")).toThrow(ValidationError);
	});
});

describe("setFields / getFields", () => {
	it("parses comma-separated fields", () => {
		setFields("a, b, c");
		expect(getFields()).toEqual(["a", "b", "c"]);
	});

	it("rejects empty input", () => {
		expect(() => setFields("  ")).toThrow(ValidationError);
	});

	it("filters list responses to requested fields only", () => {
		setFields("name");
		outputSuccess({ users: [{ name: "Alice", role: "lead" }] });
		expect(JSON.parse(stdout.join("").trim())).toEqual({ users: [{ name: "Alice" }] });
	});

	it("filters single-object responses", () => {
		setFields("id");
		outputSuccess({ id: "u1", secret: "shh" });
		expect(JSON.parse(stdout.join("").trim())).toEqual({ id: "u1" });
	});

	it("throws when all requested fields are missing on lists", () => {
		setFields("nope");
		expect(() => outputSuccess({ users: [{ name: "Alice" }] })).toThrow(ValidationError);
	});

	it("warns when some requested fields are missing", () => {
		setFields("name,nope");
		outputSuccess({ users: [{ name: "Alice", role: "lead" }] });
		expect(stderr.join("")).toMatch(/Warning: --fields requested non-existent field/);
	});
});

describe("outputError", () => {
	it("includes suggestion + data from CliError", () => {
		outputError(new ValidationError("bad input", "use --help"));
		const payload = JSON.parse(stderr.join(""));
		expect(payload.error).toBe("bad input");
		expect(payload.suggestion).toBe("use --help");
	});

	it("redacts API keys from error messages", () => {
		outputError(new Error("auth failed for lin_api_supersecret"));
		const payload = JSON.parse(stderr.join(""));
		expect(payload.error).toContain("lin_api_[REDACTED]");
		expect(payload.error).not.toContain("supersecret");
		expect(payload.type).toBe("Error");
	});

	it("renders unknown-type errors as plain string", () => {
		outputError("boom lin_api_xyz");
		expect(stderr.join("")).toContain("lin_api_[REDACTED]");
	});
});

describe("handleAsyncCommand", () => {
	it("exits 0 path: calls fn, no error", async () => {
		const fn = vi.fn(async (n: number) => {
			outputSuccess({ doubled: n * 2 });
		});
		const wrapped = handleAsyncCommand(fn);
		await wrapped(3);
		expect(fn).toHaveBeenCalledWith(3);
		expect(exitCode).toBeNull();
		expect(stdout.join("")).toContain('"doubled":6');
	});

	it("uses CliError exit code on failure", async () => {
		const wrapped = handleAsyncCommand(async () => {
			throw new AuthError("missing key");
		});
		await expect(wrapped()).rejects.toThrow("__test_exit__");
		expect(exitCode).toBe(EXIT_CODES.AUTH);
		expect(stderr.join("")).toContain("missing key");
	});

	it("uses GENERAL exit code on plain Error", async () => {
		const wrapped = handleAsyncCommand(async () => {
			throw new Error("uh-oh");
		});
		await expect(wrapped()).rejects.toThrow("__test_exit__");
		expect(exitCode).toBe(EXIT_CODES.GENERAL);
	});

	it("uses VALIDATION exit code on ValidationError", async () => {
		const wrapped = handleAsyncCommand(async () => {
			throw new ValidationError("bad");
		});
		await expect(wrapped()).rejects.toThrow("__test_exit__");
		expect(exitCode).toBe(EXIT_CODES.VALIDATION);
	});
});

describe("redactAuditEntry", () => {
	it("masks ip when present", () => {
		const masked = redactAuditEntry({ ip: "1.2.3.4", action: "view" });
		expect(masked.ip).toBe("[REDACTED]");
		expect(masked.action).toBe("view");
	});

	it("masks apiKeyId/apiKeyLabel/oauth* in metadata", () => {
		const masked = redactAuditEntry({
			metadata: {
				apiKeyId: "k_123",
				apiKeyLabel: "main",
				oauthClientId: "c_456",
				oauthClientName: "GH",
				keep: "this",
			},
		});
		const md = masked.metadata as Record<string, unknown>;
		expect(md.apiKeyId).toBe("[REDACTED]");
		expect(md.apiKeyLabel).toBe("[REDACTED]");
		expect(md.oauthClientId).toBe("[REDACTED]");
		expect(md.oauthClientName).toBe("[REDACTED]");
		expect(md.keep).toBe("this");
	});

	it("never mutates the input object", () => {
		const original = { ip: "1.2.3.4" };
		const masked = redactAuditEntry(original);
		expect(original.ip).toBe("1.2.3.4");
		expect(masked.ip).toBe("[REDACTED]");
	});

	it("leaves empty ip alone", () => {
		const masked = redactAuditEntry({ ip: "" });
		expect(masked.ip).toBe("");
	});
});

describe("CliError suggestion (compatibility)", () => {
	it("emits via outputError", () => {
		outputError(new CliError("explode", { suggestion: "try harder", data: { ctx: "x" } }));
		const payload = JSON.parse(stderr.join(""));
		expect(payload.error).toBe("explode");
		expect(payload.suggestion).toBe("try harder");
		expect(payload.ctx).toBe("x");
	});
});
