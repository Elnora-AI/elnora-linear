# ACC-QTR: Quarterly Access Review

## Quick Reference
- **SLA:** 30 days
- **Team:** *the team that owns this workflow in your workspace*
- **Project:** Quarterly Access Reviews

## Required Labels
- `Type: research`
- `Flag: compliance`
- `Layer: devops`

## Issue Template
```markdown
## Quarterly Access Review

**Review Period:** Q[1-4] [YYYY]
**Review Start Date:** [YYYY-MM-DD]
**Review Deadline:** [YYYY-MM-DD] (30 days from start)
**Reviewer:** [Name]

## Scope of Review
Review all user access to ensure alignment with current job roles and least privilege principle.

## Systems Under Review
- [ ] Google Workspace (accounts, groups, drive permissions)
- [ ] GitHub (organization members, repository access, team memberships)
- [ ] AWS (IAM users, roles, policies)
- [ ] Linear (workspace members, team access)
- [ ] Slack (workspace members, channel access)
- [ ] [Other systems]

## Review Checklist

### Per-System Review
For each system, verify:
- [ ] All active accounts belong to current employees/authorized contractors
- [ ] Access levels match current job responsibilities
- [ ] No terminated users still have access
- [ ] Group/team memberships are appropriate
- [ ] Privileged accounts are justified and documented

### Access Matrix Verification
| User | System | Current Access | Appropriate? | Action Needed |
|------|--------|----------------|--------------|---------------|
| | | | Yes/No | |

## Findings

### Unauthorized Access Discovered
| User | System | Issue | Corrective Action | Ticket |
|------|--------|-------|-------------------|--------|
| | | | | |

### Access Level Adjustments Needed
| User | System | Current | Should Be | Reason |
|------|--------|---------|-----------|--------|
| | | | | |

### Orphaned Accounts
| Account | System | Last Activity | Action |
|---------|--------|---------------|--------|
| | | | |

## Corrective Actions
[Create linked ACC-REV tickets for any required access removals]

## Sign-off
- [ ] Review completed by: _________________ Date: _______
- [ ] Findings reviewed by management: _________________ Date: _______
- [ ] Corrective actions assigned

## Attestation
I certify that this access review has been completed thoroughly and all findings have been documented and addressed.

Signature: _________________ Date: _______
```
