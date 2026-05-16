# AI-USE: AI Capability Scope (Use-Case Approval)

## Quick Reference
- **SLA:** 5-10 days
- **Team:** the team responsible for AI governance in your workspace (typically Internal-Ops or Security)
- **Project:** AI Governance
- **Scope:** Customer-facing AI capabilities only. Internal AI tooling (IDE assistants, agent-drafted ops emails, internal automations) is out of scope.

## When to use this template

Open an `AI-USE` ticket when any of the following is true for a customer-facing AI capability:

- A new AI capability is being added (new use case).
- An existing capability is being materially expanded — new data modality, new decision impact, autonomous action, new customer-data type, regulated-adjacent surface area.
- Foundation-model **family** is being changed for the AI Service (e.g. moving primary inference from one vendor to another). Routine version swaps within the same family do NOT require this template — they ride the normal PR review.

Required by your organization's Responsible AI Policy (see `<your-AI-policy>` reference in this repo's documentation).

## Required Labels
- `Type: compliance-task`
- `Template: AI-Use-Case`
- `Flag: compliance`
- `Flag: AI-Incident` — only if this scope record is opened in response to an AI incident

## Issue Template

```markdown
## AI Capability Scope

**Capability ID:** AI-USE-YYYY-XXX
**Capability Name:** [Short descriptive name]
**Requested By:** [Name]
**Date Requested:** [YYYY-MM-DD]
**Status:** [Proposed / Under Review / Approved / Rejected / Withdrawn]

## 1. Intended Purpose

[What this capability does and the user problem it solves. Write for a customer auditor — concrete, no marketing language.]

## 2. Users

- **Customer-side users:** [Roles, seniority, domain expertise]
- **Internal users (if any):** [e.g. customer success engineers running the capability on behalf of the customer]
- **Out-of-scope users:** [Roles or contexts explicitly NOT supported]

## 3. Data Sources

| Data source | Type | Customer Data? | Personal Data? | Notes |
|-------------|------|----------------|----------------|-------|
| [Source] | [Prompt / RAG corpus / Live retrieval / Vendor model weights] | [Y/N] | [Y/N] | [Retention, isolation, consent basis] |

## 4. Foundation Models

| Vendor | Model family | Endpoint pattern | ZDR? | Listed in your Model Vendor Register? |
|--------|--------------|------------------|------|--------------------------------------|
| | | | | |

## 5. Decision Impact

- **What does the Output inform?** [Customer-facing decision, workflow step, recommendation...]
- **Who is the human-in-the-loop?** [Role + decision they make before Output is acted on]
- **What happens if the Output is wrong?** [Realistic worst case in the customer's domain terms]
- **Is this High-Risk Use under EU AI Act Annex III or your Responsible AI Policy definition?** [Y/N + reasoning]

## 6. Refusal Patterns

[What the system declines. Reference your Acceptable Use Policy categories. Note any new refusal patterns introduced for this capability.]

## 7. Known Limitations

[Domain coverage gaps, hallucination risk areas, model-specific failure modes you've observed, latency characteristics, etc.]

## 8. Reviews

- [ ] AI Governance Owner review
- [ ] CTO / Engineering lead review
- [ ] Acceptable Use Policy: capability stays within scope
- [ ] Data Management Policy: data sources, retention, and tenant isolation align
- [ ] Third-Party Management Policy: any new vendor recorded in the Model Vendor Register
- [ ] High-Risk Use risk assessment completed (only if § 5 flagged Y)

## 9. Customer Disclosure

- [ ] Updates required to current Model Card? [Y/N — describe]
- [ ] Release notes drafted for affected customers? [Y/N — link]
- [ ] Per-customer playbook updates required? [Y/N — list customers]
- [ ] AI-generated labelling unchanged? [Y/N — describe any change]

## 10. Approval

| Role | Name | Decision | Date |
|------|------|----------|------|
| AI Governance Owner | | | |
| CTO / Engineering lead | | | |

## 11. Post-Approval Tracking

Link the implementation issue(s) and the corresponding GitHub PR(s):

- Implementation: [ISSUE-XXX]
- PR(s): [#XXX]
- Evaluation Suite results summary: [link or paste]
- Model Card updated: [link to PR or commit]
```

## Resources

- `<your-AI-policy>`: your Responsible AI Policy
- Model Vendor Register: your register of approved AI model vendors
- Acceptable Use Policy: your customer-facing AUP
- Risk Assessment template (for High-Risk Use): `RSK-ASS-assessment.md`
