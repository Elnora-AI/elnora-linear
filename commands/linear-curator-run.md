---
name: linear-curator-run
description: Run the curator — collect signals from configured signal sources and report
allowed-tools: Bash, Read
---

# Linear Curator (collect + report)

Collect signals from the signal sources configured in `references/signal-sources.json`. This is the diagnostic half of the curator — it tells you what each source is seeing. The rule engine (which turns signals into proposed issue mutations) ships in a follow-up release.

## Run

All configured sources:

```bash
elnora-linear curator-run --output text
```

A specific source by name:

```bash
elnora-linear curator-run --source "vanta-failing-tests"
```

## What it reports

For each enabled source:
- `[ok] <name> (<type>): N signal(s)` plus the first 10 payloads
- `[!!] <name> (<type>) — error: <message>` if the source failed (the others keep running)

## Supported source types

- `external_command` — runs any shell command, parses stdout as JSON or lines
- `github_commits`, `github_pr`, `slack_messages`, `linear_issues`, `mcp_tool` — declared in the schema; not yet implemented (they'll surface as errors)

## Don't

- Don't expect mutations from this command — it's collect-only in v0
- Don't configure `external_command` sources that run untrusted scripts — the command runs with the user's full privileges
