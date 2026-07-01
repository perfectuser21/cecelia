# Design: Review Env SSH Escape Fix

## Problem

Brain runs inside Docker container `cecelia-node-brain`. PR #3491 added per-PR review environments (ports 5300-5399) triggered after evaluator PASS. The current implementation calls `spawnSync('bash', [reviewScript, ...])` which runs inside the container — the container has no `apps/dashboard/.dist-staging` volume mount and doesn't expose ports 5300-5399, so the review environment never actually starts.

## Fix

In `packages/brain/src/staging-e2e-runner.js` PASS block, detect the container environment and SSH-escape to the host before running `review-preview.sh`.

### Pattern

Reuse the exact SSH-escape pattern from `packages/brain/src/spawn/host-executor.js`:
- Container detection: `fs.existsSync('/.dockerenv')`
- SSH target: `administrator@host.docker.internal`
- SSH keys: `/Users/administrator/.ssh/id_ed25519` (fallback: `id_rsa`)
- PATH export: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH`
- Host repo: `process.env.CECELIA_HOST_REPO || '/Users/administrator/perfect21/cecelia'`

### Branch Conditions

| Env | Action |
|-----|--------|
| In container (`/.dockerenv` exists) | Build SSH command → exec on host |
| Not in container | Keep existing `spawnSync('bash', [...])` |

### Remote Command (SSH)

```
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH && \
bash /Users/administrator/perfect21/cecelia/scripts/review-preview.sh <port> <prNum> <distDir>
```

Where `distDir = HOST_REPO + '/apps/dashboard/.dist-staging'` (host absolute path, not container path).

### Why nohup Survives SSH Exit

`review-preview.sh` already uses `nohup node ... &` to start the slot server. When SSH client exits after the script completes (health check passes), the `nohup` process continues running on the host. This is the same guarantee used in all other host-executor.js invocations.

## Test Plan

Unit test in `packages/brain/src/__tests__/staging-e2e-runner-review-env-ssh.test.js`:
- Mock `fs.existsSync('/.dockerenv')` → `true` → verify `spawnSync` called with `ssh` + correct args
- Mock `fs.existsSync('/.dockerenv')` → `false` → verify `spawnSync` called with `bash` directly
- Mock `spawnSync` status=1 → verify warn logged, Bark NOT called
- Mock `spawnSync` status=0 → verify `sendBark` called with correct port URL

## Smoke Script

Update `packages/brain/scripts/smoke/review-env-smoke.sh` to also verify `staging-e2e-runner.js` contains `existsSync` and `host.docker.internal`.

## Files Changed

- `packages/brain/src/staging-e2e-runner.js` — PASS block SSH escape
- `packages/brain/src/__tests__/staging-e2e-runner-review-env-ssh.test.js` — new unit tests (commit-1: failing, commit-2: passing)
- `packages/brain/scripts/smoke/review-env-smoke.sh` — add SSH escape assertion
- `packages/brain/package.json` — version bump 1.235.0 → 1.236.0
