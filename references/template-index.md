# Template Index

Compliance templates for an ISO 27001 / SOC 2 audit trail. Templates route to a compliance team for documentation; actual fixes go to your engineering or security teams.

**Usage:** Match keywords below → load ONE template → check `sla-reference.md` for due date.

## Routing Table

| Keywords | Template | File | Project |
|----------|----------|------|---------|
| incident, breach, attack, compromise | SEC-INC | `templates/SEC-INC-incident.md` | Security Incidents |
| vulnerability, CVE, dependabot, codeql, security scan | SEC-VLN | `templates/SEC-VLN-vulnerability.md` | Vulnerability Management |
| pentest, penetration test finding | SEC-PEN | `templates/SEC-PEN-pentest.md` | Pentest Remediation |
| minor update, documentation fix, clarification | CHG-STD | `templates/CHG-STD-standard.md` | Standard Changes |
| control change, procedure change, risk treatment | CHG-SIG | `templates/CHG-SIG-significant.md` | Significant Changes |
| scope change, policy change, organizational change | CHG-MAJ | `templates/CHG-MAJ-major.md` | Major Changes |
| new hire, onboarding, new access, grant access | ACC-PRO | `templates/ACC-PRO-provision.md` | Access Provisioning |
| termination, offboarding, remove access, revoke | ACC-REV | `templates/ACC-REV-revoke.md` | Access Revocation |
| access review, quarterly review, permission audit | ACC-QTR | `templates/ACC-QTR-review.md` | Quarterly Access Reviews |
| admin access, root, elevated permissions, privileged | ACC-PRV | `templates/ACC-PRV-privileged.md` | Privileged Access |
| internal audit, audit planning, control audit | AUD-INT | `templates/AUD-INT-internal.md` | Internal Audits |
| management review, ISMS review, governance meeting | AUD-MGT | `templates/AUD-MGT-management.md` | Management Reviews |
| nonconformity, NC, corrective action, audit finding | AUD-CAP | `templates/AUD-CAP-corrective.md` | Corrective Actions |
| risk assessment, threat assessment, risk analysis | RSK-ASS | `templates/RSK-ASS-assessment.md` | Risk Assessments |
| vendor assessment, supplier review, third-party risk | RSK-VND | `templates/RSK-VND-vendor.md` | Vendor Assessments |
| AI use case, new AI capability, AI capability scope, model family change, foundation model swap | AI-USE | `templates/AI-USE-capability.md` | AI Governance |
| backup test, restore test, DR test | OPS-BCK | `templates/OPS-BCK-backup.md` | Backup & DR Testing |
| production data, data fix, database correction | OPS-DAT | `templates/OPS-DAT-data-mod.md` | Data Modifications |
| outage, downtime, service unavailable | SLA-AVL | `templates/SLA-AVL-availability.md` | Availability Incidents |
| infrastructure request, operational request | SLA-OPS | `templates/SLA-OPS-operational.md` | Operational Requests |
| RCA, root cause, post-mortem | RCA-DOC | `templates/RCA-DOC-root-cause.md` | Root Cause Analysis |
| lessons learned, retrospective, incident review | LRN-DOC | `templates/LRN-DOC-lessons.md` | Lessons Learned |

No match? Route per `workspace-routing.md` with standard Type + Layer labels.
