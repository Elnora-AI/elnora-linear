---
name: linear-bulk
description: Apply the same change to many Linear issues at once. Dry-run by default.
argument-hint: "<filter description> → <mutation description>"
allowed-tools: Bash, Read, AskUserQuestion
---

# Linear Bulk Update

Apply one change to every Linear issue matching a filter. **Default is dry-run** — the plan is shown but nothing mutates until the user confirms with `--yes`.

## Workflow

1. **Parse the user's request** into filter + mutation pieces. Example: "move all ENG team Todos with the 'security' label to In Progress" → filter `--team ENG --state Todo` + mutation `--set-state "In Progress"`.

2. **Run the dry-run first** — always:
   ```bash
   elnora-linear bulk \
     --team <key> [--state <name>] [--assignee <name>] [--query <text>] \
     [--set-state <name>] [--add-comment "<text>"] \
     --output text
   ```
   This prints what would change without touching anything.

3. **Show the user the plan.** Use `AskUserQuestion` to confirm. Options:
   - "Apply all" → re-run with `--yes`
   - "Cancel" → stop
   - "Adjust filter" → tweak and re-dry-run

4. **Apply** with `--yes` only after explicit confirmation.

## Safety

- `bulk` REQUIRES at least one of `--set-state` or `--add-comment` — the command itself errors otherwise
- Issues already in the target state are skipped (with a `SKIPPED` reason in the plan)
- The default `--limit` is 100; raise it explicitly if the user wants to touch more

## Don't

- Don't add `--yes` to the first invocation. Always dry-run first
- Don't auto-confirm. The user clicks Approve
- Don't combine filters the user didn't ask for
