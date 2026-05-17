# Slack bridge for the curator

`elnora-linear curator-run` stages MEDIUM-tier questions in
`~/.config/elnora-linear/state/curator-state.json` and writes LOW-tier actions
to `curator-report.jsonl`, but does not post anything to Slack — the dispatcher
intentionally leaves chat I/O to a downstream consumer of the state file.

`bridges/slack/bridge.py` is that consumer. It:

- Posts each unposted MEDIUM question as a DM to the issue's assignee
- Polls thread replies, batch-interprets them via Anthropic, and applies state
  changes back to Linear via the `elnora-linear` CLI
- Asks a one-line clarifying question in-thread when the user's reply was
  ambiguous

The bridge is intentionally silent the rest of the time — no daily summary,
no per-action confirmation DMs, no timeout pings. Work that can be done
automatically already auto-applies upstream (HIGH tier), and resulting state
changes are visible directly in Linear.

It's a single Python file with two dependencies (`slack-sdk`, `anthropic`).
The npm tarball bundles it at `bridges/slack/bridge.py` and exposes a wrapper
subcommand — `elnora-linear curator-slack-bridge tick` — so most users never
need to know the file path.

## Install

```sh
npm install -g @elnora-ai/linear         # bundles bridges/slack/ for you
pip install slack-sdk anthropic          # Python 3.9+
```

The bridge calls the `elnora-linear` CLI by name (resolved via `PATH`), so the
global npm install handles both the CLI and the bridge in one step. Override
the CLI path with `ELNORA_LINEAR_BIN=/custom/path/elnora-linear` if needed.

If your system Python is PEP 668 managed (Debian/Ubuntu, recent macOS), use a
virtualenv or `pipx` and point the wrapper at it with `PYTHON_BIN=/path/to/python`.

## Slack app setup (one-time)

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**. Pick a name (e.g. "Linear Curator") and your workspace.
2. **OAuth & Permissions** → **Bot Token Scopes** → add:
   - `chat:write` — post messages
   - `im:write` — open DMs with users
   - `im:history` — read replies in DMs the bot is part of
3. **Install to Workspace** → copy the **Bot User OAuth Token** (starts with `xoxb-`) and set it as `SLACK_BOT_TOKEN`.
4. Each user the bridge will DM must allow DMs from apps in your workspace — this is on by default in most workspaces, but check Slack admin settings if DMs silently 404.

## Configure

The bridge reads the same reference files the CLI writes. Adopters' populated
copies live wherever `LINEAR_REFERENCES_DIR` points; the default matches the
CLI: `~/.config/elnora-linear/` (no `references/` subdir — the CLI's `sync`
writes directly to that directory).

### Required env vars

| Variable | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token with `chat:write`, `im:write`, `im:history` scopes. Same token you can also use as `SLACK_TOKEN` for the curator's `slack_messages` signal source — just set both env vars to the same value. |
| `ANTHROPIC_API_KEY` | Reply interpretation in `resolve` mode (the bridge degrades to a keyword-only fallback if missing) |

### Optional env vars

