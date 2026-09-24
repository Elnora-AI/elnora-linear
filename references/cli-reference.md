# elnora-linear CLI Reference

All Linear operations use the `elnora-linear` CLI. Commands output JSON to stdout. Auth via `LINEAR_API_KEY` env var (already set).

**CLI path:** `elnora-linear`

## Commands

```bash
# Issues
issues search "terms" [--limit N]
issues list [--team "Team"] [--project "Project"] [--state "State"]
issues get ENG-123
issues create "Title" --team "Team" [--description "md"|--description-file <path>] [--project "P"] \
  [--labels "L1,L2"] [--priority 0-4] [--assignee "name"|"me"|"none"] \
  [--state "Todo"|"Backlog"] [--due-date "YYYY-MM-DD"] [--parent "ENG-123"]
issues update ENG-123 [--title "T"] [--description "md"|--description-file <path>] [--state "S"] \
  [--assignee "name"] [--priority 0-4] [--labels "L1,L2"] [--project "P"] \
  [--due-date "YYYY-MM-DD"] [--team "Team"] [--parent "ENG-12"|"none"]

# Comments
comments create ENG-123 (--body "text"|--body-file <path>)
comments list ENG-123
comments update <commentId> (--body "text"|--body-file <path>)
comments delete <commentId>

# Projects
projects list [--team "Team"] [--state "planned|started|paused|completed|canceled"]
projects get "Project Name"
projects create "Name" --team "Team" [--description "md"] [--priority 0-4] \
  [--lead "name"|"me"] [--start-date "YYYY-MM-DD"] [--target-date "YYYY-MM-DD"] \
  [--color "#hex"] [--icon "emoji"]
projects update <nameOrId> [--name "N"] [--description "md"] [--priority 0-4] \
  [--lead "name"|"me"|"none"] [--start-date "YYYY-MM-DD"] [--target-date "YYYY-MM-DD"] \
  [--color "#hex"] [--icon "emoji"] [--state "planned|started|paused|completed|canceled|backlog"]
projects delete <nameOrId> [--permanent]
projects restore <nameOrId>

# Teams & States
teams list
teams get "Team"
teams create "Name" --key "KEY" [--description "desc"] [--color "#hex"] \
  [--icon "emoji"] [--timezone "tz"]
teams update <nameOrId> [--name "N"] [--key "KEY"] [--description "desc"] \
  [--color "#hex"] [--icon "emoji"] [--timezone "tz"]
teams delete <nameOrId>
teams restore <nameOrId>
states list --team "Team"

# Labels
labels list [--team "Team"]
labels create "Name" [--color "#hex"] [--team "Team"]
labels update <id> [--name "N"] [--color "#hex"] [--description "desc"]
labels delete <id>

# Users
users list
users me
users get "Name or email"

# Documents
documents list [--project "Project"] [--limit N]
documents get <id>
documents create --title "Title" [--content "md"] [--project "Project"]
documents update <id> [--title "T"] [--content "md"]
documents delete <id>
documents restore <id>

# Cycles
cycles list --team "Team" [--type current|previous|next]
cycles get <id>

# Initiatives
initiatives list
initiatives get "Name or ID"
initiatives create "Name" [--description "desc"] [--status Planned|Active|Completed] [--owner "name"]
initiatives update "Name or ID" [--name "N"] [--status "S"] [--description "D"]
initiatives delete "Name or ID" [--permanent]
initiatives restore "Name or ID"

# Milestones
milestones list --project "Project"
milestones get "Name or ID" --project "Project"
milestones create "Name" --project "Project" [--description "D"] [--target-date "YYYY-MM-DD"]
milestones update <id> [--name "N"] [--description "D"] [--target-date "YYYY-MM-DD"]
milestones delete <id>

# Status Updates
status-updates list --type project --project "Project" [--limit N]
status-updates create --type project --project "Project" [--body "md"] [--health onTrack|atRisk|offTrack]
status-updates update <id> [--body "md"] [--health onTrack|atRisk|offTrack]
status-updates delete <id> [--permanent]
status-updates restore <id>

# Attachments
attachments list ENG-123
attachments get <id>
attachments create ENG-123 --url "URL" --title "Title" [--subtitle "S"] [--icon "emoji"]
attachments upload ENG-123 --file "path" --filename "name" --content-type "mime" [--title "T"]
attachments delete <id>

# Relations
relations create ENG-123 ENG-456 [--type related|blocks|duplicate|similar]  # default: related
relations list ENG-123
relations delete <relationId>

# Project Labels
project-labels list
project-labels create "Name" [--color "#hex"] [--description "D"]
project-labels update <id> [--name "N"] [--color "#hex"] [--description "D"]
project-labels delete <id>

# Issues — atomic label edits and batch ops (v2.2)
issues subscribe ENG-123
issues unsubscribe ENG-123
issues add-label ENG-123 "Type: feature"
issues remove-label ENG-123 "Layer: frontend"
issues batch-create <jsonFile|->  # JSON array; cap 50; --yes when N>=10; --dry-run previews the resolved plan. Each item takes friendly names (team, project, assignee, labels, state) OR raw IDs (teamId, projectId, assigneeId, labelIds, stateId) — names resolve like single-issue create. labels = string[] or "a,b". priority = number or string. parent = "ENG-12". PREFER THIS over a shell loop of single creates.
issues batch-update <ids> <jsonPatchFile|->  # ids = comma-separated ENG-X or UUIDs
issues bulk-ops <jsonFile|->  # JSON array of ops, batched into GraphQL mutations. --dry-run shows the RESOLVED plan.

# bulk-ops op schema — every key each kind reads. An unsupported key is now a hard
# error; it used to be dropped silently while the op still reported success.
#   {"kind":"create",       title, team, description, priority, dueDate, project, labels, state, parent, assignee, skipProjectCheck}
#   {"kind":"update",       id, team, title, state, parent, description, priority, assignee, project, dueDate}
#   {"kind":"relate",       from, to, type}                 # type: related|blocks|duplicate|similar
#   {"kind":"comment",      issue (or id), body}
#   {"kind":"label-add",    issue, label}
#   {"kind":"label-remove", issue, label}
#   {"kind":"archive",      id}
#
# bulk-ops notes:
# - `update` does NOT take `labels` — IssueUpdateInput.labelIds REPLACES the whole
#   set, so a partial list would strip siblings. Use label-add / label-remove.
# - `parent` takes an identifier ("ENG-12"), not a UUID; null detaches.
# - `assignee` takes a name or email; null unassigns.
# - An update that sets no supported field is rejected rather than sent as an
#   empty mutation that Linear answers with `success`.
# - Setting state to a duplicate state requires a duplicate RELATION to exist
#   first — create it with `relations create <dup> <canonical> --type duplicate`.
# - Batches abort together: if one op fails, siblings report `aborted: sibling op
#   in same batch failed (opN: <reason>)`, naming the op that broke.

