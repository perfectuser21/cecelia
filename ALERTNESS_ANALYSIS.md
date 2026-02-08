# Brain Alertness System - Comprehensive Analysis

## Executive Summary

The Brain's alertness system is a sophisticated **4-level self-protection mechanism** that monitors system health through multiple signals and automatically adapts behavior. It's designed to prevent system collapse under stress by gracefully degrading functionality and enabling recovery.

**Current Status**: Fully implemented with signal collection, level management, decay/recovery mechanics, and token-bucket rate limiting. **Missing**: Automated response actions triggered by alertness level changes.

---

## 1. Alertness Level Architecture

### 1.1 Four-Level Hierarchy

| Level | Name | Behavior | Dispatch | Planning | Cortex | Use Case |
|-------|------|----------|----------|----------|--------|----------|
| **0** | NORMAL | Full capacity | 100% rate | Enabled | Enabled | System healthy |
| **1** | ALERT | Cautious mode | 50% rate | Enabled | Enabled | Minor anomalies detected |
| **2** | EMERGENCY | Minimal operations | 25% rate | **Disabled** | Enabled | Serious problems, need analysis |
| **3** | COMA | Protective shutdown | **0%** | **Disabled** | **Disabled** | Catastrophic state, heartbeat only |

**File**: `/home/xx/perfect21/cecelia/core/brain/src/alertness.js` (lines 28-74)

### 1.2 Level Behaviors

```javascript
LEVEL_BEHAVIORS[level] = {
  name: string,
  description: string,
  dispatch_enabled: boolean,      // Can dispatch new tasks?
  dispatch_rate: 0.0-1.0,         // Fraction of normal dispatch speed
  planning_enabled: boolean,       // Can plan new tasks (L0 brain)?
  cortex_enabled: boolean,        // Can call Opus for deep analysis?
  auto_retry_enabled: boolean     // Can auto-retry failed tasks?
}
```

---

## 2. Signal Collection System

### 2.1 Current Signals (9 types)

| Signal | Weight | Cap | Source | Trigger Condition |
|--------|--------|-----|--------|-------------------|
| circuit_breaker_open | +30 | None | circuit-breaker.js | Breaker enters OPEN state |
| high_failure_rate | +20 | 20 | tasks table | >30% failure rate in 24h |
| resource_pressure | +15 | 15 | executor.js | OS load/memory >70% |
| consecutive_failures | +10 | 40 | tasks table (last 5) | 3+ failures in a row |
| db_connection_issues | +25 | None | pool.query catch | Database query fails |
| llm_api_errors | +15 | None | cecelia_events | 3+ API errors in 1h |
| llm_bad_output | +20 | None | cecelia_events | 2+ parse failures in 1h |
| seats_full | +10 | None | executor.js | Active processes = MAX_SEATS |
| systemic_failure | +25 | None | quarantine.js | Systemic pattern detected |

**Location**: `collectSignals()` in alertness.js (lines 222-371)

### 2.2 Failure Classification (Not counted in alertness)

External failures that DON'T trigger escalation:
- `billing_cap`: API spending limit reached
- `rate_limit`: 429 rate limiting

These are excluded from failure rate / consecutive failure signals because they're not system problems.

**Location**: quarantine.js (lines 50-114)

---

## 3. Level Thresholds & Transitions

### 3.1 Score-to-Level Mapping

```
Score Range    |  Level  |  Condition
0-19           |    0    |  All systems normal
20-49          |    1    |  ALERT: 20+ points
50-79          |    2    |  EMERGENCY: 50+ points
80+            |    3    |  COMA: 80+ points
```

**Location**: `scoreToLevel()` in alertness.js (lines 378-389)

### 3.2 Upgrades (Fast) vs Downgrades (Slow)

**Upgrade** (to higher emergency level):
- Immediate when score exceeds threshold
- No cooldown, no stability requirement
- Example: score jumps to 90 → NORMAL → COMA instantly

**Downgrade** (to lower emergency level):
- Requires **stability time** at lower score level
- Cooldown after each upgrade:
  - After ALERT: wait 5 minutes
  - After EMERGENCY: wait 15 minutes
  - After COMA: wait 30 minutes
