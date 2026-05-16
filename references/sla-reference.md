# SLA Reference

Due date = today + SLA days (ISO format YYYY-MM-DD).

## Template SLA Mapping

### Immediate Response (Same Day / 24 Hours)

| Template Label | SLA | Due Date Calculation |
|----------------|-----|---------------------|
| `Template: Access-Provision` | Same day | Today |
| `Template: Privileged-Access` | Same day | Today |
| `Template: Access-Revoke` | 24 hours | Today + 1 day |
| `Template: Security-Incident` (Sev 0) | 15 minutes | Immediate |
| `Template: Security-Incident` (Sev 1) | 1 hour | Today |
| `Template: Availability-Incident` (Critical) | 1 hour | Today |

### Short-Term (1-5 Days)

| Template Label | SLA | Due Date Calculation |
|----------------|-----|---------------------|
| `Template: Change-Standard` | 1-2 days | Today + 2 days |
| `Template: Data-Modification` | 1-2 days | Today + 2 days |
| `Template: RCA` (Sev 0) | 3 days | Today + 3 days |
| `Template: Availability-Incident` (Medium) | 3 days | Today + 3 days |

### Medium-Term (5-30 Days)

| Template Label | SLA | Due Date Calculation |
|----------------|-----|---------------------|
| `Template: Change-Significant` | 5-10 days | Today + 10 days |
| `Template: AI-Use-Case` | 5-10 days | Today + 10 days |
| `Template: Corrective-Action` (Minor) | 5-30 days | Today + 30 days |
| `Template: RCA` (Sev 1) | 5 days | Today + 5 days |
| `Template: RCA` (Sev 2) | 10 days | Today + 10 days |
| `Template: Lessons-Learned` | 10-20 days | Today + 20 days |
| `Template: Availability-Incident` (Low) | 14 days | Today + 14 days |
| `Template: Change-Major` | 15-30 days | Today + 30 days |
| `Template: Operational-Request` | 3-14 days | Today + 14 days |
| `Template: RCA` (Sev 3) | 20 days | Today + 20 days |

### Long-Term (30+ Days)

| Template Label | SLA | Due Date Calculation |
|----------------|-----|---------------------|
| `Template: Access-Review` | 30 days | Today + 30 days |
| `Template: Policy-Review` | 30 days | Today + 30 days |
| `Template: Training` | 30 days | Today + 30 days |
| `Template: Management-Review` | 30 days | Today + 30 days |
| `Template: Risk-Assessment` | 30 days | Today + 30 days |
| `Template: Vendor-Assessment` | 30 days | Today + 30 days |
| `Template: Vulnerability` | 30-90 days | Based on severity |
| `Template: Pentest-Finding` | 30-90 days | Based on severity |
| `Template: Internal-Audit` | 60 days | Today + 60 days |
| `Template: Backup-Test` | RTO: 2 hours | Scheduled quarterly |

---

## Severity-Based SLAs

For security issues, SLA depends on severity:

| Severity | Vulnerability SLA | Pentest SLA | Security Incident SLA |
|----------|------------------|-------------|----------------------|
| Critical | 7 days | 7 days | 15 minutes |
| High | 14 days | 14 days | 1 hour |
| Medium | 60 days | 60 days | 4 hours |
| Low | 90 days | 90 days | 24 hours |

---

Calendar days unless specified. SLA breach → create linked AUD-CAP issue.
