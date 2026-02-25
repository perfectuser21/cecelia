# Autonomous Task Scheduling & Dispatch

**Capability ID**: `autonomous-task-scheduling`
**Owner**: Brain
**Status**: Active (Stage 3)
**Created**: 2026-02-17

## Overview

Brain's autonomous task scheduling system selects, validates, and dispatches tasks from the PostgreSQL queue to external agent workers (Caramel, reviewer, etc.) without human intervention. The system runs on a 5-second tick loop with 5-minute execution intervals.

## End-to-End Flow

```
Tick Loop (5s heartbeat, 5min execution)
  |
  v
[1] Planner: KR Rotation Scoring
  - scoreKRs() — focus bonus, priority, urgency, queue presence
  - selectTargetKR() — pick top KR
  - selectTargetProject() — find linked project with repo_path
  - generateNextTask() — phase-aware (exploratory first, then dev)
  |
  v
[2] Pre-flight Check (pre-flight-check.js)
  - Title validation (>= 5 chars)
  - Description/PRD validation (>= 20 chars, no placeholders)
  - Priority validation (P0/P1/P2)
  - Failures recorded in task metadata, task NOT dispatched
  |
  v
[3] Slot Budget Check (slot-allocator.js)
  - Three-pool allocation: Pool A (Cecelia), Pool B (User), Pool C (Tasks)
  - Auto-calculated from hardware: min(usable_mem/500MB, usable_cpu/0.5core)
  - dispatchAllowed = Pool C has available slots
  |
  v
[4] Circuit Breaker Check (circuit-breaker.js)
  - isAllowed('cecelia-run') — per-service circuit breaker
  - Auto-opens on consecutive failures, exponential backoff reset
  |
  v
[5] Alertness Check (alertness/)
  - 5 levels: SLEEPING, CALM, AWARE, ALERT, PANIC
  - PANIC = skip everything, ALERT = reduced dispatch rate
  - getDispatchRate() throttles concurrent dispatches
  |
  v
[6] executor.js: Spawn Agent Worker
  - resolveRepoPath(projectId) — walks parent chain for Initiatives
  - preparePrompt(task) — routes by task_type (/dev, /review, /okr, etc.)
  - getModelForTask() — currently all Sonnet (cost optimization)
  - getPermissionModeForTaskType() — dev=bypassPermissions, review=plan
  - Calls cecelia-bridge (HTTP POST /trigger-cecelia on port 3457)
  - Tracks in activeProcesses Map (taskId -> {pid, runId, startedAt})
  |
  v
[7] Agent Worker Executes (external process)
  - cecelia-bridge -> cecelia-run -> claude -p "/skill ..."
  - Worker completes -> POST /api/brain/execution-callback
  |
  v
[8] Callback Processing (routes.js)
  - Updates task status (completed/failed)
  - Triggers quarantine check on failure (3 failures -> quarantine)
  - Emits event for Thalamus (L1) analysis
  - cleanupWorktree() for cp-* branches
```

## Key Files

| File | Purpose |
|------|---------|
| `brain/src/tick.js` | Tick loop engine, dispatch orchestration |
| `brain/src/planner.js` | KR rotation scoring, task selection, PR Plans dispatch |
| `brain/src/executor.js` | Process spawning, resource checks, billing pause |
| `brain/src/pre-flight-check.js` | Task quality validation before dispatch |
| `brain/src/slot-allocator.js` | Three-pool concurrency budget (Pool A/B/C) |
| `brain/src/circuit-breaker.js` | Per-service circuit breaker with auto-recovery |
| `brain/src/alertness/index.js` | 5-level alertness system, dispatch rate control |
| `brain/src/quarantine.js` | Failure classification, quarantine after 3 failures |
| `brain/src/watchdog.js` | Resource monitoring, two-stage kill (SIGTERM/SIGKILL) |
| `brain/src/task-router.js` | US/HK routing (dev/review/qa -> US, talk/data -> HK MiniMax) |

## KR Rotation Scoring (planner.js)

The planner scores all active KRs to select the next task:

| Factor | Points | Logic |
|--------|--------|-------|
| Focus KR (daily focus) | +100 | getDailyFocus() match |
| Priority P0 | +30 | Highest urgency |
| Priority P1 | +20 | Normal urgency |
| Priority P2 | +10 | Low urgency |
| Low progress | +0-20 | (100 - progress) * 0.2 |
| Deadline < 14 days | +20 | Time pressure |
| Deadline < 7 days | +20 | Additional urgency |
| Has queued tasks | +15 | Ready to dispatch |

### PR Plans Priority

Before KR rotation, the planner checks for PR Plans (engineering layer):

```
Initiative -> PR Plans (sequence order) -> Tasks
```

PR Plans have dependencies (depends_on) and are dispatched in order. This takes priority over the KR rotation flow.

## Monitoring

| Endpoint | Purpose |
|----------|---------|
| `GET /api/brain/tasks?status=queued` | View queued tasks |
| `GET /api/brain/tasks?status=in_progress` | View running tasks |
| `GET /api/brain/slots` | Pool A/B/C budget and allocation |
| `GET /api/brain/tick/status` | Tick loop state, last dispatch, alertness |
| `GET /api/brain/quarantine` | Quarantined tasks |
| `GET /api/brain/circuit-breaker` | Circuit breaker states |
| `GET /api/brain/watchdog` | Real-time RSS/CPU per process |

## Common Issues

### Task Not Dispatching

**Symptom**: Tasks queued but `last_dispatch: null`

**Check list**:
1. `prd_content IS NULL` -- pre-flight check will reject
2. `repo_path` missing on Project -- executor cannot resolve working directory
3. Circuit breaker open -- consecutive failures triggered protection
4. All slots full -- check `/api/brain/slots` for Pool C availability
5. Alertness >= ALERT -- dispatch rate throttled or disabled
6. Billing pause active -- getBillingPause() returns `{active: true}`
7. `next_run_at` in future -- task in backoff after watchdog kill

### Task Stuck in_progress

**Symptom**: Task shows in_progress but no agent process running

**Resolution**: Liveness probe (probeTaskLiveness) runs every tick:
- 1st probe failure -> mark suspect
- 2nd probe failure -> confirmed dead, auto-fail with diagnostic info
- Checks: process kill -0, task_id in ps output, run_id in ps output

### Watchdog Kills

**Symptom**: Task killed by watchdog, requeued with backoff

**Behavior**:
- Kill 1: SIGTERM -> wait 10s -> SIGKILL if needed -> requeue with exponential backoff
- Kill 2: Quarantine as `resource_hog`
- RSS threshold: min(35% total mem, 2400MB)
- 60s startup grace period

### Slot Exhaustion

**Symptom**: `dispatchAllowed: false` in slot budget

**Three pools**:
- Pool A (Cecelia): 1 internal slot (decomposition, cortex)
- Pool B (User): 2 base reserved for headed sessions
- Pool C (Task Pool): remaining capacity, throttled by pressure
- Check user mode: absent (0 headed) vs interactive (1-2) vs team (3+)

## Task Type Routing

| Type | Skill | Permission | Model | Location |
|------|-------|------------|-------|----------|
| dev | /dev | bypassPermissions | Sonnet | US |
| review | /review | plan (read-only) | Sonnet | US |
| exploratory | /exploratory | bypassPermissions | Sonnet | US |
| qa | /review | plan | Sonnet | US |
| audit | /review | plan | Sonnet | US |
| talk | /talk | bypassPermissions | - | HK MiniMax |
| research | - | bypassPermissions | - | HK MiniMax |
| data | - | - | - | HK MiniMax |