- Stability time before allowing downgrade:
  - COMA→EMERGENCY: stable for 30 minutes
  - EMERGENCY→ALERT: stable for 15 minutes
  - ALERT→NORMAL: stable for 10 minutes

**Location**: `setLevel()` (lines 417-474), `checkRecoveryThreshold()` (lines 558-567)

---

## 4. Score Decay & Recovery System

### 4.1 How Decay Works

The system uses **exponential decay** to allow automatic recovery after transient failures:

```javascript
DECAY_INTERVAL_MS = 10 * 60 * 1000  // Every 10 minutes
DECAY_FACTOR = 0.8                   // Score multiplied by 0.8

// Example:
// t=0min:   score=100 (COMA)
// t=10min:  score=80 (COMA) — after one decay cycle
// t=20min:  score=64 (EMERGENCY)
// t=30min:  score=51.2 (EMERGENCY)
// t=40min:  score=41 (ALERT)  ← Can downgrade after recovery threshold
// t=50min:  score=33 (ALERT)
// t=60min:  score=26 (ALERT)
// t=70min:  score=21 (ALERT)
// t=80min:  score=17 (NORMAL) ← Can downgrade to NORMAL after 10min stability
```

**Algorithm** (lines 518-538):
1. Track `_accumulatedScore` and `_lastDecayAt`
2. On each evaluation, count elapsed decay cycles
3. Apply decay: `accumulatedScore *= 0.8^cycles`
4. Take max of (current raw score, decayed accumulated score)

**Key Insight**: This prevents system from being stuck in high alertness permanently when failures resolve.

---

## 5. Token Bucket Rate Limiting

### 5.1 Three Buckets

| Bucket | NORMAL | ALERT | EMERGENCY | COMA | Purpose |
|--------|--------|-------|-----------|------|---------|
| dispatch | 10/min | 5/min | 2/min | 0/min | Task dispatch calls |
| l1_calls | 20/min | 10/min | 5/min | 0/min | Sonnet LLM calls |
| l2_calls | 5/min | 3/min | 1/min | 0/min | Opus LLM calls |

### 5.2 Token Consumption Flow

```javascript
// Before dispatching a task:
const result = tryConsumeToken('dispatch');
if (result.allowed) {
  // Can dispatch
} else {
  // Rate limited: result.reason = 'rate_limited'
}
```

**Location**: `tryConsumeToken()` (lines 186-200)

---

## 6. API Endpoints

### 6.1 Current Endpoints (routes.js)

**GET /api/brain/alertness**
```json
{
  "success": true,
  "level": 1,
  "name": "ALERT",
  "behavior": { ... },
  "signals": { ... },
  "override": null,
  "last_change_at": "2026-02-07T...",
  "history": [ ... ],
  "levels": { NORMAL: 0, ALERT: 1, ... },
  "level_names": ["NORMAL", "ALERT", "EMERGENCY", "COMA"]
}
```

**POST /api/brain/alertness/evaluate**
- Forces re-evaluation of current alertness level
- Returns updated level + signals

**POST /api/brain/alertness/override**
```json
{
  "level": 0-3,
  "reason": "User requested to stabilize",
  "duration_minutes": 30
}
```
- Manually override level for duration
- Auto-reverts after duration expires
- Prevents automatic level changes during override

**POST /api/brain/alertness/clear-override**
- Clear manual override and re-evaluate

---

## 7. Integration Points

### 7.1 How Alertness Controls Behavior

**tick.js** (Task Dispatch Loop):
```javascript
import { canDispatch, canPlan, getDispatchRate } from './alertness.js';

// In executeTick():
if (!canDispatch()) {
  console.log('Dispatch disabled at ' + LEVEL_NAMES[level]);
  // No tasks dispatched this cycle
}

if (!canPlan() && queued.length === 0) {
  console.log('Planning disabled, waiting for manual intervention');
  // Don't auto-plan new tasks
}

// Rate limiting on dispatch:
for (const task of tasksToDispatch) {
  const result = tryConsumeToken('dispatch');
  if (!result.allowed) {
    break;  // Stop dispatching, rate limited
  }
  // dispatch task
}
```

**decision-executor.js**:
- L1/L2 LLM calls gated by `canUseCortex()` (L2 disabled at EMERGENCY/COMA)
- Dangerous actions require `safety=true` and pending_actions review

