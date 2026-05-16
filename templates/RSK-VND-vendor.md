# RSK-VND: Third-Party Vendor Assessment

## Quick Reference
- **SLA:** 30 days
- **Team:** Internal-Ops (INT-)
- **Project:** Vendor Assessments

## Required Labels
- `Type: research`
- `Flag: compliance`
- `Flag: security`
- `Layer: devops`

## Issue Template
```markdown
## Third-Party Vendor Assessment

**Assessment ID:** RSK-VND-YYYY-XXX
**Assessment Date:** [YYYY-MM-DD]
**Assessment Type:** [New Vendor / Annual Review / Change Reassessment]

## Vendor Information
- **Vendor Name:** [Company name]
- **Service Description:** [What service they provide]
- **Contract Start Date:** [If known]
- **Contract Value:** [Annual value if known]
- **Primary Contact:** [Name, email]

## Data Access Assessment
### Data Types Accessed
- [ ] Customer data
- [ ] Employee data
- [ ] Financial data
- [ ] Intellectual property
- [ ] Production systems access
- [ ] No sensitive data access

### Access Method
- [ ] Direct system access
- [ ] Data export/transfer
- [ ] API integration
- [ ] Physical access
- [ ] No direct access

## Security Assessment

### Certifications and Audits
| Certification | Status | Expiry Date | Verified |
|---------------|--------|-------------|----------|
| SOC 2 Type II | | | [ ] |
| ISO 27001 | | | [ ] |
| Other: | | | [ ] |

### Security Controls Checklist
| Control Area | Adequate? | Notes |
|--------------|-----------|-------|
| Information Security Policy | Yes/No/NA | |
| Access Control | Yes/No/NA | |
| Encryption (at rest and in transit) | Yes/No/NA | |
| Incident Response | Yes/No/NA | |
| Business Continuity | Yes/No/NA | |
| Employee Background Checks | Yes/No/NA | |
| Secure Development (if applicable) | Yes/No/NA | |
| Vulnerability Management | Yes/No/NA | |

### Documentation Reviewed
- [ ] SOC 2 Type II report
- [ ] ISO 27001 certificate
- [ ] Security questionnaire response
- [ ] Privacy policy
- [ ] Terms of service
- [ ] Data processing agreement

## Risk Assessment

### Identified Risks
| Risk | Likelihood | Impact | Risk Level | Mitigation |
|------|------------|--------|------------|------------|
| | | | | |

### Risk Level: [High / Medium / Low]

## Contractual Requirements
- [ ] NDA/CDA in place
- [ ] Data processing agreement required
- [ ] Security requirements in contract
- [ ] SLA defined
- [ ] Right to audit clause
- [ ] Exit/transition clause

## Decision

### Recommendation
- [ ] **Approve** - Vendor meets security requirements
- [ ] **Approve with Conditions** - Requires additional controls (specify below)
- [ ] **Reject** - Unacceptable security posture
- [ ] **Defer** - Requires additional information

### Conditions (if applicable)
[List any conditions that must be met]

### Risk Acceptance (if applicable)
[Document any residual risks being accepted and justification]

## Approvals
- [ ] Assessment completed by: _________________ Date: _______
- [ ] Security review by: _________________ Date: _______
- [ ] Final approval by: _________________ Date: _______

## Ongoing Monitoring
- Annual review date: [YYYY-MM-DD]
- Review trigger events: [List events that require reassessment]
```
