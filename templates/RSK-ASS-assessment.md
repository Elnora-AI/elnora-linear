# RSK-ASS: Risk Assessment

## Quick Reference
- **SLA:** 30 days
- **Team:** Internal-Ops (INT-)
- **Project:** Risk Assessments

## Required Labels
- `Type: research`
- `Flag: compliance`
- `Flag: security`
- `Layer: devops`

## Issue Template
```markdown
## Risk Assessment

**Assessment ID:** RSK-ASS-YYYY-XXX
**Assessment Date:** [YYYY-MM-DD]
**Assessment Type:** [Annual / Triggered / Ad-hoc]
**Trigger:** [Annual schedule / Organizational change / Technology change / Incident / Other]

## Scope
[Define what's being assessed - full ISMS, specific system, specific process]

## Assessment Team
- **Lead:** [Name]
- **Participants:** [Names]

## Methodology
- Risk assessment framework: [e.g., ISO 27005]
- Likelihood scale: [1-5 or Low/Medium/High]
- Impact scale: [1-5 or Low/Medium/High]
- Risk calculation: [Likelihood x Impact]

## Asset Inventory
| Asset | Type | Owner | Criticality |
|-------|------|-------|-------------|
| | | | |

## Threat Identification
| Threat | Source | Target Assets |
|--------|--------|---------------|
| | | |

## Vulnerability Assessment
| Vulnerability | Affected Assets | Current Controls |
|---------------|-----------------|------------------|
| | | |

## Risk Register
| Risk ID | Risk Description | Asset | Threat | Vulnerability | Likelihood | Impact | Risk Level | Treatment |
|---------|------------------|-------|--------|---------------|------------|--------|------------|-----------|
| | | | | | | | | |

## Risk Evaluation

### High Risks Requiring Treatment
| Risk ID | Risk | Current Level | Treatment Decision |
|---------|------|---------------|-------------------|
| | | | |

### Accepted Risks
| Risk ID | Risk | Level | Justification for Acceptance |
|---------|------|-------|------------------------------|
| | | | |

## Risk Treatment Plan
[Create linked issues for each risk requiring treatment]

| Risk ID | Treatment | Control(s) | Owner | Target Date | Status |
|---------|-----------|------------|-------|-------------|--------|
| | | | | | |

## Residual Risk Assessment
| Risk ID | Original Level | After Treatment | Acceptable? |
|---------|----------------|-----------------|-------------|
| | | | |

## Statement of Applicability Impact
[Document any changes needed to SoA based on this assessment]

## Sign-off
- [ ] Risk Assessment completed by: _________________ Date: _______
- [ ] Reviewed by ISMS Governance Council: _________________ Date: _______
- [ ] Risk Treatment Plan approved: _________________ Date: _______
```
