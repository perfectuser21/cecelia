# Version Management

This document describes the versioning strategy for Cecelia Workspace monorepo.

## Semantic Versioning

We follow [Semantic Versioning 2.0.0](https://semver.org/). Version numbers have the format `MAJOR.MINOR.PATCH`:

- **MAJOR**: Incompatible API changes (breaking changes)
- **MINOR**: New functionality in a backward-compatible manner
- **PATCH**: Backward-compatible bug fixes

## Commit Types and Version Bumps

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `fix:` | PATCH (+0.0.1) | `1.0.0` → `1.0.1` |
| `feat:` | MINOR (+0.1.0) | `1.0.0` → `1.1.0` |
| `feat!:` or `BREAKING:` | MAJOR (+1.0.0) | `1.0.0` → `2.0.0` |

### Other Commit Types (No Version Bump)

- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test changes
- `chore:` - Maintenance tasks

## Workflow

### When Merging to Develop

1. Determine version bump based on changes
2. Update `package.json` version:
   ```bash
   cd apps/core
   npm version minor --no-git-tag-version
   ```
3. Update `CHANGELOG.md`
4. Commit with appropriate prefix

### When Releasing (develop → main)

1. Create git tags:
   ```bash
   git tag -a core-v1.2.0 -m "Release @cecelia/core v1.2.0"
   git push origin --tags
   ```
2. Create GitHub Release

## Independent Versioning

Each app versions independently:
- `apps/core/` → `@cecelia/core` → `core-v*` tags
- `apps/dashboard/frontend/` → `@cecelia/autopilot-frontend` → `frontend-v*` tags

## Examples

**Bug Fix (Patch)**:
```bash
npm version patch  # 1.0.0 → 1.0.1
git commit -m "fix: resolve timeout issue"
```

**New Feature (Minor)**:
```bash
npm version minor  # 1.0.0 → 1.1.0
git commit -m "feat: add dashboard widget"
```

**Breaking Change (Major)**:
```bash
npm version major  # 1.0.0 → 2.0.0
git commit -m "feat!: rename API endpoint

BREAKING CHANGE: /api/old is now /api/new"
```

## References

- [Semantic Versioning](https://semver.org/)
- [Keep a Changelog](https://keepachangelog.com/)
- [Conventional Commits](https://www.conventionalcommits.org/)
