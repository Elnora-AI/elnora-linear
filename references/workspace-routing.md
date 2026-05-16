# Workspace Routing

Schema/template for documenting how your workspace's teams + projects + labels map to your work intake. Replace the examples below with your own workspace structure; populate `teams.json`, `projects.json`, and `label-policy.json` with the underlying machine-readable data.

## Teams (example)

| Team | Prefix | Use For |
|------|--------|---------|
| **Engineering** | ENG- | Customer-facing product code, features, bugs |
| **Operations** | OPS- | Internal: tooling, compliance docs, HR, access management |
| **Security** | SEC- | CVE/vulnerability remediation, pentest findings, incidents (not security features) |
| **Customer Success** | CUS- | Customer support, onboarding, client feedback |

## Routing Keywords (example)

| Keywords | Route To |
|----------|----------|
| feature, bug, build, implement, develop, code, product, ship, api, ui | **Engineering** |
| vulnerability, CVE, CodeQL, dependabot, pentest finding, patch, security incident | **Security** |
| internal tooling, internal infrastructure, dev environment, plugin, marketplace, cli setup | **Operations** |
| document, record, audit, review completed, change approved, compliance | **Operations** |
| onboarding, offboarding, access provision, access revoke, quarterly review | **Operations** |
| change request, policy change, procedure change, ISMS change | **Operations** |
| internal audit, management review, corrective action, risk assessment | **Operations** |
| AI use case, AI capability scope, model family change, foundation model swap, AI governance | **Operations** |
| hr, admin, process improvement, team operations, company operations | **Operations** |
| customer, support request, user reported, client feedback, customer onboarding | **Customer Success** |

**Default:** Engineering

## Project Keywords (schema)

Each project belongs to a specific team. Document yours in `workspace-projects.md` and keep the underlying mapping in `projects.json`.

| Project | Keywords | Team |
|---------|----------|------|
| `<Project name>` | `<keyword1>, <keyword2>, ...` | `<team>` |

## State Mapping (example)

| Project Status | Issue State |
|----------------|-------------|
| In Progress | Todo |
| Planned | Todo |
| Backlog | Backlog |

(see `recommendedStateForStatus` in the CLI; this table is the human-readable version of that logic.)

## Assignees

Document your team's assignment rules here. Common patterns:

- Map roles to default assignees (e.g. "platform code → Platform lead").
- Rule of thumb: ASK the user for an assignee if not specified — defaults can silently route to the wrong person.

---

*Projects: `workspace-projects.md` | Labels: `workspace-labels.md` | Run `elnora-linear sync all` to refresh JSON references from Linear.*