# Comments resolve / unresolve (v2.2)
comments resolve <commentId>
comments unresolve <commentId>

# Reactions (v2.2)
react <ENG-X|commentUUID> "<emoji>" [--issue]   # --issue forces UUID -> issueId
unreact <reactionId>

# Reactions notes:
# - Linear normalizes shortcodes server-side (e.g. "thumbsup" → "+1"). The
#   returned reaction.emoji reflects the normalized form. Pass either the
#   literal Unicode glyph (👍) or a known shortcode (:eyes:); both work.
# - --issue is implied when the target matches ENG-N. Passing it on an
#   ENG-N target is a no-op and now emits a stderr warning.

# Quota (v2.2)
quota   # Remaining rate-limit budget — allowed/remaining/requested/period/resetAt

# Audit (v2.2 — read-only)
audit entries [--limit N] [--since "ISO"] [--type "AuditEntryType"]
audit types

# Notifications (v2.2)
notifications list [--limit N] [--unread]
notifications get <id>
notifications archive <id> --yes
notifications mark-read   --issue|--initiative|--initiative-update <id> [--at "ISO"]
notifications mark-unread --issue|--initiative|--initiative-update <id>
notifications snooze      --issue|--initiative|--initiative-update <id> --until "ISO"

# Customers (v2.2 — Linear's customer-feedback feature)
customers list [--query "text"] [--limit N]
customers get <idOrName>
customers create "Name" [--domains "csv"] [--external-ids "csv"] [--owner "userOrMe"] [--revenue N] [--size N] [--logo-url URL]
customers update <idOrName> [--name "N"] [--domains "csv"] [--external-ids "csv"] [--owner "userOrMe|none"] [--revenue N] [--size N] [--logo-url URL]
customers upsert --external-id <id>|--id <uuid> [--name "N"] [--domains "csv"] [--owner "u"] [--revenue N] [--size N]

