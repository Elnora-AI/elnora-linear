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

## First-run install

1. Install the plugin: `/plugin marketplace add Elnora-AI/elnora-linear` then `/plugin install linear-workspace@elnora-linear`
2. Make sure the `elnora-linear` CLI is on your PATH: `npm install -g @elnora-ai/linear`
3. On your first Linear command, you'll be prompted for your Linear API key (get one at https://linear.app/settings/api). It's saved to `~/.config/elnora-linear/.env` (mode 0600).
4. Populate the reference files: `/linear-sync` (runs `elnora-linear sync all` — fetches teams, projects, users, workflows in one batch).

## Reference files

The plugin reads user-specific config from `~/.config/elnora-linear/` by default (override via `LINEAR_REFERENCES_DIR`):

- `teams.json`, `projects.json`, `users.json`, `workflows.json` — populated by `/linear-sync`
- `slack.json`, `repos.json`, `signal-sources.json` — populated manually in v0; interactive prompts coming in a future release

Run `elnora-linear sync verify` to see which are populated vs placeholder.

## Safety guardrails

- `bulk` and `cleanup` default to **dry-run**; they print what would change and require explicit `--yes` to commit
- `bulk` requires at least one of `--set-state` or `--add-comment` — refuses no-op invocations
- `cleanup` defaults to `comment` action (least destructive); `close` / `cancel` are explicit opt-ins
- `external_command` signal sources run user-configured commands with the user's privileges — only configure commands from sources the user trusts