**executor.js** (Resource Monitoring):
```javascript
function checkServerResources() {
  // Returns: { ok, reason, metrics: { max_pressure, cpu, mem, swap } }
  // Used by collectSignals() to trigger resource_pressure signal
}
```

---

## 8. Data Persistence

### 8.1 Event Logging

All alertness changes logged to `cecelia_events` table:

```sql
INSERT INTO cecelia_events (event_type, source, payload)
VALUES (
  'alertness_change',
  'alertness',
  {
    "from": { "level": 0, "name": "NORMAL" },
    "to": { "level": 1, "name": "ALERT" },
    "reason": "Auto escalate: score=25 (raw=25)",
    "is_manual": false,
    "signals": { ... }
  }
)
```

### 8.2 Startup Recovery

On Brain startup (`initAlertness()`):
1. Query last alertness_change from DB
2. Restore previous level
3. Immediately evaluate current state
4. May stay at restored level or escalate/downgrade based on current signals

---

## 9. Current Limitations & Missing Features

### 9.1 No Active Response Actions

**Problem**: Alertness levels are calculated and can be queried, but there are no **automated response mechanisms** when levels change.

Currently:
- ✅ Signals collected every tick
- ✅ Level transitions happen automatically
- ✅ Events logged to DB
- ✅ Behavior modified (dispatch rate, planning, cortex enabled/disabled)
- ❌ **No response actions** (notifications, escalations, automated mitigations)

### 9.2 What's Missing

| Action Type | Missing | Potential Implementation |
|-------------|---------|-------------------------|
| **Notifications** | Yes | Notify users/Slack on ALERT+ |
| **Escalations** | Partial | cortex.js can analyze, but no automatic escalation trigger |
| **Auto-Mitigation** | No | Pause non-critical tasks, kill stale processes, etc. |
| **Strategy Adjustments** | No | Cortex can suggest but can't auto-adjust thresholds |
| **Quarantine Actions** | No | Auto-quarantine suspicious tasks at EMERGENCY+ |
| **Resource Release** | No | Cancel low-priority tasks to free resources |
| **Recovery Actions** | No | When recovering from COMA, auto-restart tick loop |
| **Audit Trail** | Yes | Basic logging exists, but no audit-specific views |

---

## 10. Database Schema

### 10.1 Alertness Data Storage

**cecelia_events** table (existing):
```sql
CREATE TABLE cecelia_events (
    id serial PRIMARY KEY,
    event_type text NOT NULL,      -- 'alertness_change', 'llm_api_error', etc.
    source text,                    -- 'alertness', 'thalamus', 'cortex', etc.
    payload jsonb,                  -- Signal data, level changes, etc.
    created_at timestamp DEFAULT now()
);

-- Index for fast querying
CREATE INDEX idx_cecelia_events_type_time ON cecelia_events(event_type, created_at DESC);
```

**No dedicated alertness table** — all state is in-memory + event log.

### 10.2 Quarantine Table Integration

Tasks marked as `status='quarantined'` with payload.quarantine_info:
```json
{
  "quarantine_info": {
    "quarantined_at": "2026-02-07T...",
    "reason": "repeated_failure",
    "release_at": "2026-02-07T...",  // Auto-release TTL
    "ttl_ms": 7200000
  }
}
```

---

## 11. Testing Infrastructure

### 11.1 Test Files

1. **alertness.test.js**: Core level/threshold logic
2. **alertness-token-bucket.test.js**: Rate limiting verification
3. Related: quarantine, failure-classification, chaos-hardening tests

---

## 12. Integration with Three-Layer Brain

### 12.1 Brain Hierarchy

```
L0 Brainstem (Code)
  ├─ tick.js → evaluateAlertness() every cycle
  ├─ executor.js → checkServerResources()
  ├─ quarantine.js → checkSystemicFailurePattern()
  └─ circuit-breaker.js → getState()

L1 Thalamus (Sonnet)
  └─ Routes events to appropriate handler
      └─ Can check canUseCortex() before calling Opus

L2 Cortex (Opus)
  └─ Deep analysis (only if canUseCortex() = true)
```