customer-needs list [--customer "idOrName"] [--project "Name"] [--limit N]
customer-needs get <id>
customer-needs create --body "md" (--customer <idOrName>|--customer-external-id <id>) (--issue ENG-X|--project "Name") [--priority 0|1] [--attachment <id>|--attachment-url <url>]   # Linear API: priority is 0 or 1 only (not 0-4 like issues)
customer-needs from-attachment <attachmentId>
customer-needs update <id> [--body "md"] [--customer "X"] [--issue ENG-X|--project "Name"] [--priority 0-4]
customer-needs archive <id> --yes

# Templates (v2.2)
templates list [--type issue|project|document] [--team "Name"]
templates sync --team "<your-team>" [--dry-run] [--templates-dir <path>] [--yes]

# Webhooks (v2.2 — agent framework)
webhooks list [--limit N]
webhooks get <id>
webhooks create --url <https-url> --resource-types "Issue,AgentSessionEvent" (--team "Name"|--all-public-teams) [--label "L"] [--secret <s>] [--disabled]
webhooks update <id> [--url <https-url>] [--resource-types "csv"] [--label "L"] [--enabled|--disabled]
webhooks delete <id> --yes
webhooks rotate-secret <id> --yes   # Secret shown ONCE
webhooks verify <signatureFile> --body <bodyFile> [--secret <s>]

# Agent sessions (v2.2)
agent-sessions list [--limit N]
agent-sessions get <id>
agent-sessions create-on-issue <ENG-X|UUID> [--external-link <url>]
agent-sessions create-on-comment <commentUUID> [--external-link <url>]
agent-sessions update <id> [--external-link <url>] [--plan '<jsonString>']
agent-sessions update-external-url <id> [--external-link <url>] [--add <url>] [--remove <url>]

# Agent activities (v2.2)
agent-activities list <sessionId> [--limit N]
agent-activities get <id>
agent-activities create <sessionId> --type thought|action|elicitation|response|error \
  [--body "text"] [--action "name"] [--parameter "p"] [--result '<json>'] \
  [--signal select|auth|continue|stop] [--signal-metadata <jsonFile>] [--ephemeral]
