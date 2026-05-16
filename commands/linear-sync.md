---
name: linear-sync
description: Populate or refresh the Linear reference files (teams, projects, users, workflows)
allowed-tools: Bash, Read
---

# Linear Sync

Refresh the reference files the rest of `elnora-linear` reads — teams, projects, users, workflow states. Run this on first install and any time your Linear workspace changes (new team, renamed project, etc.).

## Run

The fast path: refresh everything auto-discoverable from the Linear API.

```bash
elnora-linear sync all
```

Pick one target:

```bash
elnora-linear sync teams
elnora-linear sync projects
elnora-linear sync users
elnora-linear sync workflows
```

Validate references:

```bash
elnora-linear sync verify
```

Reports each reference as `user-file` (populated) or `placeholder` (default, empty).

Import an existing config bundle:

```bash
elnora-linear sync import --from /path/to/bundle.json
```

## Where it writes

In precedence order:
1. `--references-dir <path>` flag
2. `LINEAR_REFERENCES_DIR` env var
3. `~/.config/elnora-linear/` (auto-created if needed)

Never writes to the bundled defaults in the installed package — those stay clean.

## Don't

- Don't run `sync all` repeatedly in a loop — it issues N×teams API calls
- Don't commit the populated reference files to a public repo — they're user-specific data
