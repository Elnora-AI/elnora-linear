---
name: linear-my-issues
description: List Linear issues assigned to you, grouped by state
allowed-tools: Bash, Read
---

# My Linear Issues

List every Linear issue currently assigned to the viewer.

## Run

```bash
elnora-linear my-issues --limit 50 --output json
```

## Present

Group by state in this order: `In Progress`, `Todo`, `Backlog`, `Done` (last 7 days only), `Canceled` (hide unless asked). Within each state, sort by `updatedAt` descending. Show identifier, title, team, project.

If the list is empty, say so cleanly: "Nothing assigned." Don't fabricate.

## Don't

- Don't include closed/cancelled issues older than 7 days — the user wants their active load
