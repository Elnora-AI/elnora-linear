# elnora-linear

**The full Linear API as a CLI, a Claude Code plugin, and a signal-driven hygiene curator — purpose-built for AI coding agents to create, edit, review, and curate Linear issues safely at scale.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@elnora-ai/linear)](https://www.npmjs.com/package/@elnora-ai/linear)
[![CI](https://github.com/Elnora-AI/elnora-linear/actions/workflows/ci.yml/badge.svg)](https://github.com/Elnora-AI/elnora-linear/actions)

---

## Install

> **The CLI and the Claude Code plugin are two separate installs.** The plugin's agents, skills, and slash commands all shell out to the `elnora-linear` binary — so you must install the CLI **first**, even if your only goal is to use the plugin. `/plugin install` does not install the CLI.

### Step 1 — Install the CLI (required for everyone)

```sh
npm install -g @elnora-ai/linear
elnora-linear issues list                       # prompts for your Linear API key on first run
```

Get a key at [linear.app/settings/api](https://linear.app/settings/api). It's saved to `~/.config/elnora-linear/.env` (mode `0600`).

**Auto-sync on install.** If `LINEAR_API_KEY` is already in your environment (or saved at `~/.config/elnora-linear/.env`) when you run `npm install -g`, the postinstall hook populates teams / projects / users / workflows from your Linear workspace. Otherwise run `elnora-linear sync all` later.

Escape hatches for the auto-sync (any one disables it): `ELNORA_LINEAR_SKIP_POSTINSTALL=1`, `CI=true` (auto-detected), or non-global installs.

### Step 2 — Add the Claude Code plugin (optional, Claude Code only)

**Only after Step 1 succeeds.** The plugin adds slash commands and dispatched subagents on top of the CLI. Run these as **two separate slash commands** (paste the first, hit enter, wait for it to finish, then paste the second):

```
/plugin marketplace add Elnora-AI/elnora-linear
```

```
/plugin install linear-workspace@elnora-linear
```

Verify both are wired up:

```sh
elnora-linear --version                         # CLI on PATH
```

Then `/plugin` inside Claude Code should list `linear-workspace` as enabled. If `elnora-linear --version` fails, go back to Step 1 — the plugin's agents will not work without the binary on PATH.

### Using Codex, Cursor, or any other AI coding agent

Install the CLI (Step 1 above), then drop [`AGENTS.md`](AGENTS.md) at your project root. These agents read it natively for the intent → CLI dispatch table. No plugin install needed — the plugin is Claude-Code-only.

> **Installing via an AI agent?** Point it at [`INSTALL_FOR_AGENTS.md`](INSTALL_FOR_AGENTS.md) — a gated, step-by-step runbook to verify the install, collect the key, sync references, and smoke-test.

---

## What you get

Three surfaces, two installs:

- **`elnora-linear` CLI** *(npm package — Step 1 above)* — complete coverage of the Linear GraphQL API. Scriptable, JSON-pipeable, structured errors that agents can self-correct from. Also ships `elnora-linear curator-run`, the config-driven automation that polls GitHub, Slack, and custom shell signals, asks an LLM what to do, auto-applies safe state changes (capped, debounced, audit-logged), and queues the rest for human review.
- **`linear-workspace` Claude Code plugin** *(separate `/plugin install` — Step 2 above)* — slash commands, five specialized agents, and a router skill that picks the right one from intent. Every agent delegates to the CLI from Step 1.

---

## Capabilities

**Read** — search, `my-issues`, get one issue / project / cycle / milestone / initiative / document, team workflows, label catalogs, members, saved views, project + initiative status updates, audit logs, notifications, agent activity, rate-limit headroom, `context --team` for one-call cold-start.

**Write** — create one issue or batches up to 50 (server-side label-policy + require-a-project validation), update every field, manage comments / relations / projects / initiatives / milestones / cycles / documents / status updates / labels / customers / customer needs / webhooks / agent sessions. Attach URLs or upload local files (path-validated, symlink-resolved).

**Bulk + cleanup** — `bulk` (state/comment changes across N issues, dry-run by default), `cleanup` (six-check audit), `batch-create` / `batch-update` (50-issue caps), `bulk-ops` (heterogeneous GraphQL aliasing — ~10 HTTP requests per 100 mixed operations), `sync all`, `sync verify`.

**Compliance** — [`templates/`](templates/) ships 23 Linear issue templates (SOC 2, change mgmt, RCA, vulnerability, access provisioning, vendor risk, AI capability). `elnora-linear templates list` / `templates sync` push them to Linear.

**Pipe** — `--output json` on every read; `--output csv` and `--output table` where it makes sense.

Run `elnora-linear --help` for every verb.

### Slash commands (Claude Code)

| Command | Does |
|---|---|
| `/linear-search` | Natural-language search across all issues |
| `/linear-my-issues` | Your assigned issues, grouped by state |
| `/linear-bulk` | Apply the same state change or comment to many issues — dry-run by default |
| `/linear-cleanup` | Six-check audit with per-category confirmation |
| `/linear-sync` | Refresh teams/projects/users/workflows from the Linear API |
| `/linear-curator-run` | Run the curator manually |

### Agents (Claude Code)

| Agent | For |
|---|---|
| `linear-issue-creator` | One issue from a description |
| `linear-url-to-issues` | N issues extracted from an article, design, blog, or doc URL |
| `linear-issue-updater` | Any modification: state, team, assignee, labels, comment, relations, close |
| `linear-issue-reviewer` | Validates an issue's Done Criteria against its linked PR diff and posts a verdict comment |
| `linear-state-curator` | Daily hygiene — runs the curator headlessly |

A router skill (`linear-workspace`) dispatches to the right agent or command from intent. Other agents (Codex, Cursor, and others) get the same dispatch mapping via [`AGENTS.md`](AGENTS.md).

---

## Curator

`elnora-linear curator-run` polls configured signal sources, builds an LLM snapshot of your open issues, and dispatches per tier:

- **HIGH** — state change applied immediately with a rationale comment. Capped at 20 mutations/run; same `{issue, from, to}` debounced 14 days.
- **MEDIUM** — proposed action staged in `~/.config/elnora-linear/state/curator-state.json` for human review. Outbound Slack confirmation (DM-back + threaded replies) is in the spec but not yet shipped.
- **LOW** — added to the run report. No side effects.

| Signal source | Reads |
|---|---|
| `github_commits` | Commit messages over a lookback window |
| `github_pr` | Open / closed / merged PR events |
| `slack_messages` | Watched channel history (Slack app setup: see [`INSTALL_FOR_AGENTS.md`](INSTALL_FOR_AGENTS.md#4b-slackjson--channels-for-the-slack_messages-signal)) |
| `external_command` | Arbitrary CLI command output — **off unless `LINEAR_ALLOW_EXTERNAL_COMMAND=1`** |

(`mcp_tool` is reserved in the schema for a future release.)

Every applied action is appended to `~/.config/elnora-linear/state/curator-report.jsonl`. Without `ANTHROPIC_API_KEY` (or with `--collect-only`), the curator runs in diagnostic mode. Recurring schedule: see [`docs/scheduling.md`](docs/scheduling.md).

---

## Agent-safe by design

- **Soft-delete by default.** Archive is default; recovery is one command. Permanent removal requires `--permanent` + `--yes`.
- **Human-confirmed mutations.** Bulk, cleanup, permanent deletes, and team deletion gate behind a typed `--yes`.
- **Structured errors for self-correction.** `issues create` returns `{ missing, availableForPrefix, suggestedRetry }` on label-policy violations and `{ availableProjects, suggestedRetry }` on the require-a-project rule.
- **Every issue gets a project by default.** `issues create`, `issues batch-create`, and `issues bulk-ops` (create) require `--project` whenever the target team has projects to choose from. Opt out per-team via `label-policy.json` (`requiresProject: false`) or per-call with `--skip-project-check`.
- **Bounded curator runs.** HIGH actions cap at 20 per run; each `{issue, from, to}` debounced 14 days; every applied action audit-logged.
- **Validated upload paths.** Attachments resolve through `LINEAR_UPLOAD_ROOT` with symlink resolution.
- **Isolated credentials.** API key loaded from `LINEAR_API_KEY` → `~/.config/elnora-linear/.env` (mode `0600`) → interactive prompt. Masked in errors, omitted from JSON output, redacted in logs.

Full details in [SAFETY.md](SAFETY.md).

---

## Requirements

| Always | |
|---|---|
| Node.js | `>=20` |
| Linear account | Personal API key from [linear.app/settings/api](https://linear.app/settings/api) |

| Curator (opt-in per signal source) | |
|---|---|
| `ANTHROPIC_API_KEY` | LLM dispatch — without it the curator runs in `--collect-only` diagnostic mode |
| `gh` CLI, authenticated | `github_pr` signal source |
| `git` + local clone | `github_commits` signal source (`repos.json` entries need `local_path`) |
| `SLACK_TOKEN` | `slack_messages` signal source (read-only — outbound posting not shipped yet) |
| `LINEAR_ALLOW_EXTERNAL_COMMAND=1` | `external_command` signal source (off by default) |

npm dependencies (auto-installed): [`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk), [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk), [`commander`](https://www.npmjs.com/package/commander), [`ajv`](https://www.npmjs.com/package/ajv) + [`ajv-formats`](https://www.npmjs.com/package/ajv-formats).

---

## Configuration

Workspace config lives in `~/.config/elnora-linear/` (override with `LINEAR_REFERENCES_DIR`). The npm package ships **placeholders** only — populated `*.json` files are gitignored and excluded from the npm tarball.

```
.env                # LINEAR_API_KEY (mode 0600)
teams.json          # ← elnora-linear sync teams      (auto)
projects.json       # ← elnora-linear sync projects   (auto)
users.json          # ← elnora-linear sync users      (auto)
workflows.json      # ← elnora-linear sync workflows  (auto)
label-policy.json   # required labels per team        (manual)
slack.json          # channels for slack_messages      (manual)
repos.json          # GitHub repos the curator watches (manual)
signal-sources.json # curator inputs                   (manual)
```

Each file has a JSON Schema in [`schemas/`](schemas/) and a populated example at `references/<name>.example.json`. The loader validates every read. To finish curator setup, ask your agent: **"set up my curator config"** — it walks each manual file using the examples as templates. Run `elnora-linear sync verify` to see what's populated.

---

## Development

```sh
git clone https://github.com/Elnora-AI/elnora-linear.git
cd elnora-linear
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Linting: [Biome](https://biomejs.dev). Tests: [Vitest](https://vitest.dev). Releases: [release-please](https://github.com/googleapis/release-please).

---

## Contributing & License

Issues and PRs welcome — see [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md). Security: [.github/SECURITY.md](.github/SECURITY.md) or `security@elnora.ai`. Licensed under [Apache-2.0](LICENSE).
