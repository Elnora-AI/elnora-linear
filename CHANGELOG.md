# Changelog

## [2.2.0](https://github.com/Elnora-AI/elnora-linear/compare/v2.1.3...v2.2.0) (2026-06-21)


### Features

* **issues:** resolve friendly names in batch-create + add --dry-run ([#65](https://github.com/Elnora-AI/elnora-linear/issues/65)) ([3c7ff16](https://github.com/Elnora-AI/elnora-linear/commit/3c7ff16eeaae027c9b22801883517c608b5206bc))
* **search:** add --priority filter to search command ([#62](https://github.com/Elnora-AI/elnora-linear/issues/62)) ([041c426](https://github.com/Elnora-AI/elnora-linear/commit/041c42681b4d40103f0a68cad2fc951cb6f2d58c))


### Bug Fixes

* **deps:** bump vite to 8.0.16 to resolve security advisories ([#66](https://github.com/Elnora-AI/elnora-linear/issues/66)) ([ce0c195](https://github.com/Elnora-AI/elnora-linear/commit/ce0c195bcc98c6c11cf973cab72714384cf2bc5a))

## [2.1.3](https://github.com/Elnora-AI/elnora-linear/compare/v2.1.2...v2.1.3) (2026-05-25)


### Miscellaneous Chores

* trigger 2.1.3 release ([#47](https://github.com/Elnora-AI/elnora-linear/issues/47)) ([b769e4c](https://github.com/Elnora-AI/elnora-linear/commit/b769e4c2da95b7e7df0840f8c2836ec0ac88e078))

## [2.1.2](https://github.com/Elnora-AI/elnora-linear/compare/v2.1.1...v2.1.2) (2026-05-25)


### Bug Fixes

* **deps:** bump runtime and dev dependencies ([#44](https://github.com/Elnora-AI/elnora-linear/issues/44)) ([95a5c2e](https://github.com/Elnora-AI/elnora-linear/commit/95a5c2ee0e7cad1b8092d7d54f7cba41a5446705))

## [2.1.1](https://github.com/Elnora-AI/elnora-linear/compare/v2.1.0...v2.1.1) (2026-05-17)


### Bug Fixes

* make archive/restore round-trip work + tighten customer-need + batch help text ([#36](https://github.com/Elnora-AI/elnora-linear/issues/36)) ([c620eb7](https://github.com/Elnora-AI/elnora-linear/commit/c620eb7a633175db221fc9f4a7d92cfb22604cac))
* **sync:** preserve manually-curated fields across resync ([#35](https://github.com/Elnora-AI/elnora-linear/issues/35)) ([591cc50](https://github.com/Elnora-AI/elnora-linear/commit/591cc5023e06e99e946dbca51656cd02df998007))

## [2.1.0](https://github.com/Elnora-AI/elnora-linear/compare/v2.0.0...v2.1.0) (2026-05-17)


### Features

* 'elnora-linear curator-slack-bridge' subcommand + ship bridges/ in tarball ([#34](https://github.com/Elnora-AI/elnora-linear/issues/34)) ([97ceb2e](https://github.com/Elnora-AI/elnora-linear/commit/97ceb2e15338787d0d26c83be5d23ab1482979ed))
* **bridges:** Slack bridge for the curator ([#33](https://github.com/Elnora-AI/elnora-linear/issues/33)) ([8fa9265](https://github.com/Elnora-AI/elnora-linear/commit/8fa92655f06096aee3ab9f41624ac3b1ab52d20a))


### Bug Fixes

* **curator:** robust LLM JSON parsing + bigger max_tokens ([#31](https://github.com/Elnora-AI/elnora-linear/issues/31)) ([c43db54](https://github.com/Elnora-AI/elnora-linear/commit/c43db548ca1614c64e92836ea1c862bb9e7870ce))

## [2.0.0](https://github.com/Elnora-AI/elnora-linear/compare/v1.1.0...v2.0.0) (2026-05-16)


### ⚠ BREAKING CHANGES

* bulk creation paths (`issues batch-create`, `issues bulk-ops` create) now exit 2 with ProjectValidationError when a target team has projects available and the input/op lacks a project. This matches cc9566e's flip on `issues create`. Migration:   - Add `--project` / `projectId` / `project` to every create input     going to a team with projects, OR   - Set `requiresProject: false` for teams that legitimately have     unassigned issues in `references/label-policy.json`, OR   - Pass `--skip-project-check` per-call (CLI) or `skipProjectCheck:     true` per-op (bulk-ops) for placeholder issues.

### Features

* enforce require-project on bypass routes + close install-guide curator gaps ([#28](https://github.com/Elnora-AI/elnora-linear/issues/28)) ([5521e8c](https://github.com/Elnora-AI/elnora-linear/commit/5521e8c15901272dd010f21929d6f65788771957))
* require a project on issues create by default + auto-sync postinstall + universal AGENTS.md ([#26](https://github.com/Elnora-AI/elnora-linear/issues/26)) ([92a4f26](https://github.com/Elnora-AI/elnora-linear/commit/92a4f26b9d71441fe411e0720831259c76b21c02))

## [1.1.0](https://github.com/Elnora-AI/elnora-linear/compare/v1.0.1...v1.1.0) (2026-05-16)


### Features

* parity with private linear-workspace plugin (Tracks A-D) ([#21](https://github.com/Elnora-AI/elnora-linear/issues/21)) ([cf3621b](https://github.com/Elnora-AI/elnora-linear/commit/cf3621b69c08a38821dd5bdb7aaf00f1120d5030))


### Bug Fixes

* pre-public hardening followup — curator, auth, command gates, batch docs ([#24](https://github.com/Elnora-AI/elnora-linear/issues/24)) ([457fd23](https://github.com/Elnora-AI/elnora-linear/commit/457fd23027c38e1a5cb8761003f992b5c9591e69))

## [1.0.1](https://github.com/Elnora-AI/elnora-linear/compare/v1.0.0...v1.0.1) (2026-05-16)


### Bug Fixes

* pre-public audit cleanup — correctness, validation, hardening ([#19](https://github.com/Elnora-AI/elnora-linear/issues/19)) ([5592ba6](https://github.com/Elnora-AI/elnora-linear/commit/5592ba67133653d1fb8d16bf111849fa95e2599d))

## 1.0.0 (2026-05-16)


### Features

* agents + slash commands + linear-workspace skill ([#13](https://github.com/Elnora-AI/elnora-linear/issues/13)) ([cf350ac](https://github.com/Elnora-AI/elnora-linear/commit/cf350ace534de6a6658b9b2c801a42bbf9cc8ae0))
* bulk + cleanup commands with dry-run safety ([#10](https://github.com/Elnora-AI/elnora-linear/issues/10)) ([1b9e332](https://github.com/Elnora-AI/elnora-linear/commit/1b9e33228dad92e78b732cf1d12a2226c2cd4c02))
* **ci:** add release.yml — publish to npm via OIDC on GitHub release ([#15](https://github.com/Elnora-AI/elnora-linear/issues/15)) ([cb52372](https://github.com/Elnora-AI/elnora-linear/commit/cb52372d97d7088146edbc5d46937c97bd3bde5c))
* config layer — types, loader, schema validation, tests ([#8](https://github.com/Elnora-AI/elnora-linear/issues/8)) ([40c4f7a](https://github.com/Elnora-AI/elnora-linear/commit/40c4f7a3f8cc8d990833c8eac1f7c09f6929a140))
* curator-run + signal-source registry + external_command source ([#12](https://github.com/Elnora-AI/elnora-linear/issues/12)) ([6fccb47](https://github.com/Elnora-AI/elnora-linear/commit/6fccb476acf7a6904d8e69166fd8e736a84c4020))
* scaffold reference data — schemas, placeholders, examples, no-populated-references CI check ([#7](https://github.com/Elnora-AI/elnora-linear/issues/7)) ([e2dcc15](https://github.com/Elnora-AI/elnora-linear/commit/e2dcc15c7ac3ea6b67527f23037af3ee22491a1c))
* search + my-issues commands, Linear client, API key auth, output formatter ([#9](https://github.com/Elnora-AI/elnora-linear/issues/9)) ([f0893e4](https://github.com/Elnora-AI/elnora-linear/commit/f0893e47f1ee8ec9e04210369a6a23be7271973c))
* sync command — auto-discover teams/projects/users/workflows from Linear ([#11](https://github.com/Elnora-AI/elnora-linear/issues/11)) ([9721027](https://github.com/Elnora-AI/elnora-linear/commit/9721027712a36af321c7609c7c0b36d545849295))


### Bug Fixes

* **ci:** switch release.yml from OIDC to NPM_TOKEN ([#18](https://github.com/Elnora-AI/elnora-linear/issues/18)) ([b67bcde](https://github.com/Elnora-AI/elnora-linear/commit/b67bcde6b59ba8919174d82c25494a70a7a97ce1))
* **ci:** use org-level RELEASE_BOT_PAT for Release Please ([#14](https://github.com/Elnora-AI/elnora-linear/issues/14)) ([a83d6db](https://github.com/Elnora-AI/elnora-linear/commit/a83d6db75db141e2a6f81aff46574fac9f87628e))
* **ci:** use per-repo RELEASE_TOKEN for Release Please ([#16](https://github.com/Elnora-AI/elnora-linear/issues/16)) ([2fe0cd5](https://github.com/Elnora-AI/elnora-linear/commit/2fe0cd5ed66ccaf304bc30fe5da1bec020e0f127))
* remove internal staging path and sibling-repo reference ([#6](https://github.com/Elnora-AI/elnora-linear/issues/6)) ([b7a4053](https://github.com/Elnora-AI/elnora-linear/commit/b7a4053e30b9118cdb1f225e410066f4c19973ff))

## Changelog

All notable changes to `@elnora-ai/linear` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/). Releases are produced by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org/).
