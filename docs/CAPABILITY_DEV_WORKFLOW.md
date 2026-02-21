# /dev Unified Development Workflow

**Capability ID**: `dev-workflow`
**Owner**: Brain + Engine
**Status**: Active (Stage 3)
**Created**: 2026-02-17

## Overview

The `/dev` workflow is Cecelia's end-to-end development pipeline. It takes a task from PRD through code, test, quality check, PR creation, CI verification, and merge -- fully automated via Stop Hook loops that continue until the PR is merged or a blocking issue occurs.

## End-to-End Flow

```
[1] Trigger
  - User says "想做 X" -> /plan识别 -> /dev 开始
  - OR Cecelia auto-dispatches via Tick Loop (executor.js -> /dev skill)
  |
  v
[2] Branch + PRD + DoD Initialization
  - Create cp-* branch from develop (e.g., cp-02170930-abc123)
  - Generate .prd.md (PRD: requirements, scope, constraints)
  - Generate .dod.md (DoD: acceptance criteria checklist)
  - Branch protect hook enforces: must be on cp-*/feature/* with valid PRD+DoD
  |
  v
[3] Code Implementation
  - Read PRD, understand requirements
  - Write code changes
  - Write/update tests (Vitest)
  - Run tests locally: npm test
  |
  v
[4] Quality Check
  - DevGate scripts:
    - facts-check.mjs (8 code facts vs DEFINITION.md)
    - check-version-sync.sh (package.json/lock/brain-versions/DEFINITION.md)
    - check-dod-mapping.cjs (DoD -> Test mapping)
  - Self-check: node src/selfcheck.js
  |
  v
[5] PR Creation
  - git add + commit (specific files, not -A)
  - git push origin cp-* branch
  - gh pr create --base develop --title "..." --body "..."
  |
  v
[6] CI Verification (GitHub Actions)
  - 6 jobs: Version Check, Facts Consistency, Brain (Node.js),
    Semantic Brain (Python), ci-passed, notify-failure
  - Required checks: Brain, Semantic Brain, Version Check
  - If CI fails -> read logs -> fix -> push -> re-check (Stop Hook loop)
  |
  v
[7] Merge
  - gh pr merge --squash (into develop)
  - Clean up: delete cp-* branch (local + remote)
  - Stop Hook exits cleanly (exit 0)
  |
  v
[8] Callback (if dispatched by Cecelia)
  - POST /api/brain/execution-callback
  - Update task status: completed/failed
  - cleanupWorktree() for cp-* branches
```

## Stop Hook Loop Mechanism

The Stop Hook (`hooks/stop.sh`) is the key automation mechanism. It runs after every Claude Code session exit:

```
Claude Code exits
  |
  v
Stop Hook evaluates:
  - PR exists? -> Check CI status
  - CI passed? -> Check if merged
  - Merged? -> exit 0 (done)
  - Not merged? -> exit 2 (continue)
  - CI failed? -> exit 2 (continue - fix and retry)
  - No PR? -> exit 2 (continue - need to create PR)
```

**Exit codes**:
- `0` = Task complete, stop
- `1` = Error, stop
- `2` = Not done yet, continue (loop back to Claude Code)

This creates an autonomous loop: write code -> push -> CI -> fix if needed -> push again -> until merged.

## Branch Protection

### Local Protection (PreToolUse Hook)

The `branch-protect.sh` hook blocks code file writes when:
1. On `main` or `develop` branch (must be on cp-* or feature/*)
2. On cp-*/feature/* but missing `.prd.md` or `.dod.md`
3. PRD/DoD files are invalid (empty or wrong format)

### Remote Protection (GitHub Branch Protection)

| Branch | Rules |
|--------|-------|
| main | No direct push, PR required, CI must pass, no force push, enforce_admins: true |
| develop | No direct push, PR required, CI must pass, no force push, enforce_admins: true |

## CI DevGate (GitHub Actions)

6 jobs run on every PR:

| Job | What it checks |
|-----|---------------|
| Version Check | package.json version incremented |
| Facts Consistency | 8 code facts match DEFINITION.md |
| Brain (Node.js) | Unit tests (Vitest), lint |
| Semantic Brain (Python) | Python semantic tests |
| ci-passed | Gate job, requires all above |
| notify-failure | Slack notification on failure |

**Required checks** for merge: `Brain (Node.js)`, `Semantic Brain (Python)`, `Version Check`

## Key Files

| File | Location | Purpose |
|------|----------|---------|
| `/dev` skill | `~/.claude/skills/dev/SKILL.md` | Full workflow definition |
| Stop Hook | `hooks/stop.sh` (per repo) | Loop mechanism |
| Branch protect | `hooks/branch-protect.sh` | PreToolUse hook |
| facts-check | `scripts/facts-check.mjs` | Code facts validation |
| version-sync | `scripts/check-version-sync.sh` | Version consistency |
| dod-mapping | `scripts/devgate/check-dod-mapping.cjs` | DoD-to-test mapping |
| CI workflow | `.github/workflows/ci.yml` | GitHub Actions pipeline |

## Trigger Mechanisms

### Manual (User-initiated)

User invokes `/dev` directly in Claude Code with a task description. The workflow handles everything from branch creation to merge.

### Automated (Cecelia-dispatched)

1. `tick.js` selects a queued task via `planNextTask()`
2. `executor.js` generates prompt with `/dev` skill prefix
3. `cecelia-bridge` spawns headless `claude -p "/dev ..."` process
4. Stop Hook loops until PR is merged
5. On completion, agent calls `POST /api/brain/execution-callback`

### Key Differences

| Aspect | Manual | Automated |
|--------|--------|-----------|
| Branch naming | cp-MMDDHHMI-* | cp-<task_id_prefix>-* |
| Permission mode | Interactive | bypassPermissions |
| Stop Hook | Same loop | Same loop |
| Callback | None | POST execution-callback |
| Model | User's choice | Sonnet (cost optimization) |

## Common Patterns

### Fix CI Failure Loop

```
Push -> CI fails -> Stop Hook exit 2
-> Claude reads `gh run view --log-failed`
-> Fixes issue -> Push again
-> CI passes -> Merge -> Stop Hook exit 0
```

### Version Bump Required

CI `Version Check` requires incrementing `brain/package.json` version. The workflow auto-bumps patch version when needed.

### Pre-commit Hook Failure

If pre-commit hook fails, the commit did NOT happen. The workflow creates a NEW commit (never `--amend`, which would modify previous commit).

## Monitoring

| What | How |
|------|-----|
| Active dev tasks | `GET /api/brain/tasks?status=in_progress&task_type=dev` |
| Task logs | `tail -f /tmp/cecelia-<task_id>.log` |
| CI status | `gh run list --branch <branch> --limit 1` |
| PR status | `gh pr list --state open` |
