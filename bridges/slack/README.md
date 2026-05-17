# Slack bridge for the curator

`elnora-linear curator-run` stages MEDIUM-tier questions in
`~/.config/elnora-linear/state/curator-state.json` and writes LOW-tier actions
to `curator-report.jsonl`, but does not post anything to Slack — the dispatcher
intentionally leaves chat I/O to a downstream consumer of the state file.

`bridges/slack/bridge.py` is that consumer. It:

- Posts each unposted MEDIUM question as a DM to the issue's assignee
- Posts a daily summary to a configured Slack channel
- Polls thread replies, batch-interprets them via Anthropic, and applies state
  changes back to Linear via the `elnora-linear` CLI

It's a single Python file with two dependencies (`slack-sdk`, `anthropic`).
Drop it in next to your CLI, schedule it after `curator-run`, and the curator's
MEDIUM tier starts working.

## Install

```sh
pip install slack-sdk anthropic   # Python 3.9+
```

The bridge calls the `elnora-linear` CLI by name (resolved via `PATH`), so make
sure `npm install -g @elnora-ai/linear` has already run. Override the path with
`ELNORA_LINEAR_BIN=/custom/path/elnora-linear` if needed.

## Slack app setup (one-time)

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**. Pick a name (e.g. "Linear Curator") and your workspace.
2. **OAuth & Permissions** → **Bot Token Scopes** → add:
   - `chat:write` — post messages
   - `im:write` — open DMs with users
   - `im:history` — read replies in DMs the bot is part of
   - `channels:history` — read replies in the summary channel
3. **Install to Workspace** → copy the **Bot User OAuth Token** (starts with `xoxb-`) and set it as `SLACK_BOT_TOKEN`.
4. **Invite the bot** to your `summary_channel` from inside Slack:
   `/invite @your-bot-name`. Without this, the daily summary post fails with `channel_not_found` even with the right scopes.
5. Each user the bridge will DM must allow DMs from apps in your workspace — this is on by default in most workspaces, but check Slack admin settings if DMs silently 404.

## Configure

The bridge follows the same `references/` convention as the rest of the CLI.
Adopters' populated copies live wherever `LINEAR_REFERENCES_DIR` points (the
defaults match the upstream CLI: `~/.config/elnora-linear/references/`).

### Required env vars

| Variable | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token with `chat:write`, `im:write`, `im:history`, `channels:history` scopes |
| `ANTHROPIC_API_KEY` | Reply interpretation in `resolve` mode (the bridge degrades to a keyword-only fallback if missing) |

### Optional env vars

| Variable | Default | Notes |
|---|---|---|
| `LINEAR_REFERENCES_DIR` | `~/.config/elnora-linear/references` | Where `slack.json` + `users.json` live |
| `LINEAR_CURATOR_STATE_DIR` | `~/.config/elnora-linear/state` | Where the upstream curator writes its state |
| `ELNORA_LINEAR_BIN` | `$(which elnora-linear)` | Override the CLI path |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Override the model used by the batch resolver |

### What's auto-populated vs manual

`npm install -g @elnora-ai/linear` runs `elnora-linear sync all` as a
postinstall step, which auto-populates the following reference files from the
Linear API once `LINEAR_API_KEY` is set:

| File | Auto-populated | Manual fields to add |
|---|---|---|
| `teams.json` | Yes | — |
| `projects.json` | Yes | — |
| `users.json` | `name` + `email` | `slack_user_id` for each user the bridge should DM, `key` (a short alias) |
| `workflows.json` | Yes | — |
| `slack.json` | No | All fields (channel IDs, allowlists, bridge fields) |
| `repos.json` | No | `local_path` (machine-specific) + GitHub `org`/`name` |
| `signal-sources.json` | No | Pick which sources to enable + their configs |

The Slack-specific fields all live on `slack.json` so the bridge has no
separate config file to maintain. See `references/slack.example.json` for a
populated example.

### Reference files

**`slack.json`** — already a standard upstream reference file. The bridge adds
three optional fields on top of the existing curator allowlists:

```jsonc
{
  "channels":         [/* … existing curator config … */],
  "allowed_channels": [/* … existing curator config … */],
  "allowed_dm_users": [/* … existing curator config … */],

  // ↓ optional fields for the Slack bridge
  "summary_channel":  "C0123456789",        // daily summary destination
  "workspace_slug":   "your-workspace",      // builds linear.app/{slug}/issue URLs
  "fallback_dm_user": "alice"                // DM target when an issue has no assignee
}
```

If `summary_channel` is unset, the daily summary is skipped silently. If
`workspace_slug` is unset, posts show bare issue IDs instead of clickable
links. If `fallback_dm_user` is unset, the first entry of `allowed_dm_users`
is used.

**`users.json`** — already standard. The bridge matches the Linear `assignee`
display string against `users[].name`, then routes to `slack_user_id`. Make
sure every user you want the bridge to DM has both `name` and `slack_user_id`
populated.

## Run

```sh
# Daily mode after curator-run finishes — post new questions + summary, then poll replies
python3 bridges/slack/bridge.py tick

# Or split the two phases (e.g. if you want to resolve more frequently than you post)
python3 bridges/slack/bridge.py post-pending
python3 bridges/slack/bridge.py resolve

# --dry-run logs what would happen without posting or mutating
python3 bridges/slack/bridge.py tick --dry-run --verbose
```

The bridge keeps its own side-state at
`${LINEAR_CURATOR_STATE_DIR}/slack-bridge-state.json` — it tracks which
questions have already been posted (so reruns don't duplicate DMs) and the
timestamp of the last summary post.

## Schedule

The bridge is designed to run after each `curator-run`. Typical cadence is one
tick a few minutes after the curator fires, plus one or two ticks later in the
day to pick up replies.

### macOS (launchd)

Copy `launchd.example.plist` into `~/Library/LaunchAgents/` (substitute the
`{{REPO_ROOT}}` placeholder with the absolute path you cloned the package
into) and bootstrap:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.linear-curator-bridge.plist
```

### Linux (cron)

```cron
35 9 * * 1-5  elnora-linear curator-run --output text
38 9 * * 1-5  python3 /path/to/bridges/slack/bridge.py tick
30 11 * * 1-5 python3 /path/to/bridges/slack/bridge.py tick
30 14 * * 1-5 python3 /path/to/bridges/slack/bridge.py tick
```

Use `systemd` timers if you prefer — there's nothing cron-specific in the
script.

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
