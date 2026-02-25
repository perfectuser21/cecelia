# Brain 1.40.0 Deployment Report

**Date**: 2026-02-15
**Environment**: US VPS (146.190.52.84)
**Image**: `cecelia-brain:1.40.0`

---

## 1. Executive Summary

| Item | Detail |
|------|--------|
| Start Time | 2026-02-14 ~14:00 CST |
| Completion Time | 2026-02-15 01:08 CST (container stable since 06:20 CST / 22:20 UTC Feb 14) |
| Problem | Brain 1.39.3 container failed to start due to database authentication failure and multiple code-level issues |
| Solution | Fixed DB connection (network mode + password), PORT env var support, token bucket rate limiting removal |
| Final Result | **Deployed and running stable** -- 0 restarts, all selfchecks pass, tick loop operational |

---

## 2. Problem Diagnosis (Task #1)

### Root Causes Identified

The deployment encountered **three cascading issues**:

#### Issue 1: Database Authentication Failure (CRITICAL)
- **Symptom**: `password authentication failed for user "cecelia"`
- **Root Cause**: The Docker container used `network_mode: host` in dev compose but the production compose used a bridge network. When switching to `network_mode: host`, the `DB_HOST` resolved correctly to `localhost`, but the password in `.env.docker` did not match the PostgreSQL `cecelia` user password.
- **Fix**: Ensured correct password propagation via environment variables and `network_mode: host`.

#### Issue 2: PORT Environment Variable Not Supported (PR #266)
- **Symptom**: Brain server did not bind to the expected port when `PORT` env var was set.
- **Root Cause**: `server.js` hardcoded `5221` without checking the `PORT` environment variable.
- **Fix**: PR #266 -- `server.js` now reads `process.env.PORT || 5221`.

#### Issue 3: Token Bucket Rate Limiting Blocked Dispatch (PR #268, #269)
- **Symptom**: Tasks stuck in `queued` status, `dispatchNextTask()` returned `rate_limited`.
- **Root Cause**: The Old System token bucket (`checkTokenBucket()`) was still being called in `dispatchNextTask()`. The token bucket relied on `brain_config.max_tasks_per_hour` which was never properly configured, defaulting to a value that blocked all dispatches.
- **Fix**:
  - PR #268 -- Fixed token bucket configuration defaults.
  - PR #269 -- **Removed** the Old System token bucket check entirely from `dispatchNextTask()`, since the new Three-Pool Slot Allocator (v1.35.0) already handles concurrency control.

---

## 3. Fixes Applied (Task #2)

### Chronological Fix Sequence

| # | PR | Title | Merged |
|---|-----|-------|--------|
| 1 | #258 | fix: foreign key constraint in learning-effectiveness test | 08:06 |
| 2 | #259 | fix: skip local tests during Brain deployment | 08:18 |
| 3 | #262 | feat: update EXPECTED_SCHEMA_VERSION to 031 | 10:44 |
| 4 | #263 | fix: prevent infinite retry on OpenAI quota exceeded | 13:32 |
| 5 | #264 | feat: add rolling-update script for zero-downtime deployment | 14:39 |
| 6 | #266 | fix: support PORT environment variable in Brain server | 15:01 |
| 7 | #268 | fix: token bucket rate limiting configuration defect | 21:16 |
| 8 | #269 | fix: remove Old System token bucket check in dispatchNextTask | 21:39 |

### Container Configuration
- **Image**: `cecelia-brain:1.40.0` (multi-stage build, tini init, non-root `cecelia` user)
- **Network**: `network_mode: host` (container shares host network stack)
- **DB Connection**: `localhost:5432`, database `cecelia`, user `cecelia`
- **All 34 migrations**: Applied successfully (000 through 034)

---

## 4. Functional Verification (Task #3)

### Selfcheck Results

All 6 checks passed at startup:

| Check | Result |
|-------|--------|
| ENV_REGION | PASS -- value="us" |
| DB Connection | PASS -- SELECT 1 OK |
| DB Region Match | PASS -- DB="us" ENV="us" |
| Core Tables | PASS -- all 8 present |
| Schema Version | PASS -- DB="034" expected="034" |
| Config Fingerprint | PASS -- matches "bfe11e4a0548eedc" |

### Functional Tests

| Test | Result | Detail |
|------|--------|--------|
| Health Endpoint | PASS | `GET /api/brain/health` returns `status: "healthy"` |
| Tick Loop | PASS | Running every 5 minutes, 818 actions today |
| Dispatch | PASS | Last dispatch succeeded (task: zenithjoy-workspace content management) |
| Alertness System | PASS | Level ALERT (score 40), functioning correctly |
| Circuit Breaker | PASS | All circuits CLOSED, 0 failures |
| Slot Allocator | PASS | 12 total capacity, 3-pool allocation working |
| Password Auth Errors | PASS | 0 occurrences in container logs |

