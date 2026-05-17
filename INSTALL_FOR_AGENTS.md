# INSTALL_FOR_AGENTS.md — `elnora-linear` setup

> **Step 0 — Identity gate.** If you are NOT an autonomous coding agent (Claude
> Code, Codex CLI, Cursor, Aider, Continue, Amp, Jules, Roo, Windsurf, etc.),
> stop reading this file and open `README.md` instead. This file walks an agent
> through a multi-step setup that includes reading an API key from the user,
> writing config to `~/.config/elnora-linear/`, and making live calls against
> the Linear GraphQL API. Humans should follow the README's Quick Start.

You are the agent handing off after the user installed `elnora-linear`
(`npm install -g @elnora-ai/linear`, optionally also the Claude Code plugin
via `/plugin install linear-workspace@elnora-linear`). Your job is to verify
the install, collect the user's Linear API key, populate workspace references,
optionally configure the curator, run a smoke test, and hand them a working
environment.

Be transparent: announce each step before you run it, show the output, and
explain what you found. The user may not know what a `references/` directory
is or what the curator does — keep your language plain and ask one question at
a time.

**Universal:** every step here uses the `elnora-linear` CLI, which works
identically under any agent harness. The only Claude-Code-specific note is
the optional plugin check in Step 1.

## Step 1 — Verify the install

Run, in this order:

```sh
elnora-linear --version
elnora-linear --help
```

Gates:
- `--version` exits 0 and prints a semver string (e.g. `1.0.1`). Anything else
  means the npm install didn't land on `PATH`. Surface the actual error; don't
  try to reinstall on the user's behalf without their consent.
- `--help` lists the top-level commands (`search`, `my-issues`, `bulk`,
  `cleanup`, `sync`, `curator-run`, …). If the binary runs but the command
  list is empty or truncated, the build is broken — surface it.

**Claude Code only — optional.** If the user also installed the
`linear-workspace` plugin, confirm it loaded:

```sh
ls .claude/plugins 2>/dev/null || ls ~/.claude/plugins 2>/dev/null
```

You should see `linear-workspace` somewhere. If not, the `/plugin install`
didn't complete — ask the user to rerun it. Skip this check entirely under
Codex / Cursor / Aider / Continue / Amp / Jules / Roo — those harnesses use
the CLI directly via [`AGENTS.md`](AGENTS.md), no plugin install required.

## Step 2 — Collect the Linear API key

The CLI reads the key from (in order): `LINEAR_API_KEY` env var, then
`~/.config/elnora-linear/.env`, then an interactive prompt if stdin is a TTY.
The interactive-prompt path is the only one that auto-persists — since you're
about to set the env var yourself, you must also write the `.env` file so the
key survives the next shell.

Tell the user, verbatim:

> I need a Linear personal API key. Open
> https://linear.app/settings/api in your browser, click **Create key**, give
> it a name like "elnora-linear", copy the value, and paste it here. The key
> starts with `lin_api_`.

When the user pastes the key, set it in the environment AND write it to the
config file. Use a strict `umask` so the file is created at mode `0600`:

```sh
export LINEAR_API_KEY="<paste>"
mkdir -p ~/.config/elnora-linear
umask 077
printf 'LINEAR_API_KEY=%s\n' "$LINEAR_API_KEY" > ~/.config/elnora-linear/.env
chmod 600 ~/.config/elnora-linear/.env
```

Then verify the key works against the live API:

```sh
elnora-linear teams list --limit 5
```

Gates:
- Exit 0 and at least one team row in the output. That confirms the key is
  valid and the API is reachable.
- `stat -f '%Sp' ~/.config/elnora-linear/.env` (macOS) or
  `stat -c '%a' ~/.config/elnora-linear/.env` (Linux) must show `600` /
  `-rw-------`. If it's any wider, fix it with `chmod 600` before continuing —
  this file holds a workspace-scoped API key.
- If you get `401 Unauthorized`, the key is wrong — ask the user to regenerate
  it. Do NOT retry with a key you guessed or pieced together.
- If you get `403 Forbidden` on a specific team, the key works but is scoped
  to a subset of workspaces — note this and continue, but flag it in your
  Step 6 summary so the user knows the curator can't see those teams.

## Step 3 — Sync workspace references