```

**Priority values:** 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low

**Note:** `--labels` replaces existing labels. To preserve, first read from `issues get`, then include all in `--labels`.

## Long Text — Pass a File, Not a Shell Argument

Markdown bodies carry fenced code blocks, backticks, `$`, and both quote kinds — all of
which the shell interprets before the CLI sees them. Write the text to a file and pass the
path instead:

| Command | Inline | From a file |
|---------|--------|-------------|
| `issues create` | `--description "md"` | `--description-file <path>` |
| `issues update` | `--description "md"` | `--description-file <path>` |
| `comments create` | `--body "text"` | `--body-file <path>` |
| `comments update` | `--body "text"` | `--body-file <path>` |

```bash
elnora-linear issues update ENG-123 --description-file ./body.md
elnora-linear comments create ENG-123 --body-file ./review.md
generate-body | elnora-linear comments create ENG-123 --body-file -   # '-' reads stdin
```

Rules, all enforced with exit code 2 and a JSON error on stderr:

- The inline option and the file option are **mutually exclusive**. Passing both is an
  error, not a silent precedence rule.
- An unreadable or missing file is an error naming the path and the reason. Paths resolve
  against the working directory; `~` is not expanded.
- A file with no text in it is an error, not an empty write — an empty file is almost always
  a wrong path or a truncated write.
- **The file must be UTF-8.** Any other encoding is an error, not a best-effort guess:
  decoding it leniently would replace every undecodable byte with `U+FFFD` and report success
  while writing mojibake. A UTF-16 byte-order mark is named explicitly in the error.
- File contents are sent verbatim; nothing is trimmed. A UTF-8 byte-order mark, if present,
  is dropped — a leading `U+FEFF` would stop the first line parsing as a heading.

### Writing the file as UTF-8 on Windows

PowerShell's defaults are the trap here: in Windows PowerShell 5.1, `>` and `Out-File` write
**UTF-16LE with a BOM**, and `Set-Content` writes ANSI, which stops being UTF-8 as soon as the
text contains an accented character. Name the encoding explicitly:

```powershell
Set-Content -Encoding utf8 .\body.md -Value $text     # UTF-8 (with a BOM on Windows PowerShell 5.1)
Out-File -Encoding utf8 .\body.md -InputObject $text  # same
elnora-linear issues update ENG-123 --description-file .\body.md
```

PowerShell 7+ writes UTF-8 without a BOM for `-Encoding utf8`; both forms are accepted. macOS
and Linux shells write UTF-8 already; convert an existing file with
`iconv -f <encoding> -t UTF-8 in.md > body.md`.

Reading a description back after writing it is still worth doing: Linear normalises markdown
on save (it inserts blank lines and rewrites `-` bullets as `*`), so the stored text will not
be byte-identical to the file.

## Argument Style — Positional vs Flag

Some commands take a value as a flag (`--body "text"`) and others as a positional. The conventions:

| Command | Style | Example |
|---------|-------|---------|
| `comments create <issueId> --body "text"` | Flag — body is multi-line; use `--body-file` for markdown | `comments create ENG-1 --body "Looks good"` |
| `comments update <id> --body "text"` | Flag — same reason | `comments update <uuid> --body "Updated"` |
| `issues add-label <id> <label>` | Positional — single label, atomic | `issues add-label ENG-1 "Type: bug"` |
| `issues remove-label <id> <label>` | Positional — single label, atomic | `issues remove-label ENG-1 "Type: bug"` |
| `issues update <id> --labels "L1,L2"` | Flag — REPLACES the full set, plural | `issues update ENG-1 --labels "Type: bug,Layer: frontend"` |
| `react <target> <emoji>` | Two positionals | `react ENG-1 "🚀"` |
| `unreact <reactionId>` | One positional (UUID only) | `unreact <uuid>` |

The label commands are intentionally asymmetric: `add-label`/`remove-label` are atomic single-label edits, while `--labels` on `issues update` is a full-set replacement (use it when you mean "set the labels to exactly this list").

## Common Mistakes

| Wrong | Correct | Why |
|-------|---------|-----|
| `--assign` | `--assignee` | Full flag name required |
| `--labels "X"` on `issues list` | `--label "X"` (singular) | `list` filters by ONE label; `create`/`update` set MANY |
| `--desc` | `--description` | Full flag name required |
| `--description "$(cat body.md)"` | `--description-file body.md` | The shell mangles fenced blocks, backticks and quotes on the way in |
| `--body` (on issues) | `--description` | `--body` is for `comments create` only |
| `add-label ENG-1 "a,b"` | Two calls, or `update --labels "current,a,b"` | `add-label` rejects comma-containing values |
| `--project "X" --team "Y"` where X belongs to Z | Match project to its owning team | Projects are team-scoped — check `workspace-routing.md` |

**Label flag convention:** `--label` (singular) for `issues list` filtering. `--labels "L1,L2"` (plural, comma-separated) for `create`/`update` to SET the full label set.

