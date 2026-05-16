# OPS-BCK: Backup Restore Test

## Quick Reference
- **SLA:** RTO: 2 hours
- **Team:** Internal-Ops (INT-)
- **Project:** Backup & DR Testing

## Required Labels
- `Type: research`
- `Flag: compliance`
- `Layer: devops`

## Issue Template
```markdown
## Backup Restore Test

**Test ID:** OPS-BCK-YYYY-QX
**Test Date:** [YYYY-MM-DD]
**Quarter:** Q[1-4] [YYYY]
**Test Type:** [RDS Snapshot / RDS Point-in-Time / S3 Version / Full DR Simulation]

## Recovery Objectives
- **RTO (Recovery Time Objective):** 2 hours
- **RPO (Recovery Point Objective):** 15 minutes

## Test Scope
- [ ] RDS PostgreSQL Database
- [ ] S3 Production Bucket
- [ ] ECR Container Images (Q4 only)
- [ ] ECS Task Definitions (Q4 only)

## Pre-Test Checklist
- [ ] Test environment prepared
- [ ] Backup source identified (snapshot ID or timestamp)
- [ ] Test plan reviewed
- [ ] Rollback plan ready

## Test Execution

### Test 1: [Test Type]
**Start Time:** [HH:MM]
**End Time:** [HH:MM]
**Recovery Time:** [XX minutes]

**Steps Performed:**
1. [ ] [Step 1]
2. [ ] [Step 2]
3. [ ] [Step 3]

**Validation Queries:**
```sql
-- Record counts
SELECT COUNT(*) FROM [table];

-- Recent data check
SELECT * FROM [table] WHERE created_at > NOW() - INTERVAL '7 days' LIMIT 5;

-- Data integrity
[Specific integrity checks]
```

**Results:**
| Check | Expected | Actual | Pass/Fail |
|-------|----------|--------|-----------|
| Recovery time | < 2 hours | | |
| Data present | Yes | | |
| No data loss beyond RPO | < 15 min | | |
| Integrity checks | Pass | | |

## Cleanup
- [ ] Test instances terminated
- [ ] Test data removed
- [ ] Costs verified

## Issues Encountered
| Issue | Impact | Resolution | Follow-up Needed |
|-------|--------|------------|------------------|
| | | | |

## Results Summary
- **Overall Result:** [PASS / FAIL]
- **Recovery Time Achieved:** [XX minutes]
- **Data Loss:** [None / XX minutes]
- **RTO Met:** [Yes / No]
- **RPO Met:** [Yes / No]

## Corrective Actions
[Create linked tickets if any issues found]

## Sign-off
- [ ] Test performed by: _________________ Date: _______
- [ ] Results verified by: _________________ Date: _______
- [ ] CTO approval: _________________ Date: _______

## Evidence
- [ ] Screenshots captured
- [ ] Logs preserved
- [ ] Notion Restore Test Record updated
```
