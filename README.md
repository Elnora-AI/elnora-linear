# elnora-linear

A Linear workspace toolkit: a fast CLI, a Claude Code plugin (slash commands + agents + skill router), and a config-driven curator that validates Linear issues against external signals.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@elnora-ai/linear)](https://www.npmjs.com/package/@elnora-ai/linear)
[![CI](https://github.com/Elnora-AI/elnora-linear/actions/workflows/ci.yml/badge.svg)](https://github.com/Elnora-AI/elnora-linear/actions)

---

## What this is

One npm package, two surfaces:

- **CLI** — `elnora-linear`, complete coverage of the Linear GraphQL API (issues, projects, teams, labels, cycles, initiatives, milestones, attachments, status updates, agent sessions, webhooks, customers, customer needs, …). Bulk mutations, parallel reads, structured errors the agent layer can self-correct from.
- **Claude Code plugin** — `linear-workspace`. Six slash commands, five specialized agents, a router skill. Drop-in: `/plugin install linear-workspace@elnora-linear`.

Plus a curator (`elnora-linear curator-run`) that polls GitHub commits, GitHub PRs, Slack messages, sibling Linear issues, MCP tools, and arbitrary shell commands — then asks an LLM to propose state changes, with HIGH-tier actions auto-applied (capped, debounced, audit-logged) and MEDIUM-tier actions queued for human confirmation.

## Quick start

```sh
npm install -g @elnora-ai/linear
elnora-linear issues list                       # prompts for your Linear API key on first run
```

Or as a Claude Code plugin:

```
/plugin marketplace add Elnora-AI/elnora-linear
/plugin install linear-workspace@elnora-linear
```

On your first Linear command, you'll be prompted for your Linear API key once (get one at [linear.app/settings/api](https://linear.app/settings/api)). It's saved to `~/.config/elnora-linear/.env` (mode 0600). Then populate workspace metadata:

```sh
elnora-linear sync all
```

That fetches your teams, projects, users, and workflow states from the Linear API in one batch.

## What you get

**Slash commands** (Claude Code)

| Command | Does |
|---|---|
| `/linear-search` | Natural-language search across all issues |
| `/linear-my-issues` | Your assigned issues, grouped by state |
| `/linear-bulk` | Apply the same state change or comment to many issues — dry-run by default |
| `/linear-cleanup` | Six-check audit (missing labels, stale, duplicates, wrong state, orphaned, unactionable) with per-category confirmation |
| `/linear-sync` | Refresh teams/projects/users/workflows from the Linear API |
| `/linear-curator-run` | Run the curator manually |

**Agents** (Claude Code)

| Agent | For |
|---|---|
| `linear-issue-creator` | One issue from a description. Fast-path for fully-specified requests |
| `linear-url-to-issues` | N issues extracted from an article, design, blog, or doc URL |
| `linear-issue-updater` | Any modification: state, team, assignee, labels, comment, relations, close |
| `linear-issue-reviewer` | Validates an issue's done-criteria against its linked PR diff |
| `linear-state-curator` | Daily Linear hygiene — runs the curator headlessly |

**CLI** — every slash-command path is scriptable: `elnora-linear --help`.

## Configuration

Workspace-specific config lives under `~/.config/elnora-linear/` (override with `LINEAR_REFERENCES_DIR=/some/path`). The npm package ships **placeholders** only; you populate the real files via `elnora-linear sync` or by hand. Populated `references/*.json` files are gitignored at the repo level and excluded from the npm tarball — they never enter source control or a release.

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

Each file has a JSON Schema in [`schemas/`](schemas/) and a populated example at `references/<name>.example.json`. The loader validates every read against the schema and refuses malformed config in strict mode.

Run `elnora-linear sync verify` any time to see which files are populated vs placeholder.

## The curator

`elnora-linear curator-run` walks your configured signal sources, builds a snapshot of open issues, calls an LLM (Anthropic) with the workspace's curator rules, and dispatches per tier:

- **HIGH** — state change applied immediately with a rationale comment. Capped at 20 mutations/run, debounced 14 days per `{issue_id, from, to}`.
- **MEDIUM** — proposed action queued in `~/.config/elnora-linear/state/curator-state.json` for a human (or the Slack bot) to confirm.
- **LOW** — added to the run report, no side effects.

Every applied action is appended to `~/.config/elnora-linear/state/curator-report.jsonl`. Without `ANTHROPIC_API_KEY` (or with `--collect-only`), the curator runs in diagnostic mode and only reports collected signals.

Recurring schedule: see [`docs/scheduling.md`](docs/scheduling.md) for launchd, systemd, and Task Scheduler templates.

## Safety

The CLI is built so a prompt-injected agent can't do anything irreversible without a human-typed `--yes`. Soft-delete by default, gated permanent deletes, validated attachment-upload paths, redacted API keys, capped curator mutations. Full guarantees in [SAFETY.md](SAFETY.md).

## Standalone usage

The package is useful without Claude Code:

```sh
elnora-linear issues create --team ENG --title "Refactor auth" --priority High
elnora-linear issues list --team ENG --state "In Progress" --limit 50 --output json
elnora-linear bulk --team ENG --state Todo --query bug --add-comment "triage round" --yes
elnora-linear curator-run --dry-run
```

`--output json` makes every read pipe cleanly into `jq` / scripts.

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
templates/       — Linear issue templates for compliance workflows (SOC 2, change mgmt, RCA, …)
__tests__/       — Vitest unit + integration tests
docs/            — User-facing docs (scheduling, etc.)
```

Linting: [Biome](https://biomejs.dev). Tests: [Vitest](https://vitest.dev). Releases: [release-please](https://github.com/googleapis/release-please).

## Contributing

Issues and PRs welcome. See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md). Security reports: [.github/SECURITY.md](.github/SECURITY.md) or `security@elnora.ai`.

## License

[Apache-2.0](LICENSE).
