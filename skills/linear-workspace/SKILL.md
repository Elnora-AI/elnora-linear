---
name: linear-workspace
description: >
  Linear issue management — routes work to specialized agents and slash commands.
  Use when: creating, updating, searching, bulk-editing, cleaning up, syncing Linear.
  TRIGGERS: "linear", "ticket", "issue", "create issue", "update issue", "search issues",
  "my issues", "bulk", "cleanup", "sync", "log bug", "file issue", "report bug",
  "new ticket", "add task", "open ticket", "open issue", "throw this in linear",
  "track this in linear", "capture as issue", "put on the backlog".
---

# Linear Workspace

Router for Linear work. Dispatches to specialized agents or slash commands rather than running things inline.

## Dispatch table

| Intent | Action |
|---|---|
| Create one issue from a description | Agent: `linear-issue-creator` |
| Create issues from a URL / article / design | Agent: `linear-url-to-issues` |
| Review one existing issue (clarity, completeness) | Agent: `linear-issue-reviewer` |
| Edit one existing issue (state, assignee, comment, close, …) | Agent: `linear-issue-updater` |
| Search / list issues | Slash command: `/linear-search` |
| List your own issues | Slash command: `/linear-my-issues` |
| Apply the same change to many issues | Slash command: `/linear-bulk` |
| Find + handle stale issues | Slash command: `/linear-cleanup` |
| Refresh reference data from Linear | Slash command: `/linear-sync` |
| Run the curator (collect signals from external sources) | Slash command: `/linear-curator-run` |

For parallel work (e.g. 5 issues from 5 URLs), dispatch multiple agents in a single message — that's why they exist.

## First-run install

1. `/plugin marketplace add Elnora-AI/elnora-linear` then `/plugin install linear-workspace@elnora-linear`
2. Make sure the `elnora-linear` CLI is on your PATH: `npm install -g @elnora-ai/linear`
3. On your first Linear command, you'll be prompted for your Linear API key (get one at https://linear.app/settings/api). It's saved to `~/.config/elnora-linear/.env` (mode 0600).
4. Populate the reference files: `/linear-sync` (runs `elnora-linear sync all` — fetches teams, projects, users, workflows in one batch).

## Reference files

The plugin reads user-specific config from `~/.config/elnora-linear/` by default (override via `LINEAR_REFERENCES_DIR`):

- `teams.json`, `projects.json`, `users.json`, `workflows.json` — populated by `/linear-sync`
- `slack.json`, `repos.json`, `signal-sources.json`, `label-policy.json` — populated manually (schemas in [`schemas/`](../../schemas/), examples in [`references/*.example.json`](../../references/))

Run `elnora-linear sync verify` to see which are populated vs placeholder.

## Dispatch prompt — what to include

1. The user's raw request, verbatim
2. Suspected team (let the agent confirm via `elnora-linear teams list`)
3. Compliance flag (see below), if any
4. Anything the user already specified (project, priority, assignee, due date)
5. **If a URL appears anywhere in the request → dispatch to `linear-url-to-issues`**, not `linear-issue-creator`

The agent handles searching for duplicates, label requirements, state matching, and asking the user about anything unclear.

### Fast-path saves tokens

The creator agent has a fast path that skips the dupe scan, project-status check, and reference reads when the dispatch already specifies team + project + priority + assignee + a clear novel title (and no compliance keywords). When you have all five, write them out explicitly in the prompt — the agent will detect the fast path and complete in roughly one CLI call instead of three.

### Compliance flag

If the request mentions any of: **incident, breach, vulnerability, CVE, pentest, penetration test, onboarding, offboarding, access provision/revoke, audit, SOC 2, change request, risk assessment, vendor review, backup test, RCA, lessons learned, DPA, DSR / data subject request** — say so in the dispatch prompt. The agent will load `references/template-index.md` and apply the matching template (`SEC-*`, `CHG-*`, `ACC-*`, `AUD-*`, `RSK-*`, `OPS-*`, `SLA-*`, `RCA-*`, `LRN-*`).

### Model tiering — pass `model:` on the Agent dispatch

Match the model to task complexity. The agent frontmatter sets the default; override per-dispatch when the task is clearly easier or harder. Haiku < Sonnet < Opus on cost AND token usage — Opus uses **more** tokens than Sonnet for the same task, not fewer. It's a quality escalation, never a token-saving move.

| Task | Agent | Model | Why |
|---|---|---|---|
| Fast-path create (all fields explicit, no compliance) | `linear-issue-creator` | `haiku` | Mechanical CRUD, single CLI call |
| Full-path create (ambiguous routing, dupe scan, compliance template) | `linear-issue-creator` | `sonnet` | Branching + judgment |
| Single-field update (state, assignee, priority, label add) | `linear-issue-updater` | `haiku` | One CLI call, fixed flag |
| Cross-team move, full description rewrite | `linear-issue-updater` | `sonnet` | Validates required labels across teams |
| URL → issues extraction | `linear-url-to-issues` | `sonnet` | Real synthesis from unstructured content |
| Issue completeness review | `linear-issue-reviewer` | `sonnet` | Reads description + comments + acceptance criteria |
| Headless curator pass (scheduled) | `linear-state-curator` | `haiku` | Mechanical signal collection + tier dispatch |
| Interactive curator dry-run / triage | `linear-state-curator` | `sonnet` | Reading curator-report.jsonl + judgment calls on MEDIUM queue |

Don't reach for Opus by default. Sonnet handles every Linear task cleanly. Only escalate to Opus if Sonnet has *actually failed* on this task type (looped, produced wrong output, gave up). If the request mentions a compliance keyword, upgrade the creator to Sonnet automatically.

### Dispatch prompt budget

When the user request is fully specified, keep the dispatch prompt short — the agent already knows the playbook. Pass through:

- The user's raw request, verbatim
- Team / project / priority / assignee if explicit
- Compliance flag if relevant

Don't re-format the description, don't restate the playbook, don't tell the agent how to structure its output. A 100-token dispatch prompt is fine; a 500-token one wastes tokens with no quality gain.

## Cold-start primitive

For workflows that need team metadata up front (e.g. extracting N issues from a URL into one team), the parent should suggest the agent call `elnora-linear context --team "<Team>"` ONCE before iterating. The response contains projects with statuses, workflow states, the full label catalog grouped by prefix, the required-label policy, and active members — replacing four separate calls (`teams get` + `projects list --team` + `states list --team` + `labels list --team`) and eliminating every reference-file read.

The CLI is the source of truth for label policy: `elnora-linear projects get` and `elnora-linear teams get` both return `requiredLabels` and `validStates` directly. `elnora-linear issues create` rejects invalid label combinations with a structured error (`missing`, `availableForPrefix`, `suggestedRetry`) so the agent can self-correct in one retry without reading any reference file.

## Safety guardrails

- `bulk` and `cleanup` default to **dry-run** — they print what would change and require `--yes` to commit
- `bulk` requires at least one of `--set-state` or `--add-comment` — refuses no-op invocations
- `cleanup` defaults to `comment` action (least destructive); `close` / `cancel` are explicit opt-ins
- `external_command` signal sources run user-configured commands with the user's privileges — only configure commands from sources you trust
- Permanent deletes need an explicit `--yes` at the CLI layer — a prompt-injected agent cannot bypass it
- Full guarantees and gated commands documented in [SAFETY.md](../../SAFETY.md)

## Don't

- Don't read reference `.md` files for label requirements — required-label policy is enforced server-side by the CLI
- Don't run the create/update workflow inline. The agent owns it.
- Don't pick a team without confirming via `elnora-linear teams list` or `references/teams.json`
