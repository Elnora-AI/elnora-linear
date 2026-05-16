# Description template (full path)

Used by `linear-issue-creator` on the full path when the caller did not supply a description body. Fast path passes the caller's description verbatim and does not read this file.

```bash
elnora-linear issues create "Concise actionable title" \
  --team "<your-team-name>" \
  --description "$(cat <<'EOF'
## Overview
[What and why, 1–2 sentences]

## Problem Statement
[Pain point or gap]

## Proposed Solution
[Approach]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Resources
[Links if any]
EOF
)" \
  --project "Project Name" \
  --labels "Type: feature,Layer: frontend" \
  --priority 3 --assignee "<assignee>"
```

For compliance issues, replace the description body with the loaded compliance template content (from `templates/<template>.md` in this repo) as-is.
