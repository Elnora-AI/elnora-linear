# elnora-linear — Settings Template

Copy this file to `.claude/elnora-linear.local.md` in your project root to customize the plugin.

```markdown
---
enabled: true
default_team: "<your-default-team>"
strict_validation: true
ask_before_creating: true
---

# elnora-linear Configuration

## Default Team
Issues are created in the default_team unless specified otherwise.
Options: see your `teams.json` reference for valid team keys/names.

## Strict Validation
When true, blocks issues missing required labels per your `label-policy.json` (e.g. Type + Layer on engineering teams).
When false, creates with warnings.

## Ask Before Creating
When true, asks user to confirm project/labels when detection is uncertain.
When false, uses best-effort detection.
```

## After Creating

Restart Claude Code for changes to take effect.