### 12.2 Signal Flow

```
Signals Collected (tick.js)
  ↓
evaluateAlertness()
  ├─ collectSignals()
  ├─ applyDecay()
  └─ scoreToLevel()
    ↓
setLevel() (if changed)
  ├─ Log to cecelia_events
  ├─ Emit 'alertness_change' event
  └─ Update _currentLevel
    ↓
Behavior Changes
  ├─ canDispatch() returns false at COMA
  ├─ canPlan() returns false at EMERGENCY+
  ├─ canUseCortex() returns false at EMERGENCY+
  └─ getDispatchRate() returns 0.25 at EMERGENCY
```

---

## 13. Recommended Integration Points for Response Actions

### 13.1 Hook Points (Where to Add Response Actions)

1. **In `setLevel()` after level change** (alertness.js:417)
   - Trigger response actions based on direction (upgrade/downgrade)
   - Example: NORMAL→ALERT fires "alert_escalation" actions

2. **In Tick Loop** (tick.js)
   - Check alertness level at tick start
   - Conditional dispatch based on level
   - Auto-pause/resume based on recovery

3. **In Thalamus** (thalamus.js)
   - Event router can check alertness level before deciding action
   - Example: At EMERGENCY, route to Cortex instead of quick action

4. **In Decision Executor** (decision-executor.js)
   - Block dangerous actions at high alertness
   - Require approval flow at ALERT+

5. **In Event-Bus** (event-bus.js)
   - Listen for 'alertness_change' event
   - Trigger response handlers

### 13.2 Response Action Categories

| Category | Examples | Trigger Level |
|----------|----------|----------------|
| **Notification** | Notify user, Slack alert, Discord webhook | ALERT+ |
| **Escalation** | Wake up Cortex for analysis, create incident ticket | EMERGENCY+ |
| **Auto-Mitigation** | Pause non-critical tasks, kill stale processes, request manual intervention | EMERGENCY+ |
| **Shutdown Safety** | Drain queue gracefully, save state checkpoint, notify of impending COMA | Approaching COMA |
| **Recovery** | Restart tick loop, re-enable planning, celebrate recovery | Downgrade from high level |

---

## 14. Code Locations Summary

| File | Purpose | Key Exports |
|------|---------|-------------|
| `alertness.js` | Core alertness system | getAlertness, setLevel, canDispatch, canPlan, canUseCortex, evaluateAndUpdate |
| `routes.js` | HTTP API endpoints | GET/POST /api/brain/alertness/* |
| `tick.js` | Main loop integration | evaluateAlertness() called each cycle |
| `executor.js` | Resource monitoring | checkServerResources() |
| `quarantine.js` | Failure isolation | checkSystemicFailurePattern() |
| `circuit-breaker.js` | Failure thresholds | getState() |
| `thalamus.js` | Event routing | Can check canUseCortex() |
| `cortex.js` | Deep analysis | Called only if canUseCortex() = true |
| `decision-executor.js` | Action execution | Validates against whitelist |

---

## 15. Key Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| Evaluation Frequency | Every tick (5-30s) | Configurable in tick.js |
| Signal Collection Time | <100ms | Mostly DB queries |
| Decision Latency | <1s | Just threshold comparison |
| Decay Cycle | 10 minutes | Exponential 0.8x per cycle |
| Recovery Time | 10-30+ minutes | Depends on level and stability |
| Max Concurrent Tasks | 2-12 | Dynamic based on resources |
| Token Refill Rate | Per-minute | Based on alertness level |

---

## 16. Conclusion

The Brain's alertness system is a **production-ready foundational layer** that successfully:

1. ✅ Collects diverse health signals (9+ types)
2. ✅ Calculates stress level (0-3 scale)
3. ✅ Controls system behavior (dispatch rate, LLM calls, planning)
4. ✅ Enables graceful degradation and recovery
5. ✅ Persists state for recovery after restart

**Next Phase**: Add response actions that **trigger** when levels change, enabling:
- Automated notifications and escalations
- Resource management actions (pause/cancel tasks)
- Strategic adjustments (policy changes)
- Human-in-the-loop decision points

This would complete the "self-aware system" design by having alertness not just adapt behavior, but **actively respond** to protect itself.

