# elnora-linear

**The full Linear API as a CLI, a Claude Code plugin, and a signal-driven hygiene curator — purpose-built for AI coding agents to create, edit, review, and curate Linear issues safely at scale.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@elnora-ai/linear)](https://www.npmjs.com/package/@elnora-ai/linear)
[![CI](https://github.com/Elnora-AI/elnora-linear/actions/workflows/ci.yml/badge.svg)](https://github.com/Elnora-AI/elnora-linear/actions)

---

## What you get

Three surfaces, one npm package:

- **`elnora-linear` CLI** — complete coverage of the Linear GraphQL API. Scriptable, JSON-pipeable, with structured errors that AI agents can self-correct from.
- **`linear-workspace` Claude Code plugin** — six slash commands, five specialized agents, and a router skill that picks the right one from intent. `/plugin install linear-workspace@elnora-linear`.
- **`elnora-linear curator-run`** — config-driven automation that polls GitHub, Slack, and custom shell signals, asks an LLM what to do, auto-applies safe state changes (capped, debounced, audit-logged), and queues the rest for human review.

Built end-to-end so AI coding agents can drive Linear with confidence: structured errors for self-correction, bounded mutations, soft-delete defaults, and a hard `--yes` gate on anything destructive.

**Using a non-Claude agent?** [`AGENTS.md`](AGENTS.md) gives Codex, Cursor, Aider, Continue, Amp, Jules, and Roo the same dispatch logic via the CLI — drop it at the root of any repo and your agent picks up when to use which verb.

---

## What you can do with it

### Read your workspace
- Natural-language search across issues, scoped by team / assignee / state / label
- Your assigned issues, grouped by state (`my-issues`)
- Fetch one issue, project, cycle, milestone, initiative, or document
- Team workflows, label catalogs, member rosters, saved views
- Project & initiative status updates (onTrack / atRisk / offTrack)
- Audit logs, notifications, agent activity threads
- Rate-limit headroom (`quota`)
- Cold-start any team (`context --team`) — projects + states + label catalog + members in one call

### Write to your workspace
- Create one issue or batches of 50 (validated against team's label policy server-side)
- Update title / description / state / assignee / labels / priority / project / due date / parent
- Add, resolve, react to, and delete comments
- Link issues with `related` / `blocks` / `duplicate` / `similar` relations
- Manage projects, initiatives, milestones, cycles, documents, status updates
- Manage labels (team-scoped and workspace-wide; project labels separately)
- Attach URLs or upload local files (path-validated, symlink-resolved)
- Manage customers and customer needs
- Manage webhooks with secret rotation + signature verification
- Manage Linear agent sessions and activity events

### Bulk and cleanup
- `bulk` — apply the same state change or comment to N issues filtered by query/team/assignee/state. Dry-run by default; `--yes` to commit
- `cleanup` — six-check audit (missing labels, stale, duplicates, wrong state, orphaned, unactionable) with per-category confirmation
- `batch-create` / `batch-update` — 50-issue caps, heterogeneous GraphQL aliasing (~10 HTTP requests per 100 mixed operations)
- `sync all` — refresh teams, projects, users, workflows from Linear in one batch
- `sync verify` — see which reference files are populated vs placeholder

### Drive Linear from Claude Code

| Slash command | Does |
|---|---|
| `/linear-search` | Natural-language search across all issues |
| `/linear-my-issues` | Your assigned issues, grouped by state |
| `/linear-bulk` | Apply the same state change or comment to many issues — dry-run by default |
| `/linear-cleanup` | Six-check audit with per-category confirmation |
| `/linear-sync` | Refresh teams/projects/users/workflows from the Linear API |
| `/linear-curator-run` | Run the curator manually |

| Agent | For |
|---|---|
| `linear-issue-creator` | One issue from a description. Fast-path for fully-specified requests |
| `linear-url-to-issues` | N issues extracted from an article, design, blog, or doc URL |
| `linear-issue-updater` | Any modification: state, team, assignee, labels, comment, relations, close |
| `linear-issue-reviewer` | Validates an issue's Done Criteria against its linked PR diff and posts a verdict comment |
| `linear-state-curator` | Daily Linear hygiene — runs the curator headlessly |

A router skill (`linear-workspace`) dispatches to the right agent or command from intent, so you can say "find every stale ENG issue and close it" without naming a command.

> **Other agents** (Codex, Cursor, Aider, Continue, Amp, Jules, Roo) invoke the underlying CLI verbs directly — [`AGENTS.md`](AGENTS.md) contains the dispatch table mapping intent → CLI command.

### Automate hygiene with the curator
Polls configured signal sources, builds an LLM snapshot of your open issues, and dispatches per tier:

- **HIGH** — state change applied immediately with a rationale comment. Capped at 20 mutations/run. Re-apply on the same `{issue, from, to}` debounced 14 days.
- **MEDIUM** — proposed action queued in `~/.config/elnora-linear/state/curator-state.json` for a human to review. Outbound Slack confirmation (DM-back + threaded replies) is in the spec but not yet shipped; today you read the state file directly or via the `linear-state-curator` agent.
- **LOW** — added to the run report. No side effects.

Signal sources supported:

| Type | Source |
|---|---|
| `github_commits` | Commit messages over a lookback window |
| `github_pr` | Open / closed / merged PR events |
| `slack_messages` | Messages in watched channels, optionally pattern-matched |
| `external_command` | Arbitrary CLI command output (JSON or text) — **off unless `LINEAR_ALLOW_EXTERNAL_COMMAND=1`** |

`mcp_tool` is reserved in the schema for a future release. Configuring one today raises a "not yet implemented" error at collect time.

Every applied action is appended to `~/.config/elnora-linear/state/curator-report.jsonl`. Without `ANTHROPIC_API_KEY` (or with `--collect-only`), the curator runs in diagnostic mode and only reports collected signals.

Recurring schedule: see [`docs/scheduling.md`](docs/scheduling.md) for launchd, systemd, and Task Scheduler templates.

#### Slack setup (for the `slack_messages` signal)

The curator reads channel history via Slack's `conversations.history` API. To wire it up:

1. **Create a Slack app.** Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**. Name it (e.g. `elnora-linear`) and pick your workspace.
2. **Add bot token scopes.** Sidebar → **OAuth & Permissions** → **Bot Token Scopes** → add `channels:history` (public channels) and `groups:history` (private channels).
3. **Install the app** to your workspace from the top of the same page and approve.
4. **Copy the Bot User OAuth Token** (starts with `xoxb-`) and export it:
   ```sh
   export SLACK_TOKEN=xoxb-...
   ```
5. **Invite the bot to each channel** you want watched. In Slack, open the channel and run `/invite @your-app-name`. The bot only sees channels it's a member of.
6. **Copy each channel's ID.** In Slack, click the channel name at the top → scroll to the bottom of the details panel → copy the ID (format `C0123ABCDEF`). Add them to `~/.config/elnora-linear/slack.json`:
   ```json
   {
     "channels": [{ "id": "C0123ABCDEF", "name": "engineering" }],
     "allowed_channels": ["C0123ABCDEF"]
   }
   ```

Verify with `elnora-linear curator-run --collect-only` — collected Slack signals should appear in the output.

### Compliance templates
[`templates/`](templates/) ships 23 Linear issue templates for SOC 2 / change management / RCA / vulnerability / access provisioning / vendor risk / AI capability workflows. `elnora-linear templates list` and `templates sync` push them to Linear.

### Pipe to anything
`--output json` on every read command. `--output csv` and `--output table` where it makes sense. Pipe directly into `jq`, scripts, dashboards, or another agent's input.

---

## Agent-safe by design

Every layer is engineered so AI agents can operate Linear at scale with sensible defaults:

- **Soft-delete by default.** Archive is the default for every removable entity; recovery is one command. Permanent removal is an explicit, opt-in path (`--permanent` + `--yes`).
- **Human-confirmed mutations.** Bulk, cleanup, permanent deletes, and team deletion confirm with a typed `--yes` before committing — a clear, auditable handoff between agent and human.
- **Structured errors for self-correction.** `issues create` returns `{ missing, availableForPrefix, suggestedRetry }` on label-policy violations and `{ availableProjects, suggestedRetry }` on the require-a-project rule (default on), so agents fix the request on the next call instead of retrying blind.
- **Every issue gets a project by default.** `issues create` requires `--project` whenever the target team has projects to choose from. Opt out per-team in `label-policy.json` (`requiresProject: false`) or per-call with `--skip-project-check`. Teams with zero projects auto-pass.
- **Bounded curator runs.** HIGH actions cap at 20 per run; each `{issue, from, to}` debounced 14 days; every applied action audit-logged to JSONL.
- **Validated upload paths.** Attachments resolve through `LINEAR_UPLOAD_ROOT` with symlink resolution.
- **Isolated credentials.** API key loaded from `LINEAR_API_KEY` → `~/.config/elnora-linear/.env` (mode `0600`) → interactive prompt. Masked in errors, omitted from JSON output, redacted in logs.

Full details in [SAFETY.md](SAFETY.md).

---

## Requirements

**Always needed**

| | |
|---|---|
| **Node.js** | `>=20` |
| **Package manager** | `npm` (or `pnpm` / `yarn`) for `npm install -g @elnora-ai/linear` |
| **Linear account** | A personal API key from [linear.app/settings/api](https://linear.app/settings/api) — the CLI prompts on first run and stores it in `~/.config/elnora-linear/.env` (mode `0600`) |

**For the Claude Code plugin surface (`linear-workspace`)**

| | |
|---|---|
| **Claude Code** | Latest version, with `/plugin install linear-workspace@elnora-linear` |

**For the curator** (`elnora-linear curator-run`) — each piece is opt-in per signal source

| | |
|---|---|
| **`ANTHROPIC_API_KEY`** | Required for the LLM dispatch step. Without it the curator runs in `--collect-only` diagnostic mode. |
| **`gh` CLI**, authenticated | Required for the `github_pr` signal source |
| **`git` + a local clone** | Required for the `github_commits` signal source; the repo entry in `repos.json` must include `local_path` |
| **`SLACK_TOKEN`** | Required for the `slack_messages` signal source (reading channel history). No outbound posting yet. |
| **`LINEAR_ALLOW_EXTERNAL_COMMAND=1`** | Off by default. Set this to enable the `external_command` signal source. |

**npm dependencies** (installed automatically)

- [`@linear/sdk`](https://www.npmjs.com/package/@linear/sdk) — Linear GraphQL client
- [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) — curator LLM client
- [`commander`](https://www.npmjs.com/package/commander) — CLI parser
- [`ajv`](https://www.npmjs.com/package/ajv) + [`ajv-formats`](https://www.npmjs.com/package/ajv-formats) — JSON Schema validation for every reference file

---

## Quick start

```sh
npm install -g @elnora-ai/linear
elnora-linear issues list                       # prompts for your Linear API key on first run
```

**As a Claude Code plugin** — native slash commands + dispatched subagents:

```
/plugin marketplace add Elnora-AI/elnora-linear
/plugin install linear-workspace@elnora-linear
```

**With any other AI coding agent** (Codex CLI, Cursor, Aider, Continue, Amp, Jules, Roo) — install the CLI as above, then drop [`AGENTS.md`](AGENTS.md) at your project root; these agents read it natively:

```sh
npm install -g @elnora-ai/linear
curl -O https://raw.githubusercontent.com/Elnora-AI/elnora-linear/main/AGENTS.md
export LINEAR_API_KEY=lin_api_...
```

> **Setting this up via an AI agent?** Point it at [`INSTALL_FOR_AGENTS.md`](INSTALL_FOR_AGENTS.md) — a gated, step-by-step runbook for any agent to verify the install, collect the key, sync references, and smoke-test the stack.

Get a key at [linear.app/settings/api](https://linear.app/settings/api). On first use it's saved to `~/.config/elnora-linear/.env` (mode `0600`).

**Auto-sync on install.** If `LINEAR_API_KEY` is already set in your environment (or saved at `~/.config/elnora-linear/.env`) when you run `npm install -g`, the postinstall hook automatically populates teams / projects / users / workflows from your Linear workspace — no extra step needed. If no key is reachable, the install prints a notice telling you what to set; the install itself never fails.

To populate them later (or refresh after a workspace change):

```sh
elnora-linear sync all
```

That fetches your teams, projects, users, and workflow states from the Linear API.

Escape hatches for the auto-sync (any one disables it):
- `ELNORA_LINEAR_SKIP_POSTINSTALL=1`
- `CI=true` (auto-detected on most CI systems)
- local (non-global) installs — only `npm install -g` triggers the sync

**What the sync does and doesn't cover:**

| File | Populated by | Why |
|---|---|---|
| `teams.json`, `projects.json`, `users.json`, `workflows.json` | auto-sync | Discoverable from the Linear API |
| `label-policy.json` | you (ask your agent) | Which labels are *required* per team is a policy choice, not data |
| `slack.json` | you (ask your agent) | Needs your channel IDs + outbound allowlist |
| `repos.json` | you (ask your agent) | Needs the GitHub repos you want the curator to watch |
| `signal-sources.json` | you (ask your agent) | Curator inputs — opt-in per source |

The four manual files are only needed if you want the curator. To finish setup, just say to your agent: **"set up my curator config"** — it'll walk through each file using the populated examples in `references/*.example.json` as templates.

---

## Standalone usage

The package is fully useful without Claude Code:

```sh
elnora-linear issues create "Refactor auth" --team ENG --project "Q3 platform" --priority 2
elnora-linear issues list --team ENG --state "In Progress" --limit 50 --output json
elnora-linear bulk --team ENG --state Todo --query bug --add-comment "triage round" --yes
elnora-linear cleanup --team ENG --stale-days 30 --action comment --yes
elnora-linear curator-run --dry-run
```

Run `elnora-linear --help` to see every verb.

---

## Configuration

Workspace-specific config lives under `~/.config/elnora-linear/` (override with `LINEAR_REFERENCES_DIR=/some/path`). The npm package ships **placeholders** only; you populate the real files via `elnora-linear sync` or by hand. Populated `references/*.json` files are gitignored and excluded from the npm tarball — they never enter source control or a release.

```
~/.config/elnora-linear/
├── .env                       # LINEAR_API_KEY (mode 0600)
├── teams.json                 # ← elnora-linear sync teams
├── projects.json              # ← elnora-linear sync projects
├── users.json                 # ← elnora-linear sync users
├── workflows.json             # ← elnora-linear sync workflows
├── label-policy.json          # required labels per team (manual; see references/label-policy.example.json)
├── slack.json                 # channels + curator DM targets (manual)
├── repos.json                 # GitHub repos the curator watches (manual)
└── signal-sources.json        # curator inputs (manual; see references/signal-sources.example.json)
```

Each file has a JSON Schema in [`schemas/`](schemas/) and a populated example at `references/<name>.example.json`. The loader validates every read and refuses malformed config in strict mode. Run `elnora-linear sync verify` any time to see what's populated.

---

## Development

```sh
git clone https://github.com/Elnora-AI/elnora-linear.git
cd elnora-linear
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Project layout:

```
src/             — TypeScript source (CLI, curator, signals, config loader, agents adapters)
schemas/         — JSON Schemas for every reference file
references/      — Bundled placeholders + populated examples (gitignored: *.json)
agents/          — Claude Code agent definitions (Markdown)
commands/        — Claude Code slash-command definitions (Markdown)
skills/          — Router skill (Markdown)
AGENTS.md        — Universal dispatch guide (Codex / Cursor / Aider / Continue / Amp / Jules / Roo)
templates/       — Linear issue templates for compliance workflows (SOC 2, change mgmt, RCA, …)
__tests__/       — Vitest unit + integration tests
docs/            — User-facing docs (scheduling, etc.)
```

Linting: [Biome](https://biomejs.dev). Tests: [Vitest](https://vitest.dev). Releases: [release-please](https://github.com/googleapis/release-please).

---

## Contributing

Issues and PRs welcome. See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md). Security reports: [.github/SECURITY.md](.github/SECURITY.md) or `security@elnora.ai`.

## License

[Apache-2.0](LICENSE).