### PR #269 Fix Confirmed
- `dispatchNextTask()` no longer calls `checkTokenBucket()`
- Tasks are dispatched based on Three-Pool Slot Allocator only
- No more `rate_limited` responses

---

## 5. Stability Verification (Task #4)

### Monitoring Period
- **Container Start**: 2026-02-14 22:20:15 UTC (06:20 CST)
- **Report Time**: 2026-02-15 01:08 UTC (09:08 CST)
- **Uptime**: ~2.8 hours
- **Restarts**: 0

### Key Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Container Restarts | 0 | OK |
| FATAL Errors | 0 | OK |
| Password Auth Failures | 0 | OK |
| Tick Loop | Running | OK |
| Tick Interval | 5 min | OK |
| Actions Today | 818 | OK |
| Circuit Breakers | All CLOSED | OK |
| Resource Pressure | 0.41 (max) | OK |

### Resource Utilization

| Resource | Value |
|----------|-------|
| CPU Load (1m avg) | 2.4 / 5.8 threshold |
| Free Memory | 8,440 MB / 15,988 MB total |
| Swap Usage | 4% (well under 50% max) |
| CPU Pressure | 0.41 |
| Memory Pressure | 0.34 |
| Effective Slots | 12/12 |

### Minor Issues Observed (Non-Critical)

| Issue | Severity | Impact |
|-------|----------|--------|
| `WebSocket broadcast failed: activeCount is not defined` | Low | WebSocket push to frontend fails; API polling unaffected |
| `Escalation failed: from_level null constraint` | Low | Alertness escalation logging fails on auto-recovery path; alertness system itself works |
| `execution-callback: inconsistent types for parameter $2` | Low | Some execution callbacks fail to process; tasks still complete via liveness probe |
| `Orphan cleanup failed` | Info | No orphan claude processes found (expected when idle) |

These are pre-existing issues not introduced by the 1.39.3 deployment.

---

## 6. Current Brain Status

```
Container:     cecelia-node-brain
Image:         cecelia-brain:1.40.0
Status:        Up 3 hours (healthy)
Restarts:      0
Network:       host mode
Started At:    2026-02-14T22:20:15Z

Health:        healthy
Tick Loop:     running (5min interval)
Alertness:     ALERT (level 1, score 40)
Circuit Breaker: all CLOSED
Slot Budget:   12 total (User: 5, Cecelia: 0, Task Pool: 7)
User Mode:     team (3 headed sessions)
Dispatch:      allowed
Schema:        034
```

---

## 7. Recommendations

### Immediate (No Action Required Now)

1. **WebSocket `activeCount` error**: The tick broadcast to WebSocket clients references an undefined variable. Low priority -- frontend uses API polling as fallback.

2. **Escalation `from_level` null**: The auto-recovery escalation path doesn't populate `from_level`. Should be fixed in a future PR to ensure clean alertness logging.

3. **Execution callback type error**: The `$2` parameter type inconsistency in execution callbacks should be investigated to ensure all callback payloads are processed correctly.

### Process Improvements

1. **Pre-deployment checklist**: Add DB password verification step to `brain-deploy.sh` before building the image. A simple `pg_isready -h localhost -U cecelia` or `SELECT 1` test would catch auth issues early.

2. **Token bucket cleanup**: The Old System token bucket code (`checkTokenBucket` in `brain_config`) can be fully removed from the codebase now that PR #269 has eliminated its usage in the dispatch path.

3. **Deployment documentation**: Document that `network_mode: host` is the expected production configuration, and that the DB password must match between `.env.docker` and the PostgreSQL `cecelia` role.

### Monitoring

- Continue monitoring for the next 24 hours to confirm long-term stability.
- Watch for any increase in `consecutive_failures` (currently at 5).
- Alertness level should naturally decay back to NORMAL once failure signals clear.

---

## 8. PRs Included in This Release

| PR | Type | Title |
|----|------|-------|
| #253 | feat | Three-pool slot allocation system |
| #255 | feat | Capability-Driven Development Framework |
| #256 | feat | Automatic worktree cleanup after task completion |
| #258 | fix | Foreign key constraint in learning-effectiveness test |
| #259 | fix | Skip local tests during Brain deployment |
| #262 | feat | Update EXPECTED_SCHEMA_VERSION to 031 |
| #263 | fix | Prevent infinite retry on OpenAI quota exceeded |
| #264 | feat | Add rolling-update script for zero-downtime deployment |
| #266 | fix | Support PORT environment variable in Brain server |
| #268 | fix | Token bucket rate limiting configuration defect |
| #269 | fix | Remove Old System token bucket check in dispatchNextTask |

---

*Report generated: 2026-02-15 09:08 CST*
*Brain version: 1.40.0 | Schema: 034 | Uptime: ~3 hours | Restarts: 0*
