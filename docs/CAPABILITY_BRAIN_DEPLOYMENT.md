# Brain Deployment Pipeline

**Capability ID**: `brain-deployment`
**Owner**: Brain
**Status**: Active (Stage 3)
**Created**: 2026-02-17

## Overview

Cecelia Brain has two deployment strategies: a zero-downtime blue-green rolling update for daily deployments, and a full deployment with migrations, self-check, tests, and auto-rollback for major releases.

## Deployment Strategies

### 1. Rolling Update (Zero-Downtime, Daily Use)

**Command**: `bash scripts/rolling-update.sh`

**Flow**:
```
[1/6] Build new image
  - bash scripts/brain-build.sh
  - Creates cecelia-brain:<version> (multi-stage, tini, non-root cecelia user)
  |
  v
[2/6] Start green container on port 5222
  - docker run -d --name cecelia-node-brain-green -e PORT=5222 ...
  - Removes stale green container from previous failed runs
  |
  v
[3/6] Health check (max 60s, 12 attempts x 5s)
  - curl http://localhost:5222/api/brain/health
  - FAIL -> auto-rollback: stop green, blue still running on 5221
  |
  v
[4/6] Wait for old tick to complete
  - Check blue container tick status
  - Wait 10s for current tick to finish
  - Prevents mid-tick interruption
  |
  v
[5/6] Stop blue container (old)
  - docker stop cecelia-node-brain
  - docker rm cecelia-node-brain
  |
  v
[6/6] Restart green as production on port 5221
  - Stop green on 5222
  - docker run -d --name cecelia-node-brain -e PORT=5221 (default) ...
  - Final verification: health check (max 60s)
  |
  v
SUCCESS: cecelia-brain v<version> is healthy on port 5221
```

**Rollback behavior**: If health check fails at step 3, green is removed and blue continues serving. If final verification fails at step 6, the script exits with error code 1 and logs point to `docker logs cecelia-node-brain`.

### 2. Full Deployment (Major Releases)

**Command**: `bash scripts/brain-deploy.sh`

**Flow**:
```
[1/7] Build image
  - bash scripts/brain-build.sh
  |
  v
[2/7] Run migrations
  - docker run --rm ... node src/migrate.js
  - Applies pending SQL migrations from brain/migrations/
  - Tracked in schema_version table
  |
  v
[3/7] Run self-check
  - docker run --rm ... node src/selfcheck.js
  - Validates: schema version, ENV_REGION, brain_config.region match
  - EXPECTED_SCHEMA_VERSION must match DB
  |
  v
[4/7] Run tests (SKIPPED in deploy, CI already validated)
  |
  v
[5/7] Record version
  - Appends version to .brain-versions (keeps last 5)
  - Used for rollback version lookup
  |
  v
[6/7] Git tag
  - Creates brain-v<version> tag (skips if exists)
  |
  v
[7/7] Start container via docker-compose
  - BRAIN_VERSION=<version> docker compose up -d
  - Health check: max 60s
  - FAIL -> auto-rollback to previous version from .brain-versions
```

**Auto-rollback**: If health check fails, the script reads the previous version from `.brain-versions` and starts that image instead.

## Quick Verification

```bash
# Health check
curl -s http://localhost:5221/api/brain/health | jq

# Full status
curl -s http://localhost:5221/api/brain/status/full | jq

# Tick status (confirms loop is running)
curl -s http://localhost:5221/api/brain/tick/status | jq '.enabled, .loop_running'

# Version check
curl -s http://localhost:5221/api/brain/health | jq '.version'
```

## Key Files

| File | Purpose |
|------|---------|
| `scripts/rolling-update.sh` | Zero-downtime blue-green deployment |
| `scripts/brain-deploy.sh` | Full deployment with migrations + rollback |
| `scripts/brain-build.sh` | Docker image build (multi-stage) |
| `docker-compose.yml` | Production compose (read-only rootfs) |
| `docker-compose.dev.yml` | Dev mode (bind mount, hot-reload) |
| `brain/src/selfcheck.js` | Schema version + region validation |
| `brain/src/migrate.js` | SQL migration runner |
| `.brain-versions` | Version history (last 5, for rollback) |
| `.env.docker` | Environment variables for container |

## Image Details

- **Base**: Node.js (multi-stage build)
- **Init**: tini (proper PID 1, signal forwarding)
- **User**: non-root `cecelia` user
- **Rootfs**: read-only in production (docker-compose.yml)
- **Tag format**: `cecelia-brain:<version>` (immutable per version)

## Container Configuration

| Setting | Production | Development |
|---------|-----------|-------------|
| Compose file | docker-compose.yml | docker-compose.dev.yml |
| Rootfs | read_only | writable |
| Volume mount | None (image only) | ./brain:/app (bind mount) |
| Restart | unless-stopped | unless-stopped |
| Network | host | host |
| Port | 5221 (default) | 5221 |
| Hot-reload | No | Yes |

## Migration Management

Migrations live in `brain/migrations/` with naming format `NNN_description.sql`:

```
brain/migrations/
  001_initial.sql
  002_add_tasks.sql
  ...
  035_latest.sql
```

- Tracked in `schema_version` table
- `selfcheck.js` validates `EXPECTED_SCHEMA_VERSION` matches DB
- Migrations run in order, idempotent (ON CONFLICT DO NOTHING where possible)

## Deployment Decision Guide

| Scenario | Use |
|----------|-----|
| Code-only change (bug fix, feature) | `rolling-update.sh` |
| Database schema change | `brain-deploy.sh` |
| First deploy on new server | `brain-deploy.sh` |
| Emergency rollback | `docker compose up -d` with previous version |
| Dev/testing | `docker-compose.dev.yml` (bind mount) |

## ENV_REGION

Both scripts respect `ENV_REGION` (defaults to `us`):

```bash
# US deployment (default)
bash scripts/rolling-update.sh

# HK deployment
ENV_REGION=hk bash scripts/rolling-update.sh
```

`selfcheck.js` validates that `ENV_REGION` matches `brain_config.region` in the database.