| Variable | Default | Notes |
|---|---|---|
| `LINEAR_REFERENCES_DIR` | `~/.config/elnora-linear` | Where `slack.json` + `users.json` live (matches CLI default) |
| `LINEAR_CURATOR_STATE_DIR` | `~/.config/elnora-linear/state` | Where the upstream curator writes its state |
| `ELNORA_LINEAR_BIN` | `$(which elnora-linear)` | Override the CLI path |
| `PYTHON_BIN` | `python3` | Override the Python interpreter (set this to your venv's `bin/python` if you installed deps in a virtualenv) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Override the model used by the batch resolver |

### What's auto-populated vs manual

`npm install -g @elnora-ai/linear` runs `elnora-linear sync all` as a
postinstall step, which auto-populates the following reference files from the
Linear API once `LINEAR_API_KEY` is set:

| File | Auto-populated | Manual fields to add |
|---|---|---|
| `teams.json` | Yes | — |
| `projects.json` | Yes | — |
| `users.json` | `name`, `email`, `linear_user_id`, `key` (auto-derived) | `slack_user_id` for each user the bridge should DM. Optionally override the auto-derived `key` if it collides with another user or doesn't match the alias you want in `allowed_dm_users`. |
| `workflows.json` | Yes (`states`); curator `rules` preserved across syncs | — |
| `slack.json` | No | All fields (channel IDs, allowlists, bridge fields) |
| `repos.json` | No | `local_path` (machine-specific) + GitHub `org`/`name` |
| `signal-sources.json` | No | Pick which sources to enable + their configs |

`sync users` preserves `slack_user_id` and any user-overridden `key` across
future re-syncs (keyed off `linear_user_id`), so your manual edits survive
postinstall re-runs and `elnora-linear sync all` invocations. The Slack-
specific config fields all live on `slack.json` so the bridge has no separate
config file to maintain. See `references/slack.example.json` for a populated
example.

### Reference files

**`slack.json`** — already a standard upstream reference file. The bridge adds
two optional fields on top of the existing curator allowlists:

```jsonc
{
  "channels":         [/* … existing curator config … */],
  "allowed_channels": [/* … existing curator config … */],
  "allowed_dm_users": [/* … existing curator config … */],

  // ↓ optional fields for the Slack bridge
  "workspace_slug":   "your-workspace",      // builds linear.app/{slug}/issue URLs
  "fallback_dm_user": "alice"                // DM target when an issue has no assignee
}
```

If `workspace_slug` is unset, DMs show bare issue IDs instead of clickable
links. If `fallback_dm_user` is unset, the first entry of `allowed_dm_users`
is used.

**`users.json`** — already standard. The bridge matches the Linear `assignee`
display string against `users[].name`, then routes to `slack_user_id`. Make
sure every user you want the bridge to DM has both `name` and `slack_user_id`
populated.

## Run

The npm-installed wrapper is the recommended invocation — it resolves the
bundled `bridge.py` path for you:

```sh
# Recommended: post new MEDIUM questions and then poll for replies in one pass.
elnora-linear curator-slack-bridge tick

# Or split the two phases (e.g. if you want to resolve more frequently than you post)
elnora-linear curator-slack-bridge post-pending
elnora-linear curator-slack-bridge resolve

# --dry-run logs what would happen without posting or mutating
elnora-linear curator-slack-bridge tick --dry-run --verbose
```

You can still invoke the Python file directly if you cloned the repo or need
fine control — `python3 bridges/slack/bridge.py tick` works identically.

The bridge keeps its own side-state at
`${LINEAR_CURATOR_STATE_DIR}/slack-bridge-state.json` — it tracks which
questions have already been posted so reruns don't duplicate DMs.

## Schedule

The bridge runs after each `curator-run`. Templates for launchd, systemd, and
cron live in [`docs/scheduling.md`](../../docs/scheduling.md) under the **Slack
bridge** heading — that doc is the canonical scheduling reference for both the
curator and the bridge. The shipped `launchd.example.plist` in this directory
is a ready-to-edit starting point referenced from there.

## Coexistence with a general chat bot

The bridge posts every message with a `*[Linear Curator]*` prefix. If your
Slack workspace runs another bot under the same bot identity (e.g. a generic
LLM agent that replies to DMs), update that bot to skip threads whose parent
text starts with that marker — otherwise it will see the user's reply to the
bridge's DM and try to handle it itself.

## Safety model

- Outbound channels are gated by `slack.json.allowed_channels`. Posts to
  unlisted channels are silently dropped.
- Outbound DMs are gated by `slack.json.allowed_dm_users`. DMs to non-
  allowlisted users are blocked with a clear error.
- The bridge takes an exclusive file lock on the upstream curator state file
  before writing — the upstream curator uses the same lock convention, so the
  two never race.
- `--dry-run` is exhaustive: no Slack posts, no Linear mutations, no state
  file writes.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Unhandled exception |
| 2 | Missing required config (e.g. `SLACK_BOT_TOKEN`) |
| 4 | Upstream state lock held by another process |
| 130 | Interrupted (SIGINT) |
