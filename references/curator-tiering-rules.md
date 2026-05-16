# Linear State Curator — Tiering Rules

Edit this file to tune the curator's behavior. Loaded at runtime by the curator and embedded into the LLM snapshot. The JSON copy of these rules lives in `workflows.json` (loaded by the rule engine); this file is the human-readable contract.

The curator scores every open issue (Todo / In Progress / Backlog) on the teams listed in `teams.json` against the rules below and picks the highest-confidence tier that fires.

## HIGH — auto-apply state changes (cap: 20 per run)

Any one of these fires the HIGH tier. The curator updates state via `elnora-linear issues update`, posts a rationale comment on the issue with cited signals, and lists the action in the daily summary.

- **H1 — Todo + merged PR.** Issue state is `Todo` AND a linked GitHub PR is merged within the last 7 days AND the merge commit message contains the issue ID (e.g. `ENG-123`). → set state `Done`.
- **H2 — In Progress + merged PR by assignee.** Issue state is `In Progress` AND a linked PR is merged AND the PR author's email matches the assignee's email. → set state `Done`.
- **H3 — Duplicate of recently closed issue.** Issue title fingerprint (lowercased, stopwords removed, top 5 keywords) matches a `Done` issue from the last 30 days in the same project. → set state `Canceled` with comment `Duplicate of <ID>`.
- **H4 — External compliance signal passed.** Issue description references an external compliance check (e.g. a vendor test ID) that has been `PASSED` for >7 days. → set state `Done`. (Connect your compliance tooling via the `external_command` signal source.)
- **H5 — Customer milestone signal.** Issue is in `customer-onboarding`-style project AND a corresponding customer milestone signal (from `slack_messages` or `external_command`) confirms completion. → set state `Done`.
- **H6 — Backlog rot.** Issue state is `Backlog` AND no activity (comments, edits, label changes) in 60+ days AND no labels AND no assignee. → set state `Canceled` with comment `Canceled by curator: 60d+ inactive, no signal of intent.`

## MEDIUM — ask in Slack (cap: 10 per run)

Any one fires MEDIUM. The curator posts a top-level message in a configured channel (see `slack.json` `allowed_channels`) with `@mention` of the assignee — anyone allowed can reply in the thread.

**Reply formats:**
- Keywords: `done` / `close` / `yes` → apply. `skip` / `keep` / `hold` → leave. `cancel` / `wontfix` → cancel.
- Free-form: *"yeah ship it"*, *"hold off, customer asked us to wait"*, *"first one done, second still open"*, *"actually ISSUE-235 is the one that's done, not this"* — the curator runs all replies through a single batched Claude call per run that sees ALL pending threads + ALL replies together. So:
  - Multi-issue replies are routed correctly.
  - References to issues NOT in the pending list are captured as out-of-band mentions and surfaced next run.
  - Ambiguous replies trigger a follow-up question in the same thread instead of dropping silently.

For label-blocked issues (rule M6 below), the curator instead **DMs an allow-listed user privately** so compliance/customer info stays out of public threads. See `slack.json` `allowed_dm_users`.

**Reply processing cadence:** configurable per deployment. Typical setups:
- Hourly during working hours — `resolve-only` mode processes pending replies (no full sweep).
- Daily — full sweep including new HIGH/MEDIUM/LOW evaluation.
- Manual: `elnora-linear curator-run --apply` triggers immediate processing.

The curator posts a confirmation reply in the same thread once it acts (or asks a follow-up if it needs clarification).

- **M1 — Commits without merged PR.** Commits in configured repos reference an issue ID in their message but no linked PR is merged yet. Question: "should I move this to In Progress?"
- **M2 — Stalled In Progress.** Issue state is `In Progress` AND zero commits referencing it AND zero comments in 14+ days. Question: "still active, or should I move it back to Todo?"
- **M3 — External email/thread match.** Issue title overlaps with a recent external thread (>=3 keyword match) AND no Linear comment in 7+ days. Question: "have you handled this off-ticket?"
- **M4 — PR closed unmerged.** Linked PR was closed without merging AND issue is still open. Question: "abandoned, or new PR coming?"
- **M5 — Title near-duplicate, both open.** Two issues in the same project with >=85% title similarity, both Todo. Question: "merge into one — which is the canonical?"
- **M6 — Label allowlist override.** Any HIGH-tier rule that fires on an issue carrying a label in the workspace's "never-touch" set (`customer:*`, `compliance:*`, `security:critical`, `sla:*`) is automatically downgraded to MEDIUM and routed to a specific user via DM. The label allowlist exists to prevent silent state changes on customer- or compliance-sensitive work.

## LOW — channel report only

No action, no DM. Listed in the daily summary post under "Needs human triage".

- **L1 — Pure stale Todo.** No HIGH or MEDIUM signal AND last activity >30 days AND state is Todo.
- **L2 — Inactive assignee.** Assignee has zero Linear activity >60 days. Curator can't reach them on Slack. Surface in the channel.
- **L3 — Unverifiable external reference.** Issue description references an external URL the curator cannot validate. Surface so a human can check.

## Hard caps

- `MAX_MUTATIONS=20` per run (HIGH actions).
- `MAX_QUESTIONS_PER_DAY=10` (new MEDIUM DMs).
- Excess HIGH and MEDIUM candidates roll over to the next run, prioritized by oldest `updatedAt`.

## Never-touch labels

Issues carrying any of these labels are never auto-mutated. Any HIGH match is downgraded to MEDIUM and DM'd to an allow-listed user, not the assignee.

- `customer:*` — anything customer-facing
- `compliance:*` — SOC 2, ISO 27001, GDPR, audit work
- `security:critical` — critical-severity security
- `sla:*` — items with explicit SLA commitments

You can customize this allowlist in `workflows.json` under `never_touch_labels`.

## Outbound surface

Configured in `slack.json`:
- `allowed_channels`: the only channels the curator may post in.
- `allowed_dm_users`: the only users the curator may DM.

Anything outside this surface is rejected as a bug — the curator is forbidden from messaging customers or external parties under any circumstance.
