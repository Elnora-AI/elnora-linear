# SEC-INC: Security Incident Response

## Quick Reference
- **SLA:** 15min-72hrs (severity-based)
- **Team:** Internal-Ops (INT-)
- **Project:** Security Incidents

## Required Labels
- `Type: bug`
- `Layer: devops` or `Layer: backend`
- `Flag: security`
- `Flag: compliance`
- Severity label (see classification)

## Severity Classification
| Severity | Response Time | Post-Review | Examples |
|----------|---------------|-------------|----------|
| Sev 0 (Critical) | 15 minutes | 3 days | Data breach, full outage, active attack |
| Sev 1 (High) | 1 hour | 5 days | Partial outage, unauthorized access attempt |
| Sev 2 (Medium) | 4 hours | 10 days | Failed control, suspicious activity |
| Sev 3 (Low) | 24 hours | 20 days | Policy violation, near-miss |

## Issue Template
```markdown
## Security Incident Report

**Incident ID:** SEC-YYYY-XXX
**Date/Time Discovered:** [YYYY-MM-DD HH:MM UTC]
**Date/Time Reported:** [YYYY-MM-DD HH:MM UTC]
**Severity:** [Sev 0 / Sev 1 / Sev 2 / Sev 3]

## Classification
- **Incident Type:** [Denial of Service / Unauthorized Access / Malicious Code / Data Breach / Policy Violation / Other]
- **Affected Systems:** [List systems/services affected]
- **Data Involved:** [Yes/No - if Yes, describe data types]
- **Customer Impact:** [Yes/No - if Yes, describe impact]

## Initial Assessment
[Brief description of what happened and initial impact assessment]

## Detection Method
- [ ] Automated monitoring/alerting
- [ ] User report
- [ ] Security scan
- [ ] Third-party notification
- [ ] Other: ___

## Containment Actions Taken
- [ ] Isolated affected systems
- [ ] Preserved evidence (logs, screenshots)
- [ ] Reset compromised credentials
- [ ] Other: ___

## Timeline of Events
| Time | Event |
|------|-------|
| | |

## Escalation
- [ ] CTO notified (required for Sev 0/1)
- [ ] Legal notified (if data involved)
- [ ] Customer notification required? [Yes/No]

## Next Steps
1. [Action item]
2. [Action item]

## Resources
- Incident Response Process: `/security-compliance/incident-management/incident-response-process.md`
- RCA Template: Create linked RCA-DOC issue if Sev 0/1/2
```

## Escalation Rules
- Sev 0/1: Immediate notification to CTO
- Customer data involved: Notify Legal/CEO
- Breach determination: CEO + Legal review required
