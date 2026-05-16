# Workspace Labels Reference

> **Source of truth note:** the *required-label policy* per team is enforced
> by the CLI (see `references/label-policy.json` + `elnora-linear issues
> create` validation). The full *label catalog* is fetched live via
> `elnora-linear context --team "<Team>"`. This file is human-only
> documentation kept around for browsing the taxonomy at a glance — agents
> no longer read it.

The labels below are the suggested taxonomy this plugin assumes when you wire up label policies and templates. Replace with your own conventions; the structure (Type / Layer / Severity / Flag / Source / Cadence / Repo / Template) is the load-bearing piece.

## Required Labels (example for an engineering team)

### Type Labels (pick one)

| Label | Keywords | When to Use |
|-------|----------|-------------|
| `Type: feature` | add, implement, build, create, new | New functionality |
| `Type: improvement` | improve, optimize, refactor, enhance | Enhance existing |
| `Type: bug` | fix, broken, error, crash, not working | Defects |
| `Type: research` | research, explore, investigate, spike | Investigation |
| `Type: compliance-task` | compliance, audit, evidence, documentation | Compliance work |

### Layer Labels (pick one or more)

| Label | When to Use |
|-------|-------------|
| `Layer: frontend` | UI code (React, Vue, Svelte, etc.) |
| `Layer: backend` | API, database, server-side |
| `Layer: ai-server` | Python, LLM, agents, ML pipelines |
| `Layer: devops` | Cloud, CI/CD, Docker, infrastructure |
| `Layer: operations` | Internal processes, audits, compliance |

## Severity Labels

| Label | When to Use |
|-------|-------------|
| `Severity: Critical` | System down, data breach, security emergency |
| `Severity: High` | Major functionality broken, significant security |
| `Severity: Medium` | Moderate impact, workaround exists |
| `Severity: Low` | Minor issue, cosmetic, nice-to-have |

**SLAs:** See `sla-reference.md` for due date calculation.

## Flag Labels (optional)

| Label | When to Use |
|-------|-------------|
| `Flag: security` | Security-related — vulnerabilities, auth, encryption |
| `Flag: compliance` | SOC2, ISO27001, audit requirements |
| `Flag: Risk Accepted` | Security issues where the risk has been accepted |
| `Flag: AI-Incident` | AI-specific incident — hallucination causing harm, refusal failure, prompt-injection breach, model regression, AI-pathway data handling failure, or bias-related complaint. Used in conjunction with `Template: Security-Incident` on the Security Incidents project. Replaces a separate AI Incident Register and a separate bias-complaint log. |

## Source Labels (track origin)

| Label | When to Use |
|-------|-------------|
| `Source: Vulnerability Scan` | Automated scanning (Dependabot, Inspector) |
| `Source: CodeQL` | GitHub CodeQL alerts |
| `Source: Penetration Test` | External pentest findings |
| `Source: Internal Discovery` | Found by team internally |
| `Source: Customer Report` | Security issue from customer |
| `Source: Support Request` | General support request |
| `Source: Feature Request` | Customer feature request |
| `Source: Bug Report` | Customer bug report |

## Cadence Labels (recurring tasks)

| Label | When to Use |
|-------|-------------|
| `Cadence: Annual` | Recurring tasks every 12 months |
| `Cadence: Quarterly` | Recurring tasks every 3 months |

## Repo Labels (link issue to source repo)

Apply when an issue is scoped to one of your configured repos (see `repos.json`). Used by the curator and PR-linking automations.

| Label | Repo |
|-------|------|
| `Repo: <repo-name>` | `github.com/<your-org>/<repo>` |

## Access Labels

| Label | When to Use |
|-------|-------------|
| `Account Setup` | New user account provisioning |
| `Access Request` | New access requests |
| `Access Revocation` | User termination/offboarding |
| `Infrastructure` | DevOps work |

**SLAs:** See `sla-reference.md` for due date calculation.

## Template Labels (compliance workflows)

| Label | Template File |
|-------|---------------|
| `Template: Security-Incident` | SEC-INC-incident.md |
| `Template: Vulnerability` | SEC-VLN-vulnerability.md |
| `Template: Pentest-Finding` | SEC-PEN-pentest.md |
| `Template: Change-Standard` | CHG-STD-standard.md |
| `Template: Change-Significant` | CHG-SIG-significant.md |
| `Template: Change-Major` | CHG-MAJ-major.md |
| `Template: Access-Provision` | ACC-PRO-provision.md |
| `Template: Access-Revoke` | ACC-REV-revoke.md |
| `Template: Access-Review` | ACC-QTR-review.md |
| `Template: Privileged-Access` | ACC-PRV-privileged.md |
| `Template: Internal-Audit` | AUD-INT-internal.md |
| `Template: Management-Review` | AUD-MGT-management.md |
| `Template: Corrective-Action` | AUD-CAP-corrective.md |
| `Template: Risk-Assessment` | RSK-ASS-assessment.md |
| `Template: Vendor-Assessment` | RSK-VND-vendor.md |
| `Template: AI-Use-Case` | AI-USE-capability.md |
| `Template: Backup-Test` | OPS-BCK-backup.md |
| `Template: Data-Modification` | OPS-DAT-data-mod.md |
| `Template: Availability-Incident` | SLA-AVL-availability.md |
| `Template: Operational-Request` | SLA-OPS-operational.md |
| `Template: RCA` | RCA-DOC-root-cause.md |
| `Template: Lessons-Learned` | LRN-DOC-lessons.md |

**SLAs:** See `sla-reference.md` for due date calculation by template.

---

*Routing: `workspace-routing.md` | SLAs: `sla-reference.md`*
