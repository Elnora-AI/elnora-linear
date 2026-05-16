# elnora-linear

Linear workspace for Claude Code — search, bulk edit, intelligent agents, and a config-driven issue curator. This repo is both a Claude Code plugin marketplace and a standalone CLI on npm.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@elnora-ai/linear)](https://www.npmjs.com/package/@elnora-ai/linear)

## Install

Two commands plus one paste of your Linear API key:

```
/plugin marketplace add Elnora-AI/elnora-linear
/plugin install linear-workspace@elnora-linear
```

On your next Linear command (e.g. `/linear-search "issues assigned to me"`), you'll be prompted once for your Linear API key. Teams, projects, users, and workflow states are then auto-discovered from the Linear API. No wizard, no env vars, no config files to edit by hand.

Standalone (non-Claude-Code):

```
npm install -g @elnora-ai/linear
elnora-linear search "team:ENG state:in-progress"
```

## What's in the box

- **Slash commands:** `/linear-search`, `/linear-my-issues`, `/linear-bulk`, `/linear-cleanup`, `/linear-sync`, `/linear-curator-run`
- **Agents:** `linear-issue-creator`, `linear-issue-reviewer`, `linear-issue-updater`, `linear-url-to-issues`
- **Skill router:** `linear-workspace`
- **CLI:** `elnora-linear` — every command above is scriptable
- **Issue curator:** validates Linear issues against signals from your GitHub repos, Slack channels, MCP tools, or any shell command, and proposes state changes / nudges

## Configuration

All user-specific data (team prefixes, channel IDs, repo allowlists, signal sources, custom workflows) lives in `references/*.json` files that the plugin populates on first run via `linear-sync`. The JSON schemas live in [`schemas/`](schemas/). Populated files live in your own private space (default `~/.config/elnora-linear/`) — they never enter this repo.

To re-fetch teams or projects after Linear changes:

```
elnora-linear sync teams projects users
```

To enable the curator:

```
elnora-linear sync signal-sources
elnora-linear curator-run
```

## Contributing

Issues and PRs welcome. We review and merge — see [CONTRIBUTING.md](.github/CONTRIBUTING.md).

## Security

See [SECURITY.md](.github/SECURITY.md). Report vulnerabilities privately via security@elnora.ai or GitHub Security Advisories.

## License

Apache-2.0