**First, check whether the postinstall hook already did this.** When the npm
package is installed `-g` with `LINEAR_API_KEY` already set in the environment
(or already saved at `~/.config/elnora-linear/.env`), the postinstall script
runs `sync all` automatically. Run `sync verify` first; if `teams`, `projects`,
`users`, and `workflows` already report `populated`, skip ahead to Step 4.

Otherwise, populate the four auto-discoverable reference files (teams,
projects, users, workflows) in one batch:

```sh
elnora-linear sync all
```

Then verify:

```sh
elnora-linear sync verify --output json
```

Gates:
- `sync verify` exit 0.
- In the JSON output, `teams`, `projects`, `users`, and `workflows` each
  report `status: "populated"` (not `"placeholder"`). If any one of those four
  is still `"placeholder"` after `sync all`, the corresponding API call failed
  silently — rerun the individual `elnora-linear sync <name>` and surface
  the error.
- The remaining files (`label-policy`, `slack`, `repos`, `signal-sources`)
  WILL report `"placeholder"` at this point. That's expected — none are
  auto-discoverable from the Linear API. `slack`/`repos`/`signal-sources`
  populate in Step 4 (curator opt-in). For `label-policy`, proactively offer:
  "Want me to set up required-label rules per team? I'll list your current
  team labels and you can pick which ones should be mandatory." Then write
  `~/.config/elnora-linear/label-policy.json` using
  `references/label-policy.example.json` as the shape reference.

## Step 4 — Curator opt-in

Ask the user, verbatim:

> Do you want to set up the curator? It polls GitHub commits, GitHub PRs,
> Slack messages, and other signals on a schedule, asks an LLM to propose
> Linear state changes based on what it sees, auto-applies the safe ones
> (capped at 20 per run, debounced 14 days), and queues the rest for you to
> confirm. You can skip it now and add it later by editing the files in
> `~/.config/elnora-linear/` and running `elnora-linear curator-run`.

If the user says **no**, skip to Step 5.

If the user says **yes**, first collect the LLM key (4-pre), then walk the
four config files in order (4a–4d). For each file: copy the example, ask the
user the minimum questions to populate it, write the result, and validate
with `sync verify`. Do not write all four in one shot — confirm each before
moving on.

### 4-pre. `ANTHROPIC_API_KEY` — the LLM that proposes Linear actions

The curator collects signals, hands them to Claude to propose state changes,
and dispatches the safe ones. Without `ANTHROPIC_API_KEY` the curator silently
drops into `--collect-only` diagnostic mode (no LLM call, no mutations) — the
user will wonder for days why HIGH-tier actions aren't applying. Collect it
now, before walking the file-config steps.

Tell the user, verbatim:

> The curator uses Claude to read your signals and propose Linear changes.
> I need an Anthropic API key. Open https://console.anthropic.com/settings/keys
> in your browser, click **Create Key**, copy the value, and paste it here.
> The key starts with `sk-ant-`.

When the user pastes it, set the env var AND append it to the same `.env`
file the Linear key lives in (the CLI auto-loads that file on startup, so the
key survives the next shell):

```sh
export ANTHROPIC_API_KEY="<paste>"
umask 077
printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" >> ~/.config/elnora-linear/.env
chmod 600 ~/.config/elnora-linear/.env
```

Gates:
- The value must start with `sk-ant-`. If it doesn't, ask the user to paste
  again — they may have grabbed the wrong field.
- `stat` on `~/.config/elnora-linear/.env` must still report mode `600` after
  the append. Re-`chmod 600` if not.
- If the user refuses (e.g. "I'll add this later"), note loudly that the
  curator will run in `--collect-only` mode until they set the key, and that
  HIGH-tier actions will NOT auto-apply. Then continue.

### 4a. `label-policy.json` — required labels per team

```sh
cp ~/.config/elnora-linear/label-policy.json{,.bak} 2>/dev/null
cp "$(npm root -g)/@elnora-ai/linear/references/label-policy.example.json" \
   ~/.config/elnora-linear/label-policy.json
```

The example shows two teams (`ENG`, `OPS`) with `Type:` and `Layer:` prefix
requirements. Ask the user:

