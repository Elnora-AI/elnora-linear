# OPS-DAT: Production Data Modification

## Quick Reference
- **SLA:** 1-2 days
- **Team:** *the team that owns this workflow in your workspace*
- **Project:** Data Modifications

## Required Labels
- `Type: bug`
- `Flag: security`
- `Layer: backend`

## Issue Template
```markdown
## Production Data Modification Request

**Request ID:** OPS-DAT-YYYY-XXX
**Request Date:** [YYYY-MM-DD]
**Requestor:** [Name]
**Urgency:** [Emergency / Standard]

## Modification Details
- **Database:** [Production database name]
- **Table(s):** [Affected tables]
- **Record Count:** [Estimated number of records affected]
- **Modification Type:** [UPDATE / DELETE / INSERT / Correction]

## Business Justification
[Explain why this modification is needed and why it cannot be done through the application]

## Data Description
**Records to be modified:**
[Describe the specific records - criteria for selection]

**Current State:**
[What the data looks like now]

**Desired State:**
[What the data should look like after modification]

## Pre-Modification Checklist
- [ ] Recent backup verified (within last [X] hours)
- [ ] Query tested on development database
- [ ] Peer review completed
- [ ] Rollback plan prepared

## SQL Query
```sql
-- VERIFICATION: Check records before modification
SELECT [columns]
FROM [table]
WHERE [conditions];

-- Expected affected rows: [X]

-- MODIFICATION (within transaction)
BEGIN TRANSACTION;

UPDATE/DELETE [table]
SET [columns] = [values]
WHERE [conditions];

-- Verify changes
SELECT [columns]
FROM [table]
WHERE [conditions];

-- If correct: COMMIT;
-- If incorrect: ROLLBACK;
```

## Rollback Plan
```sql
-- Rollback query if needed
[Reverse operation SQL]
```

## Approvals
- [ ] Peer review by: _________________ Date: _______
- [ ] CTO approval: _________________ Date: _______ (required)
- [ ] Data owner notification: _________________ Date: _______

## Execution Log
- **Executed by:** [Name]
- **Execution time:** [YYYY-MM-DD HH:MM]
- **Records affected:** [Actual count]
- **Transaction status:** [COMMITTED / ROLLED BACK]

## Verification
- [ ] Post-modification query run
- [ ] Results match expected outcome
- [ ] Application functionality verified
- [ ] No unintended side effects

## Documentation
- [ ] Change logged
- [ ] Audit trail preserved
```
