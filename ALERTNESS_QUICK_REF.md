# Brain Alertness System - Quick Reference

## 4 Alertness Levels

```
NORMAL (0)    → Full capacity, dispatch 100%, planning enabled
  ↓
ALERT (1)     → Minor stress, dispatch 50%, planning enabled
  ↓
EMERGENCY (2) → Serious stress, dispatch 25%, planning DISABLED
  ↓
COMA (3)      → Critical state, dispatch 0%, cortex DISABLED
```

## Signal Points (Score)

| Signal | Points | Trigger |
|--------|--------|---------|
| Circuit breaker open | +30 | Repeated failures |
| High failure rate (24h) | +20 | >30% failures |
| Resource pressure | +15 | CPU/mem >70% |
| Consecutive failures | +10 ea | 3+ in a row |
| DB connection errors | +25 | Query fails |
| LLM API errors | +15 | 3+ in 1h |
| LLM bad output | +20 | 2+ parse failures |
| Seats full | +10 | All CPUs busy |
| Systemic failure | +25 | Pattern detected |

## Level Thresholds

- Score 0-19 → NORMAL
- Score 20-49 → ALERT
- Score 50-79 → EMERGENCY
- Score 80+ → COMA

## Decay & Recovery

**Decay**: Every 10 minutes, score multiplies by 0.8
- Allows system to recover after transient failures
- Exponential recovery: from COMA to NORMAL in ~90 minutes

**Recovery Stability** (minimum time at lower score before downgrade):
- COMA→EMERGENCY: 30 minutes stable
- EMERGENCY→ALERT: 15 minutes stable
- ALERT→NORMAL: 10 minutes stable

## API Endpoints

```bash
# Check current alertness
GET /api/brain/alertness

# Force re-evaluation
POST /api/brain/alertness/evaluate

# Manual override (30 min by default)
POST /api/brain/alertness/override
  { "level": 0, "reason": "Maintenance", "duration_minutes": 30 }

# Clear override
POST /api/brain/alertness/clear-override
```

## Integration Points

| Location | What It Does | Controls |
|----------|-------------|----------|
| tick.js | Evaluate every cycle | If dispatch/planning happens |
| executor.js | Collect resource signals | CPU/memory/swap metrics |
| quarantine.js | Detect systemic failures | Isolation of bad tasks |
| thalamus.js | Route events | Decides L1 vs L2 |
| cortex.js | Deep analysis | Only if cortex_enabled |
| decision-executor.js | Execute actions | Whitelist validation |

## Key Behaviors by Level

| Aspect | NORMAL | ALERT | EMERGENCY | COMA |
|--------|--------|-------|-----------|------|
| Dispatch | 100% | 50% | 25% | 0% |
| Planning | Yes | Yes | No | No |
| Cortex (Opus) | Yes | Yes | Yes | No |
| Retry | Yes | No | No | No |
| Example Score | 5 | 30 | 65 | 90 |

## Critical Files

```
/home/xx/perfect21/cecelia/core/brain/src/
  alertness.js         ← Core system (758 lines)
  tick.js              ← Uses alertness (integration point)
  executor.js          ← Provides resource signals
  quarantine.js        ← Provides failure signals
  routes.js            ← API endpoints
```

## Token Bucket Rate Limiting

3 independent token buckets with per-level refill rates:
- dispatch: 10 tokens/min (NORMAL) → 0 (COMA)
- l1_calls: 20 tokens/min (NORMAL) → 0 (COMA)
- l2_calls: 5 tokens/min (NORMAL) → 0 (COMA)

## Current Status

✅ Implemented:
- 9 signal types collected
- Level calculation with decay
- Rate limiting (token buckets)
- API endpoints
- Event logging to DB
- Behavior control (dispatch, planning, cortex)

❌ Missing:
- Response actions (notifications, escalations)
- Auto-mitigation (pause tasks, kill stale processes)
- Recovery actions (restart, re-enable)
- Audit-specific queries

## Recovery Example

```
t=0min:   score=100 (COMA) ← Circuit breaker opened
t=10min:  score=80 (COMA) ← Decay cycle 1
t=20min:  score=64 (EMERGENCY) ← Decay cycle 2
t=30min:  score=51.2 (EMERGENCY)
t=40min:  score=41 (ALERT) ← Can downgrade after 30min stable
t=50min:  score=33 (ALERT)
t=60min:  score=26 (ALERT)
t=70min:  score=21 (ALERT)
t=80min:  score=17 (NORMAL) ← Can downgrade after 10min stable
```

Total recovery: ~90 minutes from COMA to NORMAL (assuming no new errors)

