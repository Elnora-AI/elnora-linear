# ACC-REV: Access Revocation

## Quick Reference
- **SLA:** 24 hours
- **Team:** *the team that owns this workflow in your workspace*
- **Project:** Access Revocation

## Required Labels
- `Type: bug` (treating as urgent remediation)
- `Access Revocation` (3-day SLA, but target 24 hours)
- `Layer: devops`

## Issue Template
```markdown
## Access Revocation Request

**Request ID:** ACC-REV-YYYY-XXX
**Request Date:** [YYYY-MM-DD HH:MM]
**DEADLINE:** [24 business hours from request]

## URGENT: Complete within 24 business hours

## Employee/Contractor Information
- **Name:** [Full name]
- **Role/Title:** [Job title]
- **Department:** [Department/Team]
- **Last Working Day:** [YYYY-MM-DD]
- **Termination Type:** [Voluntary / Involuntary / Contract End]

## Revocation Checklist

### Priority 1: Immediate (within 4 hours)
- [ ] Google Workspace account suspended
- [ ] GitHub organization membership removed
- [ ] AWS IAM access revoked
- [ ] Slack workspace deactivated
- [ ] Linear access removed
- [ ] MFA tokens invalidated
- [ ] Active sessions terminated

### Priority 2: Same Day
- [ ] Email forwarding configured (if applicable)
- [ ] Shared passwords rotated (if any known)
- [ ] Service account credentials reset (if applicable)
- [ ] VPN/remote access disabled
- [ ] API keys/tokens revoked

### Priority 3: Within 24 Hours
- [ ] Physical access/badge deactivated (if applicable)
- [ ] Forwarding rules reviewed
- [ ] Shared drive permissions audited
- [ ] Distribution list memberships removed

## Data Handover
- [ ] Manager notified of data handover requirements
- [ ] Critical data/files transferred to manager
- [ ] Email archive created (if required for retention)

## Verification
- [ ] All system access confirmed revoked
- [ ] Cannot authenticate to any system
- [ ] Revocation logged in access records

## Sign-off
- [ ] IT Verification: _________________ Date: _______ Time: _______
- [ ] HR Confirmation: _________________ Date: _______
```
