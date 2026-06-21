---
name: linear-search
description: Search Linear issues by keyword, team, assignee, state, or priority
argument-hint: "<query>"
allowed-tools: Bash, Read
---

# Linear Search

Search Linear issues for: **{{query}}**

## Run

```bash
elnora-linear search --query "{{query}}" --limit 25 --output json
```

For more focused queries, add flags:
- `--team ENG` — restrict to a team
- `--assignee me` — only your issues (or `--assignee "Alice Smith"`)
- `--state "In Progress"` — by workflow state
- `--priority urgent` — by priority (`urgent|high|medium|low|none`, or `0-4`)
- `--limit <n>` — default 25
- `--output text` — for human-readable; default here is JSON for parsing

## Present

Render the JSON as a table: identifier, state, assignee, title. Highlight any issue whose state matches what the user is looking for.

## Don't

- Don't paginate; the `--limit` flag controls volume
- Don't apply mutations — that's `/linear-bulk`, `/linear-cleanup`, or the `linear-issue-updater` agent
