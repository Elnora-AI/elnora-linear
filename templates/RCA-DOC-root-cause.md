# RCA-DOC: Root Cause Analysis

## Quick Reference
- **SLA:** 3-20 days
- **Team:** Internal-Ops (INT-)
- **Project:** Root Cause Analysis

## Timeline by Severity
| Severity | RCA Deadline |
|----------|--------------|
| Sev 0 | 3 business days |
| Sev 1 | 5 business days |
| Sev 2 | 10 business days |
| Sev 3 | 20 business days |

## Required Labels
- `Type: research`
- `Flag: security` (if security incident)
- `Flag: compliance`
- `Layer: [affected area]`

## Issue Template
```markdown
## Root Cause Analysis

**RCA ID:** RCA-YYYY-XXX
**Incident Reference:** [Link to incident ticket]
**Incident Date:** [YYYY-MM-DD]
**RCA Completion Deadline:** [YYYY-MM-DD]

## Executive Summary
[2-3 sentence summary of incident and root cause]

## Incident Summary
- **Incident Type:** [Type]
- **Severity:** [Sev 0-3]
- **Duration:** [X hours Y minutes]
- **Impact:** [Summary of impact]

## Timeline Reconstruction
| Time | Event | Source |
|------|-------|--------|
| | | |

## Problem Statement
[Clear statement of what went wrong]

## Root Cause Analysis

### 5 Whys Analysis
1. Why did [immediate cause] happen?
   - Because [reason 1]
2. Why did [reason 1] happen?
   - Because [reason 2]
3. Why did [reason 2] happen?
   - Because [reason 3]
4. Why did [reason 3] happen?
   - Because [reason 4]
5. Why did [reason 4] happen?
   - Because [ROOT CAUSE]

### Root Cause
[Statement of the fundamental root cause]

### Contributing Factors
1. [Factor 1]
2. [Factor 2]
3. [Factor 3]

## What Went Well
- [Positive 1]
- [Positive 2]

## What Could Be Improved
- [Improvement 1]
- [Improvement 2]

## Corrective Actions

### Immediate Actions (Completed)
| Action | Owner | Status |
|--------|-------|--------|
| | | Done |

### Short-term Actions (1-2 weeks)
| Action | Owner | Target Date | Ticket |
|--------|-------|-------------|--------|
| | | | |

### Long-term Actions (1-3 months)
| Action | Owner | Target Date | Ticket |
|--------|-------|-------------|--------|
| | | | |

## Preventive Measures
[How will we prevent similar incidents in the future?]

## Lessons Learned
[Key takeaways for the team]

## Sign-off
- [ ] RCA Author: _________________ Date: _______
- [ ] Team Lead Review: _________________ Date: _______
- [ ] Management Approval: _________________ Date: _______
```
