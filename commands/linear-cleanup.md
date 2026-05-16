---
name: linear-cleanup
description: Audit Linear issues for problems (missing labels, stale, duplicates, wrong state, orphaned, unactionable) and propose fixes
argument-hint: "<scope: all | team key | project name>"
allowed-tools: Bash, AskUserQuestion, Read
---

# Linear cleanup

Audit Linear issues in **{{scope}}** and propose fixes. Walks six checks, summarizes findings, and asks per-category before any mutation. All `elnora-linear` mutations default to dry-run — explicit `--yes` is required to commit.

## The six checks

### 1. Missing required labels

```bash
elnora-linear issues list --team "<scope>" --limit 100 --output json \
  | jq '.[] | select((.labels // []) | map(.name) | any(startswith("Type:")) | not)'
```

For each issue missing the team's required label prefixes (see `references/label-policy.json` or `elnora-linear teams get <key>`), suggest labels from title/description keywords. Repeat the `startswith` check for every required prefix on the team (`Layer:`, `Source:`, etc.).

### 2. Stale issues (no activity 30+ days)

```bash
elnora-linear cleanup --team "<scope>" --inactive-days 30 --action comment --output text
```

Dry-run by default. Offer: comment / close / cancel / skip. Apply chosen action with `--yes`.

### 3. Potential duplicates

```bash
elnora-linear issues list --team "<scope>" --limit 200 --output json
```

For each pair of issues with >70% title similarity, surface them as candidates. Suggest `elnora-linear relations create --type duplicate-of` or merge.

### 4. Wrong state

```bash
elnora-linear projects list --team "<scope>" --output json
elnora-linear issues list --team "<scope>" --limit 200 --output json
```

Cross-check each issue's state against its project's status (a `Completed` project shouldn't have `In Progress` issues; a `Backlog` project shouldn't have `In Progress` issues). Flag mismatches.

### 5. Orphaned issues (no project)

```bash
elnora-linear issues list --team "<scope>" --limit 200 --output json \
  | jq '.[] | select(.project == null)'
```

For each orphan, suggest the most likely project based on title/description vs `elnora-linear projects list --output json`.

### 6. Unactionable issues

```bash
elnora-linear issues list --team "<scope>" --limit 200 --output json
```

Flag any issue where: description is empty or < 50 chars, no acceptance criteria, or the title is vague (e.g. "fix it", "thing broken"). Offer a rewrite via `linear-issue-reviewer` or archive.

## Workflow

1. **Run all six checks** — print a summary table: category, count, severity.
2. **For each non-empty category** — show the matching issues with proposed fixes; use `AskUserQuestion` to offer:
   - Apply all
   - Review one by one
   - Skip
3. **Execute** the chosen action via `elnora-linear issues update <ID> --labels "..."`, `… --state "..."`, `… --project "..."`, etc. Every mutation goes through the standard CLI gates (no permanent deletes without `--yes`).
4. **Report** — fixed count, archived count, flagged-for-manual-review count.

## Don't

- Don't auto-apply across categories without confirmation per category.
- Don't run anything destructive (`--permanent`, `--yes`) until the user has explicitly approved it.
- Don't disturb `In Progress` issues unless the user explicitly opts in (`elnora-linear cleanup --states "In Progress"`).
- `{{scope}}` should be a plain team key (`ENG`) or project name. Don't pass shell metacharacters — the placeholder is interpolated into Bash invocations literally.
