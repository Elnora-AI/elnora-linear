# INSTALL_FOR_AGENTS.md — `linear-workspace` setup

> **Step 0 — Identity gate.** If you are NOT an autonomous coding agent (Claude
> Code, Cursor, Windsurf, etc.), stop reading this file and open `README.md`
> instead. This file walks an agent through a multi-step setup that includes
> reading an API key from the user, writing config to `~/.config/elnora-linear/`,
> and making live calls against the Linear GraphQL API. Humans should follow
> the README's Quick Start.

You are the agent handing off after the user installed the `linear-workspace`
plugin (either `/plugin install linear-workspace@elnora-linear` or
`npm install -g @elnora-ai/linear`). Your job is to verify the install, collect
the user's Linear API key, populate workspace references, optionally configure
the curator, run a smoke test, and hand them a working environment.

Be transparent: announce each step before you run it, show the output, and
explain what you found. The user may not know what a `references/` directory
is or what the curator does — keep your language plain and ask one question at
a time.

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

If the user installed via Claude Code plugin, also confirm the plugin loaded:

```sh
ls .claude/plugins 2>/dev/null || ls ~/.claude/plugins 2>/dev/null
```

You should see `linear-workspace` somewhere. If not, the `/plugin install`
didn't complete — ask the user to rerun it.

## Step 2 — Collect the Linear API key

The CLI persists the key to `~/.config/elnora-linear/.env` at mode `0600` on
first use. Don't try to write that file yourself — let the CLI handle it so
permissions stay correct.

Tell the user, verbatim:

> I need a Linear personal API key. Open
> https://linear.app/settings/api in your browser, click **Create key**, give
> it a name like "elnora-linear", copy the value, and paste it here. The key
> starts with `lin_api_`.

When the user pastes the key, set it as an environment variable for the
verification call and let the next command persist it:

```sh
export LINEAR_API_KEY="<paste>"
elnora-linear teams list --limit 5
```

Gates:
- Exit 0 and at least one team row in the output. That confirms the key is
  valid and the API is reachable.
- If you get `401 Unauthorized`, the key is wrong — ask the user to regenerate
  it. Do NOT retry with a key you guessed or pieced together.
- If you get `403 Forbidden` on a specific team, the key works but is scoped
  to a subset of workspaces — note this and continue, but flag it in your
  Step 6 summary so the user knows the curator can't see those teams.

Then persist the key so future shells stay authenticated. The CLI reads
`LINEAR_API_KEY` from `~/.config/elnora-linear/.env` automatically — write it
once and `export` lines stop being necessary:

```sh
mkdir -p ~/.config/elnora-linear
umask 077
printf 'LINEAR_API_KEY=%s\n' "$LINEAR_API_KEY" > ~/.config/elnora-linear/.env
chmod 600 ~/.config/elnora-linear/.env
```

Gate: `stat -f '%Sp' ~/.config/elnora-linear/.env` (macOS) or
`stat -c '%a' ~/.config/elnora-linear/.env` (Linux) must show `600` /
`-rw-------`. If it's any wider, fix it with `chmod 600` before continuing —
this file holds a workspace-scoped API key.

## Step 3 — Sync workspace references

Populate the four auto-discoverable reference files (teams, projects, users,
workflows) in one batch:

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
  WILL report `"placeholder"` at this point. That's expected — they're only
  populated if the user opts into the curator in Step 4. Don't treat their
  placeholder status as a failure.

## Step 4 — Curator opt-in

Ask the user, verbatim:

> Do you want to set up the curator? It polls GitHub commits, GitHub PRs,
> Slack messages, and other signals on a schedule, asks an LLM to propose
> Linear state changes based on what it sees, auto-applies the safe ones
> (capped at 20 per run, debounced 14 days), and queues the rest for you to
> confirm. You can skip it now and add it later by editing the files in
> `~/.config/elnora-linear/` and running `elnora-linear curator-run`.

If the user says **no**, skip to Step 5.

If the user says **yes**, walk these four files in order. For each one:
copy the example, ask the user the minimum questions to populate it, write
the result, and validate with `sync verify`. Do not write all four in one
shot — confirm each before moving on.

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

### 4b. `slack.json` — channels + curator DM targets

Only needed if the user wants Slack signals or wants curator state-change
DMs. Ask:

> Do you want the curator to read Slack messages or send you DMs when it
> proposes a state change? If yes, I'll need a Slack bot token and the
> channel IDs to watch.

If no, skip this file (leave it as placeholder). If yes, populate it from
`references/slack.example.json` and ask the user only for: bot token,
channel IDs, and DM target user ID.

### 4c. `repos.json` — GitHub repos the curator watches

Ask:

> Which GitHub repos should the curator poll for commits and PRs? Give me
> `owner/name` slugs (e.g. `Elnora-AI/elnora-linear`).

Write the user's list to `~/.config/elnora-linear/repos.json` in the schema
shown in `references/repos.example.json`. Do not include repos the user
didn't name.

### 4d. `signal-sources.json` — curator inputs

This file ties together what 4a-4c populated. Open
`references/signal-sources.example.json` for reference. For each `sources[]`
entry:

- `type: "github_commits"` and `type: "github_pr"` — enable IFF Step 4c
  populated repos.
- `type: "slack_messages"` — enable IFF Step 4b populated Slack.
- `type: "external_command"` and `type: "mcp_tool"` — leave disabled unless
  the user volunteered a specific command or MCP tool. Do not invent these.

After writing, run:

```sh
elnora-linear sync verify --output json
```

Gate: every file the user populated must now report `status: "populated"`.
Files the user skipped remain `"placeholder"` — that's fine.

## Step 5 — Smoke test

Run the most-used slash command (or its CLI equivalent) to confirm the full
stack works end-to-end:

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

  This is diagnostic-mode only (no LLM call, no mutations). Gate: exit 0 and
  the output names the signal sources you populated in 4d. If a source you
  enabled doesn't appear, the file is malformed — surface it.

## Step 6 — Handoff summary

Tell the user, in this order:

1. **What's installed and where the config lives** —
   `~/.config/elnora-linear/.env` (API key, mode 0600),
   `~/.config/elnora-linear/*.json` (references).
2. **What's populated vs what's not** — read straight from the final
   `sync verify` output. Don't paraphrase.
3. **How to use it** — three suggested entry points:
   - `/linear-search <query>` for natural-language search
   - `/linear-my-issues` for their assigned issues
   - `/linear-bulk` for cross-team state changes (dry-run by default)
4. **If they opted into the curator** — mention `elnora-linear curator-run`
   is manual today; point them at `docs/scheduling.md` for launchd/systemd/
   Task Scheduler templates if they want it on a schedule.
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
   `elnora-linear curator-run --collect-only` exits 0.
7. You have NOT written anything to `~/.config/elnora-linear/` that the user
   didn't explicitly ask for. The curator config files for opted-out
   features remain placeholder.

When all seven pass, print `LINEAR_WORKSPACE_READY` on its own line so the
user (and any wrapping harness) can grep for it.
