# ACC-PRO: Access Provisioning

## Quick Reference
- **SLA:** Same day
- **Team:** Internal-Ops (INT-)
- **Project:** Access Provisioning

## Required Labels
- `Type: feature`
- `Account Setup` (7-day SLA)
- `Layer: devops`

## Issue Template
```markdown
## Access Provisioning Request

**Request ID:** ACC-PRO-YYYY-XXX
**Request Date:** [YYYY-MM-DD]
**Required By Date:** [Start date - access cannot be granted earlier]

## Employee/Contractor Information
- **Name:** [Full name]
- **Role/Title:** [Job title]
- **Department:** [Department/Team]
- **Manager:** [Manager name]
- **Employment Type:** [Employee / Contractor]
- **Start Date:** [YYYY-MM-DD]
- **End Date:** [If contractor - YYYY-MM-DD]

## HR Verification Checklist
- [ ] Signed employment/contractor agreement received
- [ ] IP agreement signed
- [ ] Security policy acknowledgment signed
- [ ] Background check complete (if applicable)

## Access Requirements

### System Access
| System | Access Level | Justification | Data Owner Approval |
|--------|--------------|---------------|---------------------|
| Google Workspace | [Standard/Admin] | | [ ] |
| GitHub | [Read/Write/Admin] | | [ ] |
| AWS | [Specific roles] | | [ ] |
| Linear | [Member/Admin] | | [ ] |
| Slack | [Member] | | [ ] |
| [Other] | | | [ ] |

### Privileged Access (if any)
[If elevated access needed, create linked ACC-PRV issue]

## Segregation of Duties Check
- [ ] Verified no conflicting access combinations
- [ ] No violations of separation of duties policy

## Approvals
- [ ] HR verification complete: _________________ Date: _______
- [ ] Manager approval: _________________ Date: _______
- [ ] System owner approval(s) obtained

## Provisioning Checklist
- [ ] Google Workspace account created
- [ ] Added to appropriate Google Groups
- [ ] GitHub organization membership
- [ ] AWS IAM user/role configured
- [ ] MFA enrollment required/verified
- [ ] Linear workspace access
- [ ] Slack workspace access
- [ ] Welcome email sent with access instructions
- [ ] Security training assigned

## Verification
- [ ] User confirmed access working
- [ ] Access logged in provisioning records
```
