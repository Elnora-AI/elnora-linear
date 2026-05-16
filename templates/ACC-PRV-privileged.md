# ACC-PRV: Privileged Access Request

## Quick Reference
- **SLA:** Same day
- **Team:** *the team that owns this workflow in your workspace*
- **Project:** Privileged Access

## Required Labels
- `Type: feature`
- `Flag: security`
- `Layer: devops`
- `Access Request`

## Issue Template
```markdown
## Privileged Access Request

**Request ID:** ACC-PRV-YYYY-XXX
**Request Date:** [YYYY-MM-DD]
**Urgency:** [Urgent / Standard]

## Requestor Information
- **Name:** [Full name]
- **Role:** [Job title]
- **Department:** [Team]
- **Manager:** [Manager name]

## Access Details
- **System:** [System requiring privileged access]
- **Privilege Level:** [Specific privilege - admin, root, etc.]
- **Current Access:** [What access user currently has]
- **Requested Access:** [Specific new privileges needed]

## Business Justification
[Detailed explanation of why privileged access is needed]

## Duration
- **Access Type:** [Temporary / Permanent]
- **Start Date:** [YYYY-MM-DD]
- **End Date:** [YYYY-MM-DD or "Ongoing until role change"]
- **Revocation Trigger:** [What event should trigger access removal]

## Competency Verification
- [ ] User has completed security training
- [ ] User understands privileged access responsibilities
- [ ] User acknowledges logging of all privileged actions

## Security Requirements
- [ ] MFA will be configured for privileged access
- [ ] Access will be time-bound when possible
- [ ] All privileged actions will be logged

## Approvals
- [ ] Manager approval: _________________ Date: _______
- [ ] System owner approval: _________________ Date: _______
- [ ] Security review (for admin/root): _________________ Date: _______

## Provisioning
- [ ] Privileged access configured
- [ ] MFA verified active
- [ ] User notified of access and responsibilities
- [ ] Access logged in privileged account register

## Review Schedule
Next review date: [Date - privileged access reviewed quarterly]
```
