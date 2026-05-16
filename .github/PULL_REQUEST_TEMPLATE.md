## Summary

<!-- What does this PR do? 1-3 bullet points. -->

## PR Title Convention

> **Important:** PR titles must use [Conventional Commits](https://www.conventionalcommits.org/) format.
> Release Please parses the **squash-merge commit message** (which defaults to the PR title) to determine version bumps and changelog entries. A PR merged without a conventional prefix will not trigger a release.

| Prefix | Version bump | Example |
|--------|-------------|---------|
| `fix:` | Patch (0.0.x) | `fix: correct curator signal-source loading on empty config` |
| `feat:` | Minor (0.x.0) | `feat: add linear-cleanup --stale-since flag` |
| `feat!:` or `BREAKING CHANGE:` | Major (x.0.0) | `feat!: rename signal-source type external_command to shell_command` |
| `chore:` | No release | `chore: update dev dependencies` |
| `docs:` | No release | `docs: clarify references-dir resolution order` |
| `style:` | No release | `style: fix lint warnings` |
| `refactor:` | No release | `refactor: extract signal-source registry` |
| `test:` | No release | `test: add curator dry-run edge cases` |
| `ci:` | No release | `ci: pin actions to commit SHAs` |
| `build:` | No release | `build: drop unused esbuild dependency` |

Optional scope: `fix(curator): ...`, `feat(sync): ...`

## Testing

- [ ] `pnpm install` succeeds
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` succeeds
- [ ] `node dist/cli.js --version` and `--help` both work
- [ ] If touching signal sources: tested against a real Linear workspace
- [ ] If touching `references/` files: confirmed `_placeholder: true` is set on placeholders

## Related Issues

<!-- Link related issues: Fixes #NN, Refs #NN -->
