# SLA-AVL: Platform Availability Incident

## Quick Reference
- **SLA:** 1hr-14 days (severity-based)
- **Team:** *the team that owns this workflow in your workspace*
- **Project:** Availability Incidents

## Severity Classification
| Severity | Description | Response SLA | Resolution Target |
|----------|-------------|--------------|-------------------|
| Critical | Complete outage | 1 hour | 8 hours |
| Medium | Core function impaired | 4 hours | 3 business days |
| Low | Minor issues | 1 business day | 14 business days |

## Required Labels
- `Type: bug`
- `Layer: [affected layer]`
- Severity label based on impact

## Issue Template
```markdown
## Platform Availability Incident

**Incident ID:** SLA-AVL-YYYY-XXX
**Start Time:** [YYYY-MM-DD HH:MM UTC]
**Detection Time:** [YYYY-MM-DD HH:MM UTC]
**Severity:** [Critical / Medium / Low]

## Impact Assessment
- **Services Affected:** [List affected services]
- **Users Affected:** [All / Partial - describe scope]
- **Customer Impact:** [Description of customer-facing impact]
- **Workaround Available:** [Yes - describe / No]

## Incident Description
[Brief description of the outage/issue]

## Timeline
| Time (UTC) | Event |
|------------|-------|
| | Issue started |
| | Issue detected |
| | Investigation started |
| | |

## Investigation

### Initial Assessment
[What was observed, initial hypothesis]

### Root Cause
[If identified - otherwise "Under investigation"]

### Affected Components
- [ ] Frontend
- [ ] Backend API
- [ ] Database
- [ ] AI Server
- [ ] AWS Infrastructure
- [ ] Third-party service: [Name]

## Resolution

### Actions Taken
1. [Action 1]
2. [Action 2]

### Resolution Time
- **Incident End Time:** [YYYY-MM-DD HH:MM UTC]
- **Total Duration:** [X hours Y minutes]
- **Resolution SLA Met:** [Yes / No]

## Customer Communication
- [ ] Status page updated
- [ ] Affected customers notified
- [ ] Resolution notification sent

## Follow-up Required
- [ ] Root Cause Analysis (create linked RCA-DOC if Critical/Medium)
- [ ] Preventive measures identified
- [ ] Post-mortem scheduled

## SLA Credit Assessment
- **Uptime this month:** [XX.XX%]
- **Credit applicable:** [Yes - X% / No]
```
