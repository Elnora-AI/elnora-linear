# SLA-OPS: Operational Request

## Quick Reference
- **SLA:** 3-14 days
- **Team:** *the team that owns this workflow in your workspace*
- **Project:** Operational Requests

## Priority to SLA Mapping
| Priority | Resolution Timeframe |
|----------|---------------------|
| High | 3 days |
| Medium | 7 days |
| Low | 14 days |

## Required Labels
- `Type: feature`
- `Layer: devops`
- `Infrastructure` (if infrastructure work)
- `Account Setup` (if account work)

## Issue Template
```markdown
## Operational Request

**Request ID:** SLA-OPS-YYYY-XXX
**Request Date:** [YYYY-MM-DD]
**Requestor:** [Name]
**Priority:** [High / Medium / Low]
**SLA Deadline:** [YYYY-MM-DD]

## Request Type
- [ ] Infrastructure provisioning
- [ ] Account setup
- [ ] Configuration change
- [ ] Access modification
- [ ] Other: ___

## Request Details
[Detailed description of what is being requested]

## Business Justification
[Why is this request needed?]

## Requirements
[Specific technical requirements]

## Dependencies
- [ ] [Dependency 1]
- [ ] [Dependency 2]

## Implementation Plan
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Verification Criteria
- [ ] [How to verify completion]

## Approvals
- [ ] Manager approval: _________________ Date: _______
- [ ] Technical approval (if needed): _________________ Date: _______

## Completion
- [ ] Request fulfilled
- [ ] Requestor notified
- [ ] Documentation updated

**Completion Date:** [YYYY-MM-DD]
**SLA Met:** [Yes / No]
```
