# Workspace Projects — Documentation Template

A schema you can fill in to document your projects per team. Pair this with `projects.json` (the machine-readable copy that the CLI consumes via `sync` and `context`).

Load this file when you need full project context that doesn't fit on a `context --team` summary. Agents normally do not read it.

## Projects by Team and Status

### `<Team-1>`

#### In Progress
| Project | Priority | Lead | Purpose |
|---------|----------|------|---------|
| `<Project name>` | `<Urgent|High|Normal|Low>` | `<lead>` | `<one-line purpose>` |

#### Planned
| Project | Priority | Lead | Purpose |
|---------|----------|------|---------|

#### Backlog
| Project | Priority | Lead | Purpose |
|---------|----------|------|---------|

#### Completed
| Project | Priority | Lead | Purpose |
|---------|----------|------|---------|

#### Canceled
| Project | Priority | Lead | Purpose |
|---------|----------|------|---------|

---

### `<Team-2>`

(same structure)

---

## Compliance workflow projects

If you use the bundled compliance templates (see `template-index.md`), each template usually maps to its own project so the audit trail is easy to find. Typical names:

- User Onboarding / Offboarding
- Access Provisioning / Revocation / Reviews / Privileged Access
- Standard / Significant / Major Changes
- Security Incidents / Vulnerability Management / Pentest Remediation
- Availability Incidents / Operational Requests
- Root Cause Analysis / Lessons Learned / Corrective Actions
- Internal Audits / Management Reviews
- Risk Assessments / Vendor Assessments
- AI Governance / Backup & DR Testing / Data Modifications

---

*Routing keywords: `workspace-routing.md` | Labels: `workspace-labels.md` | Run `elnora-linear sync all` to refresh the JSON references from Linear.*