> Which of your teams need required-label rules? For each one, what label
> prefixes do you want to require? (Skip this if you don't enforce label
> conventions — I'll leave the example in place but disabled.)

If the user has no opinion, replace the example's `policies` object with
`{}` (empty) and continue. Don't invent policies for teams the user hasn't
mentioned.

### 4b. `slack.json` — channels for the `slack_messages` signal

Two Slack features live under one app + one bot token: this step (the
**reader**, which lets the curator see channel messages) and Step 4e
below (the **bridge**, which DMs assignees with MEDIUM-tier questions).
Ask BOTH questions now, before any Slack work, so you can collect every
required scope in one app-install pass:

> Slack ties into the curator two ways. (1) **Reader**: the curator can
> watch specific channels and feed those messages into its signal mix.
> (2) **Bridge**: when the curator has a MEDIUM-tier question (e.g.
> "this issue looks done — close it?"), the bridge DMs the issue's
> assignee and applies their reply. Both use one Slack app and one bot
> token. Do you want the reader, the bridge, both, or neither?

Record the answer (`reader-only`, `bridge-only`, `both`, or `neither`)
and reuse it in Step 4e — do not ask again there.

- **Neither** — skip the rest of this step AND Step 4e. Move to 4c.
- **Reader-only** — walk all 8 substeps below.
- **Bridge-only** — walk substeps 1–4 only (create app, add bridge
  scopes from the matrix, install, verify token). Then skip to Step 4e
  — substeps 5–8 are channel/reader-specific, and Step 4e persists the
  token under the bridge's `SLACK_BOT_TOKEN` env var.
- **Both** — walk all 8 substeps below. The token gets persisted as
  `SLACK_TOKEN` here (reader); Step 4e adds a second line for
  `SLACK_BOT_TOKEN` (bridge) pointing at the same `xoxb-…` value.

Walk substeps in order — confirm each before moving on:

1. **Create the app.** Tell the user to open
   https://api.slack.com/apps → **Create New App** → **From scratch**,
   name it `elnora-linear` (or anything they prefer), and pick their
   workspace. Wait for them to confirm.

2. **Add scopes.** Sidebar → **OAuth & Permissions** → scroll to
   **Bot Token Scopes** → add the scopes from the matrix below based on
   the decision you recorded above. Adding extra scopes later forces a
   Slack app reinstall, so add everything you'll need now.

   | Decision | Reader scopes | Bridge scopes |
   |---|---|---|
   | `reader-only` | `channels:history` (public), `groups:history` (private — only if needed) | — |
   | `bridge-only` | — | `chat:write`, `im:write`, `im:history` |
   | `both` | `channels:history`, `groups:history` (if needed) | `chat:write`, `im:write`, `im:history` |

3. **Install the app.** Same page, scroll up → **Install to Workspace**
   → approve. The page now shows a **Bot User OAuth Token** starting
   with `xoxb-`.

4. **Collect and verify the token.** Ask the user to paste it. Then:

   ```sh
   export SLACK_TOKEN="<paste>"
   curl -sS -H "Authorization: Bearer $SLACK_TOKEN" \
     https://slack.com/api/auth.test
   ```

   Gate: response JSON contains `"ok": true` and shows the user's
   workspace + bot user. If `"ok": false`, surface the `error` field
   (commonly `invalid_auth` — wrong token, ask for it again; or
   `missing_scope` — they didn't add the scopes from step 2).

5. **Invite the bot to channels.** Ask the user which channels the
   curator should watch. For each, they need to run `/invite @<app-name>`
   inside that Slack channel. The bot can only read history for
   channels it's a member of. Wait for confirmation before continuing.

6. **Collect channel IDs.** Ask the user, for each invited channel, to
   click the channel name at the top in Slack, scroll the details panel
   to the bottom, and copy the ID (format `C0123ABCDEF` — not the
   `#name`). Collect one ID per channel.

7. **Persist the token** to the env file alongside `LINEAR_API_KEY` and
   `ANTHROPIC_API_KEY` (the CLI auto-loads this file at startup, so the
   token survives the next shell):

   ```sh
   printf 'SLACK_TOKEN=%s\n' "$SLACK_TOKEN" >> ~/.config/elnora-linear/.env
   chmod 600 ~/.config/elnora-linear/.env
   ```

   Re-verify the mode is still `600`.

8. **Write `slack.json`.** Copy the example and replace its `channels`
   array with the user's real IDs/names. `allowed_channels` should
   default to the same list — the curator uses it as the watch set when
   a signal source doesn't specify channels explicitly.

   ```sh
   cp "$(npm root -g)/@elnora-ai/linear/references/slack.example.json" \
      ~/.config/elnora-linear/slack.json
   ```

   Then edit `~/.config/elnora-linear/slack.json` to look like:

   ```json
   {
     "channels": [
       { "id": "C0123ABCDEF", "name": "engineering" }
     ],
     "allowed_channels": ["C0123ABCDEF"],
     "allowed_dm_users": []
   }
   ```

   Leave `allowed_dm_users` as `[]` for now — Step 4e populates it if
   the user opts into the Slack bridge. If they say no to the bridge,
   it stays empty (the curator reader doesn't use it).

Gate: re-run `elnora-linear sync verify --output json`. `slack` should
now report `status: "populated"`.

### 4c. `repos.json` — GitHub repos the curator watches

This config feeds two signal sources with different requirements:

- **`github_pr`** shells out to `gh pr list`, so the `gh` CLI must be
  installed AND authenticated.
- **`github_commits`** shells out to `git log` against a LOCAL clone of each
  repo, so every entry must include a `local_path` pointing at an existing
  directory on this machine. Without it the source emits one warning per
  repo and skips them all.

**First, verify `gh`.** Run, in order:

```sh
command -v gh >/dev/null && gh --version
gh auth status
```

Gates:
- `gh --version` exits 0. If `command -v gh` is empty, tell the user the
  `github_pr` source can't work without it — point them at
  https://cli.github.com/ to install, then stop and wait. Do NOT try to
  install it yourself.
- `gh auth status` exits 0 and reports `Logged in to github.com`. If it
  prints `You are not logged into any GitHub hosts`, tell the user
  verbatim: `Run "gh auth login" in your terminal, pick GitHub.com, then
  tell me when you're done.` Wait, then re-run `gh auth status` to confirm.
  If `gh auth status` reports the wrong host (e.g. an enterprise GHE
  instance and the repos are on github.com, or vice-versa), surface that
  too — the source will 404 silently otherwise.

**Then, collect repos.** Ask:

> Which GitHub repos should the curator poll for commits and PRs? For each
> one I need two things:
>   1. The `owner/name` slug (e.g. `Elnora-AI/elnora-linear`).
>   2. The path to a local clone on this machine (e.g.
>      `~/code/elnora-linear`). The curator uses `git log` against it for
>      the commits signal — without a local clone, only the PR signal works
>      for that repo.

For each repo the user names, verify the local clone before writing:

```sh
test -d "<expanded-path>/.git" && \
  git -C "<expanded-path>" rev-parse --is-inside-work-tree
```

Gates:
- The path must exist AND be a git working tree. If `test -d` fails, ask
  the user to clone it first (`git clone git@github.com:<owner>/<name>.git
  <path>`) — do NOT clone on their behalf without consent.
- If the user only has a remote repo and doesn't want to clone, write the
  entry WITHOUT `local_path`. The `github_pr` source will still work for it;
  the `github_commits` source will skip it with a warning. Tell the user
  that's what will happen so they aren't surprised.
- Expand `~` to `$HOME` before writing — `existsSync` on a literal `~/...`
  string will fail at runtime.

Write the user's list to `~/.config/elnora-linear/repos.json` in the schema
shown in `references/repos.example.json`. Each entry needs `name` (repo
name, no slash) and `org` (the owner), plus `local_path` when a clone is
available and `default_branch` if the user volunteered it. Do not include
repos the user didn't name, and do not invent `local_path` values.

### 4d. `signal-sources.json` — curator inputs

This file ties together what 4a-4c populated. Open
`references/signal-sources.example.json` for reference. For each `sources[]`
entry:

- `type: "github_commits"` and `type: "github_pr"` — enable IFF Step 4c
  populated repos.
- `type: "slack_messages"` — enable IFF Step 4b populated Slack.
- `type: "external_command"` — leave disabled unless the user volunteered a
  specific command. Do not invent one.
- `type: "mcp_tool"` — reserved in the schema for a future release. Do NOT
  add an entry; configuring one raises a "not yet implemented" error at
  collect time.

After writing, run:

```sh
elnora-linear sync verify --output json
```

Gate: every file the user populated must now report `status: "populated"`.
Files the user skipped remain `"placeholder"` — that's fine.

### 4e. Slack bridge — DM assignees with MEDIUM-tier questions

Skip this whole step if the user answered `reader-only` or `neither` in
Step 4b. Otherwise (decision was `bridge-only` or `both`), the Slack app
and scopes are already in place from Step 4b — this step adds Python
deps, persists the token under the bridge's env-var name, enriches
`users.json`, and writes the bridge fields on `slack.json`.

Background: the curator stages MEDIUM-tier questions in
`curator-state.json` but does not post to Slack. `bridges/slack/bridge.py`
is the consumer that DMs assignees and applies their replies back to
Linear. It ships with the npm package under `bridges/slack/` — full
operator notes in `bridges/slack/README.md`.

Do these in order. Confirm each before the next.

1. **Python deps.** The bridge is a single Python file with two
   dependencies. Verify Python first, then install:

   ```sh
   python3 --version   # 3.9+
   pip install slack-sdk anthropic
   ```

   Gate: `python3 --version` exits 0 with a `3.9.x` or higher version
   string. `pip install` exits 0. If `pip` complains about an externally-
   managed environment (PEP 668), tell the user verbatim:

   > Your Python is PEP 668 managed. Two options:
   > (a) `pipx install slack-sdk && pipx inject slack-sdk anthropic`
   > (b) virtualenv: `python3 -m venv ~/.local/share/elnora-bridge && ~/.local/share/elnora-bridge/bin/pip install slack-sdk anthropic`
   > Pick one. If you go with (b), tell me — the schedule step needs to
   > know your venv's python path.

   Wait for them to pick one; do not silently override with
   `--break-system-packages`. Remember which path they chose — substeps
   6 (dry-run) and 7 (scheduling) need the venv python path if they
   picked (b).

2. **Persist the bot token** as `SLACK_BOT_TOKEN` (the bridge reads this
   name specifically; the curator reader uses `SLACK_TOKEN`. Set both to
   the same `xoxb-…` value if the decision was `both`):

   ```sh
   export SLACK_BOT_TOKEN="<xoxb-…>"
   umask 077
   printf 'SLACK_BOT_TOKEN=%s\n' "$SLACK_BOT_TOKEN" >> ~/.config/elnora-linear/.env
   chmod 600 ~/.config/elnora-linear/.env
   ```

   Re-verify the mode is still `600`. If the decision was `both`,
   `SLACK_TOKEN` should already be in the file from Step 4b substep 7 —
   leave it; do not deduplicate.

3. **Enrich `users.json` with `slack_user_id`.** The bridge maps Linear
   assignees → Slack users via this field. Without it, DMs fall back to
   `slack.json.fallback_dm_user` (or no-op if that's unset). For each
   user the bridge should DM:

   - In Slack, click the user's name → **View full profile** → click the
     three-dot menu → **Copy member ID**. Format: `U0123ABCDEF`.
   - In `~/.config/elnora-linear/users.json`, find the entry whose
     `name` matches the user's Linear display name (already populated by
     `sync all`) and add `"slack_user_id": "U0123ABCDEF"`. The `key`
     field is auto-generated by `sync users` — only override it if the
     auto-derived value collides with another user or doesn't match the
     short alias the user wants in `allowed_dm_users`.

   `sync users` preserves `slack_user_id` (and any user-overridden
   `key`) across future re-syncs — the merge keys off `linear_user_id`.
   Don't invent `slack_user_id` values; if a Linear user has no Slack
   equivalent, leave them out and the bridge will skip DMs to them.

   Reference shape: `references/users.example.json`.

4. **Write `slack.json` bridge fields.** If the decision was `both`,
   Step 4b already wrote `slack.json` with the reader fields — open it
   and add the bridge fields. If the decision was `bridge-only`, create
   it from `references/slack.example.json`:

   ```sh
   cp "$(npm root -g)/@elnora-ai/linear/references/slack.example.json" \
      ~/.config/elnora-linear/slack.json
   ```

   Final shape — drop the reader fields if `bridge-only`, keep them
   alongside if `both`:

   ```jsonc
   {
     // reader fields (only if decision was `both`):
     "channels":         [/* from Step 4b */],
     "allowed_channels": [/* from Step 4b */],

     // bridge fields (always for this step):
     "allowed_dm_users": ["alice", "bob"],     // user keys from users.json — gates outbound DMs
     "workspace_slug":   "your-workspace",     // builds linear.app/{slug}/issue URLs in DMs
     "fallback_dm_user": "alice"               // DM target when an issue has no assignee
   }
   ```

   Ask the user for their workspace slug (the subdomain in
   `linear.app/<slug>/`) and which user keys to put in `allowed_dm_users`
   — that list is the bridge's outbound safety gate. Every key here MUST
   match a `key` field in `users.json` (otherwise the bridge silently
   refuses to DM that user). Cross-check before declaring done. If
   `workspace_slug` is unset, DMs show bare issue IDs instead of
   clickable links; if `fallback_dm_user` is unset, the first entry of
   `allowed_dm_users` is used.

5. **`ANTHROPIC_API_KEY` reminder.** The bridge uses Claude to interpret
   user replies in `resolve` mode. Step 4-pre already collected it for
   the curator; the bridge reads the same env var from the same `.env`
   file. If the user refused to set it in Step 4-pre, flag that the
   bridge will degrade to a keyword-only fallback (worse but functional).

6. **Dry-run smoke test.** Confirm the bridge can load its config
   before scheduling it:

   ```sh
   python3 "$(npm root -g)/@elnora-ai/linear/bridges/slack/bridge.py" tick --dry-run --verbose
   ```

   (If the user picked virtualenv in substep 1, swap `python3` for the
   venv's interpreter, e.g. `~/.local/share/elnora-bridge/bin/python`.)

   Gate: exit 0 and the log confirms it loaded `slack.json` + `users.json`
   (and reports that `SLACK_BOT_TOKEN` + `ANTHROPIC_API_KEY` are set).
   The bridge's upstream-state file (`curator-state.json`) does NOT need
   to exist yet — the bridge treats a missing state as "no pending
   questions" and the dry-run exits cleanly. Step 5's `curator-run` will
   create it. Failure modes:
   - Exit 2 (`Missing required config`): re-check `SLACK_BOT_TOKEN` is on
     its own line in `~/.config/elnora-linear/.env` and the file mode is
     `600`.
   - Exit 4 (`Upstream state lock held`): another `curator-run` is
     mid-flight. Wait for it to finish and retry.
   - `ModuleNotFoundError: slack_sdk` or `anthropic`: the deps landed in
     a different Python than `python3` resolves to — re-run with the
     venv/pipx interpreter (see substep 1).

7. **Schedule it.** Don't run the bridge on demand — schedule it after
   each `curator-run` so new MEDIUM questions get DM'd promptly. Point
   the user at the **Slack bridge** section of `docs/scheduling.md` for
   launchd / systemd / cron templates. The shipped
   `bridges/slack/launchd.example.plist` is the macOS starting point.
   If the user picked the virtualenv path in substep 1, the example
   plist's `/usr/bin/python3` won't see the bridge's deps — they must
   swap that string for the venv's python interpreter before bootstrap.

Gate: re-run `elnora-linear sync verify --output json`. `slack` should
still report `status: "populated"`. There's no separate verifier for the
bridge — the `--dry-run` in substep 6 is the validation.

## Step 5 — Smoke test

Run the most-used CLI verb to confirm the full stack works end-to-end:

```sh
elnora-linear my-issues --limit 10
```

Gates:
- Exit 0.
- Output shows at least one assigned issue OR an empty list with no error.
  An empty list is valid (the user may have nothing assigned) — distinguish
  this from a failed call.
- If the user opted into the curator in Step 4, also run:

  ```sh
  elnora-linear curator-run --collect-only
  ```

  This is diagnostic-mode only (no LLM call, no mutations). Gates:
  - Exit 0 and the output names the signal sources you populated in 4d. If
    a source you enabled doesn't appear, the file is malformed — surface it.
  - Scan the collected signals for `warning:` payloads. If a `github_pr`
    source warns about `gh pr list failed` for every repo, `gh` auth
    regressed since Step 4c — re-check `gh auth status`. If a `github_commits`
    source warns `has no local_path (or path does not exist)` for a repo
    you populated, the path in `repos.json` is wrong or the clone moved —
    fix it before declaring done.
  - If the user provided `ANTHROPIC_API_KEY` in Step 4-pre, also run once
    WITHOUT `--collect-only`:

    ```sh
    elnora-linear curator-run --dry-run
    ```

    Gate: the report's `pipeline.ranLlm` field is `true`. If it reports
    `skippedReason: "ANTHROPIC_API_KEY not set"`, the env file didn't load
    — confirm the key is on its own line in `~/.config/elnora-linear/.env`
    and re-run.

## Step 6 — Handoff summary

Tell the user, in this order:

1. **What's installed and where the config lives** —
   `~/.config/elnora-linear/.env` (API key, mode 0600),
   `~/.config/elnora-linear/*.json` (references).
2. **What's populated vs what's not** — read straight from the final
   `sync verify` output. Don't paraphrase.
3. **How to use it** — three suggested entry points (use the form that
   matches the user's harness):
   - **Under Claude Code with the plugin installed:** `/linear-search <query>`,
     `/linear-my-issues`, `/linear-bulk`.
   - **Under any other agent (Codex / Cursor / Aider / Continue / Amp /
     Jules / Roo) or standalone:** `elnora-linear issues search "<query>"`,
     `elnora-linear my-issues`, `elnora-linear bulk --team X [filters]
     --set-state Y` (dry-run by default; add `--yes` to apply). Full
     dispatch table in [`AGENTS.md`](AGENTS.md).
4. **If they opted into the curator** — mention `elnora-linear curator-run`
   is manual today; point them at `docs/scheduling.md` for launchd/systemd/
   Task Scheduler templates if they want it on a schedule. If they also
   opted into the Slack bridge (Step 4e), point them at the **Slack
   bridge** section of the same doc — the bridge must be scheduled
   AFTER the curator on each tick or MEDIUM questions stay undelivered.
5. **Any warnings from Step 2** — if the API key was scoped to a subset of
   workspaces, repeat that here so they don't wonder later why some teams
   are missing.

## Completion checklist

Before declaring the setup complete, verify ALL of these. If any item fails,
finish it before reporting done.

1. `elnora-linear --version` exits 0.
2. `stat` on `~/.config/elnora-linear/.env` shows mode `600`.
3. `elnora-linear teams list --limit 5` exits 0 and returns ≥1 team.
4. `elnora-linear sync verify --output json` exits 0; `teams`, `projects`,
   `users`, `workflows` all report `status: "populated"`.
5. `elnora-linear my-issues --limit 10` exits 0 (empty list is OK; error is
   not).
6. If the user opted into the curator: every file they said yes to in
   Step 4 reports `status: "populated"`, and
   `elnora-linear curator-run --collect-only` exits 0 with no
   `warning:` payloads for sources the user enabled.
7. If the user provided `ANTHROPIC_API_KEY` in Step 4-pre: a one-off
   `elnora-linear curator-run --dry-run` report shows
   `pipeline.ranLlm: true` (not `skippedReason: "ANTHROPIC_API_KEY not set"`).
8. If the user populated `repos.json`: `gh auth status` exits 0 in the
   same shell that will run the curator, AND every entry with a
   `local_path` points at a real `.git` working tree.
9. If the Step 4b decision was `bridge-only` or `both`: the bridge's
   Python deps are importable from the interpreter the user will
   schedule (`python3 -c 'import slack_sdk, anthropic'` for system
   Python, or the same line via the venv/pipx python they picked in
   Step 4e.1); `SLACK_BOT_TOKEN` is present in
   `~/.config/elnora-linear/.env` (mode still `600`); `slack.json` has
   `workspace_slug` set and a non-empty `allowed_dm_users`; every entry
   in `allowed_dm_users` matches a `key` in `users.json` whose
   `slack_user_id` is populated; the bridge's `tick --dry-run --verbose`
   smoke test exited 0.
10. You have NOT written anything to `~/.config/elnora-linear/` that the user
    didn't explicitly ask for. The curator config files for opted-out
    features remain placeholder.

When all applicable items pass, print `LINEAR_WORKSPACE_READY` on its own
line so the user (and any wrapping harness) can grep for it.
