---
name: linear-cleanup
description: Find stale Linear issues and act on them. Dry-run by default.
allowed-tools: Bash, Read, AskUserQuestion
---

# Linear Cleanup

Find Linear issues that have gone stale (no activity for N days) and propose a cleanup action: close, cancel, or just nudge with a comment.

## Workflow

1. **Run the dry-run first** to see what's stale:
   ```bash
   elnora-linear cleanup \
     [--team <key>] \
     [--states "Todo,Backlog"] \
     --inactive-days 30 \
     --action comment \
     --output text
   ```

2. **Show the plan.** It lists each stale issue, days inactive, and the proposed action. Default action is `comment` (least destructive).

3. **Confirm via `AskUserQuestion`.** Options:
   - "Comment on all" → rerun with `--action comment --yes`
   - "Close (mark Done)" → rerun with `--action close --yes`
   - "Cancel" → rerun with `--action cancel --yes`
   - "Skip" → don't run

4. **Apply** with `--yes` after confirmation.

## Defaults

- `--states "Todo,Backlog"` — only unstarted work, never disturbs `In Progress`
- `--inactive-days 30`
- `--action comment` — least destructive; the user must explicitly pick `close` or `cancel`

The action `close` resolves the team's `completed`-type state by TYPE, not name, so it works across teams whose state names differ. Same for `cancel` → `canceled`.

## Don't

- Don't run with `--yes` on the first invocation
- Don't close work that's `In Progress` unless the user explicitly says so (add `--states "In Progress"`)
- Don't override the default comment without a reason — the default mentions days inactive
