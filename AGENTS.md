# AGENTS.md

Universal guide for any coding agent working with `elnora-linear`. Read natively by Codex, Cursor, Aider, Continue, Amp, Jules, and Roo. Claude Code reads `CLAUDE.md` instead — see [the Claude Code section](#claude-code) below.

## What this is

`@elnora-ai/linear` — one npm package exposing the `elnora-linear` CLI (full Linear GraphQL coverage) and a config-driven curator. Any agent shells out to the CLI; the JSON output is designed for self-correction from structured errors.

## Setup

```sh
npm install -g @elnora-ai/linear
export LINEAR_API_KEY=lin_api_...            # from https://linear.app/settings/api
elnora-linear sync all                        # fetch teams, projects, users, workflows
elnora-linear sync verify --output json       # confirm what's populated
```

Config lives at `~/.config/elnora-linear/` (override with `LINEAR_REFERENCES_DIR`). The key persists to `.env` mode 0600 after first interactive use.

For a guided multi-step install (verify → key → sync → smoke-test), point your agent at [`INSTALL_FOR_AGENTS.md`](INSTALL_FOR_AGENTS.md).

## Dispatch — when to use what

| User intent | Command |
|---|---|
| Create one issue | `elnora-linear issues create "Title" --team X --project P --description "md" [--labels L1,L2] [--priority 0-4] [--assignee me] [--state Todo]` — `--project` is required by default (see Pitfalls) |
| Update an issue | `elnora-linear issues update ENG-123 [--state ...] [--assignee ...] [--add-comment "..."]` |
| Search / list | `elnora-linear issues search "terms" --output json` |
| My assigned | `elnora-linear my-issues --output json` |
| Same change to many | `elnora-linear bulk --team X [filters] --set-state Y` — dry-run by default; `--yes` to apply |
| Audit stale / wrong-state | `elnora-linear cleanup --team X` |
| Curator (signals → proposals) | `elnora-linear curator-run [--collect-only] [--dry-run]` |
| Refresh refs | `elnora-linear sync all` |
| What's populated | `elnora-linear sync verify --output json` |
| Anything else | `elnora-linear --help` — full GraphQL coverage (comments, views, customers, states, projects, labels, cycles, initiatives, milestones, attachments, status updates, agent sessions, webhooks, …) |

`--output json` on any read pipes into `jq`. Mutations that change many issues or delete data require `--yes`.

## Pitfalls

- Title is positional: `elnora-linear issues create "Title" --team X`, not `--title "Title"`.
- Flags: `--assignee` (not `--assign`), `--labels` (not `--label`), `--description` (not `--desc`).
- `--labels` **replaces** — fetch current labels first if adding one.
- `issues create` requires `--project` by default. If you omit it and the team has at least one project, the call exits 2 with `{availableProjects, suggestedRetry}` JSON — pick a project from `availableProjects` and re-run. Teams with zero projects pass through. To bypass (placeholder issues), pass `--skip-project-check`. Same rule applies to `issues batch-create` and `issues bulk-ops` (create ops) — both honor `--skip-project-check`.
- `issues create` also validates against the team's label-policy. On failure it exits 2 with `{missing, availableForPrefix, suggestedRetry}` JSON — re-run `suggestedRetry` verbatim.
- Priority: `0=None, 1=Urgent, 2=High, 3=Normal, 4=Low`.

## Safety

Soft-delete by default. Destructive ops (`bulk` apply, permanent delete) require `--yes` typed by a human. Curator HIGH-tier auto-applies capped at 20/run, debounced 14 days per `{issue, from, to}`. Full guarantees: [SAFETY.md](SAFETY.md).

## Claude Code

The Claude Code plugin (`linear-workspace`) provides native slash commands and dispatched subagents — richer than CLI shelling because Claude has primitives other harnesses lack (Skill router, parallel subagents, `argument-hint`).

Run these as **two separate slash commands** (paste the first, hit enter, wait for it to finish, then paste the second):

```
/plugin marketplace add Elnora-AI/elnora-linear
```

```
/plugin install linear-workspace@elnora-linear
```

Surfaces: `/linear-{search,my-issues,bulk,cleanup,sync,curator-run}` plus subagents `linear-issue-{creator,updater,reviewer}`, `linear-url-to-issues`, `linear-state-curator`. Definitions in [`commands/`](commands/), [`agents/`](agents/), [`skills/linear-workspace/`](skills/linear-workspace/).

To make Claude Code also load this file, symlink or stub: `ln -s AGENTS.md CLAUDE.md`.

## Per-harness install

- **Codex CLI** — `AGENTS.md` is auto-loaded at repo root; also reads `~/.codex/AGENTS.md` for global. Add custom prompts in `~/.codex/prompts/*.md` mirroring the dispatch table if you want slash-style entry points.
- **Cursor** — reads `AGENTS.md` at repo root natively. Pin frequently-used CLI verbs as `.cursor/rules/*.mdc` "always-on" rules if desired.
- **Aider** — `aider --read AGENTS.md` per session, or set `read: AGENTS.md` in `.aider.conf.yml`.
- **Continue / Amp / Jules / Roo** — read `AGENTS.md` at repo root automatically.

## Contributing to this repo

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm build
```

| Path | Purpose |
|---|---|
| `src/cli.ts`, `src/commands/` | CLI entry + verb groups (commands/views/customers/states/projects/…) |
| `src/curator/`, `src/signals/` | Curator engine + signal collectors |
| `src/config/`, `schemas/` | Reference-file loader + JSON Schemas |
| `references/*.example.json` | Populated examples (bundled placeholders ship as `.placeholder`) |
| `agents/`, `commands/`, `skills/` | Claude Code plugin surfaces |
| `templates/` | Linear issue templates (SOC 2, change mgmt, RCA) |
| `__tests__/` | Vitest |

When adding a CLI verb: implement in `src/commands/<group>.ts`, add a Vitest, update the dispatch table above, and add a matching `commands/<name>.md` if it should be slash-accessible in Claude Code.
