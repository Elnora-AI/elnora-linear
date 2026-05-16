# Safety guardrails

The CLI and slash commands are designed so a prompt-injected agent cannot do anything irreversible without a human-typed flag, and so destructive operations leave a paper trail.

## Soft-delete by default

Every archivable entity defaults to **archive** (recoverable). The `--permanent` flag is required for irreversible deletion. Every archivable entity has a paired `restore` command.

## Destructive ops require `--yes`

Permanent deletes and team deletion require an explicit `--yes` flag at the CLI layer. A prompt-injected agent that talks itself out of confirming cannot bypass the gate — the CLI exits with code 2 (`VALIDATION`) and prints nothing if `--yes` is absent.

Gated commands:

- `teams delete <name> --yes` — archives the entire team, all its issues, and all its projects
- `issues delete <id> --permanent --yes`
- `comments delete <id> --yes`
- `documents delete <id> --yes`
- `labels delete <id> --yes`
- `attachments delete <id> --yes`
- `milestones delete <id> --yes`
- `project-labels delete <id> --yes`

`bulk` and `cleanup` default to **dry-run**. They print the proposed plan and require `--yes` to commit. `bulk` additionally refuses no-op invocations — at least one of `--set-state` or `--add-comment` must be set.

## Quality enforcement

Required-label policies (e.g. each issue on a team must have a `Type:` and `Layer:` label) are enforced **server-side** by `issues create`. The CLI rejects invalid combinations with a structured error containing `missing`, `availableForPrefix`, and `suggestedRetry` so the agent can self-correct in one retry without reading any reference file. Policy itself lives in `references/label-policy.json` (loaded from your `LINEAR_REFERENCES_DIR` or `~/.config/elnora-linear/`).

## Attachment upload-path validation

`attachments upload --file <path>` rejects any file outside the allowed upload root. Default root is the current working directory; override with `LINEAR_UPLOAD_ROOT` env or `--allow-root <path>`. Symlinks are resolved with `realpathSync` so a symlink-out exfiltration attempt (e.g. `~/.aws/credentials`, `~/.ssh/id_rsa`) is blocked.

## Credentials

- Linear API key is read from `LINEAR_API_KEY` first.
- If that's empty, the CLI falls back to `~/.config/elnora-linear/.env` (created with mode 0600 on first run).
- If that's empty too, it prompts the user once interactively and writes the result.
- The key is never logged, never written to `--output json` payloads, and never sent anywhere except `api.linear.app`. The `redactSecrets` helper masks any `lin_api_…` substring that appears in error messages or output.

## Curator side effects

`elnora-linear curator-run` is bounded:

- HIGH-tier auto-actions cap at **20 per run** (`MAX_MUTATIONS` in `src/curator/dispatch.ts`).
- MEDIUM-tier queued questions cap at **10 per run** (`MAX_MEDIUM_QUEUED`).
- Every applied action is appended to `~/.config/elnora-linear/state/curator-report.jsonl` for audit.
- Re-asking or re-applying the same action within **14 days** is debounced via stable thread keys.
- Without `ANTHROPIC_API_KEY` (or with `--collect-only`), the curator stops after signal collection — no Linear writes.
- `--dry-run` stages all decisions in the report file and skips the Linear write path.

## External-command signals

`signal-sources.json` accepts entries of type `external_command` that run arbitrary commands (via `execFile`, not a shell) and parse their output. These execute **with your user's privileges**.

Because anyone who can write to `references/signal-sources.json` — or anyone who can set `LINEAR_REFERENCES_DIR` to point at a directory they control — would get code execution on the next curator run, the source is **off by default**. To opt in, set `LINEAR_ALLOW_EXTERNAL_COMMAND=1`. Without the flag, the registry refuses to instantiate `external_command` sources and the curator surfaces a clear error.

Only enable this when you control the contents of `references/signal-sources.json` and understand that the curator will run every command listed there on every invocation. The CLI does not sandbox them.

## Publication safety

The npm package ships `dist/`, `agents/`, `commands/`, `skills/`, `schemas/`, and the `*.placeholder.json` / `*.example.json` reference templates — **never** populated `references/*.json` files. The `references/*.json` glob is gitignored at the repo level too, so populated workspace data cannot accidentally enter a commit or a release tarball.
