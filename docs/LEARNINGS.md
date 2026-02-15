# Cecelia Core Learnings

> **WARNING: OBSOLETE**: Line 10的alertness.js 4级系统描述已过时，仅作历史记录保留。当前系统为5级（SLEEPING/CALM/AWARE/ALERT/PANIC），实现在 `alertness/` 目录。

开发过程中的经验总结和最佳实践。

---

### [2026-02-15] Fix Alertness System Architecture Confusion (P0)

- **Bug**: Two Alertness systems coexist and conflict, causing dispatch rate limiting to fail
  - Old System (`alertness.js`): token bucket mechanism, 4 levels (NORMAL/ALERT/EMERGENCY/COMA)
  - Enhanced System (`alertness/index.js`): percentage-based rate, 5 levels (SLEEPING/CALM/AWARE/ALERT/PANIC)
  - tick.js uses Enhanced System to decide whether to dispatch
  - BUT `dispatchNextTask()` internally uses Old System token bucket check
  - **Result**: Even when Enhanced System allows dispatch (CALM=100%), Old System token bucket still rate_limited

- **Symptom**: Manual Tick intermittently returned `rate_limited` even after PR #268 fixed Old System token bucket config
  - Enhanced System: CALM (100% dispatch rate)
  - Old System: Still in ALERT (refillRate=8/min < 12/min)
  - Diagnosis showed "System is healthy" but alertness level stuck at ALERT

- **Root Cause**: Architecture confusion from two systems running in parallel
  - Old System was not deprecated when Enhanced System was introduced (Migration 029)
  - tick.js mixed both systems:
    - Line 1191: `canDispatchEnhanced()` (Enhanced)
    - Line 1206: `getDispatchRateEnhanced()` (Enhanced)
    - Line 587: `tryConsumeToken('dispatch')` (Old) ← redundant check
  - Two systems not synchronized, causing conflicting rate limiting

- **Solution**: Remove Old System token bucket check from `dispatchNextTask()`
  - Deleted lines 586-596 in `brain/src/tick.js`
  - Removed `tryConsumeToken` from import statement
  - Now fully relies on Enhanced System dispatch rate control
  - Enhanced System already computes `effectiveDispatchMax = poolCAvailable × dispatchRate` (line 1210)

- **优化点**: Architecture migration best practices
  - **Complete migration**: When introducing a new system, deprecate the old one completely
  - **Single source of truth**: Avoid parallel systems with overlapping responsibilities
  - **Explicit deprecation**: Document which system is authoritative
  - **Gradual removal**: Remove old system checks once new system is proven stable
  - **Testing**: Verify no conflicts between old and new systems during transition

- **影响程度**: Critical (P0)
  - **Severity**: Dispatch rate limiting completely ineffective (system confusion)
  - **Duration**: Since Enhanced System introduction (Migration 029)
  - **Impact**: PR #268 fix was ineffective due to architecture confusion
  - **Fix time**: 30 minutes (once root cause identified)
  - **Tests**: 1261 tests passed after fix ✅
  - **Lesson**: Architecture debt can negate bug fixes in overlapping systems

### [2026-02-15] Fix Token Bucket Rate Limiting Configuration Defect (P0)

- **Bug**: Brain's token bucket rate limiting configuration caused systematic dispatch failure
  - Tick Loop frequency: 5 seconds = 12 ticks/minute
  - Token consumption: 12 dispatch tokens/minute
  - Token refill rate: 10 tokens/minute (NORMAL level)
  - **Net result**: -2 tokens/minute → bucket permanently depleted
  - Symptom: All dispatch attempts returned `rate_limited`, Brain couldn't dispatch any queued tasks

- **Root Cause**: Configuration mismatch between loop frequency and refill rate
  - Token bucket was designed for rate limiting, not for matching loop frequency
  - Initial configuration (refillRate=10) was too conservative
  - No monitoring/alerting for token bucket depletion
  - Problem went undetected until observed manually

- **Solution**: Adjust token bucket parameters to match system behavior
  - `_tokenBucket.dispatch`: maxTokens=20, refillRate=15 (was 10, 10, 10)
  - `LEVEL_TOKEN_RATES.NORMAL.dispatch`: 15 (was 10)
  - `LEVEL_TOKEN_RATES.ALERT.dispatch`: 8 (was 5)
  - `LEVEL_TOKEN_RATES.EMERGENCY.dispatch`: 4 (was 2)
  - Principle: refillRate must be ≥ loop frequency for normal operation
  - Reserve headroom (15 > 12) for burst capacity

- **优化点**: Token bucket design principles
  - **Normal operation**: Refill rate should match or exceed consumption rate
  - **Burst capacity**: maxTokens should allow reasonable burst (20 tokens = 100 seconds of burst)
  - **Alertness levels**: Rate limiting should slow down, not block completely
    - NORMAL: Full speed (15/min > 12/min loop)
    - ALERT: Reduce speed (8/min, still allows dispatch)
    - EMERGENCY: Minimal speed (4/min, critical operations only)
    - COMA: Complete stop (0/min)
  - **Monitoring**: Should alert when bucket stays near-empty for >5 minutes
  - **Testing**: Unit tests should verify refill rate matches expected consumption

- **影响程度**: Critical (P0)
  - **Severity**: Brain completely unable to dispatch tasks (total system failure)
  - **Duration**: Unknown (likely days, until manually discovered)
  - **Impact**: All queued tasks blocked, system appeared "stuck"
  - **Detection**: Manual observation (no automated alerting)
  - **Fix time**: 1 hour (once identified)
  - **Lesson**: Configuration bugs can cause total system failure without crashing
  - **Action item**: Add token bucket monitoring to prevent recurrence

### [2026-02-14] Skip Local Tests During Brain Deployment

- **Bug**: Brain deployment script runs local tests that conflict with running Brain service on port 5221
  - When Brain is running: `Error: listen EADDRINUSE: address already in use :::5221`
  - When Brain is stopped: Tests fail with connection errors
  - Solution: Skip local test execution during deployment since CI already validates all tests

- **优化点**: Deployment scripts should avoid duplicating CI checks
  - CI is the source of truth for test results
  - Local deployment should focus on: build → migrate → selfcheck → deploy → health check
  - Tests belong in CI, not in deployment scripts

- **影响程度**: Medium
  - Blocked deployment until fixed
  - Simple solution (skip test step)
  - No actual code quality impact (CI still validates)

### [2026-02-14] Schema Version Update Requires Version Sync

- **Bug**: .brain-versions format issue - file had two lines instead of one
  - CI script uses `tr -d '\n'` which concatenates all lines
  - Writing "1.38.0\n1.38.0\n" resulted in "1.38.01.38.0"
  - Solution: Use `jq -r .version brain/package.json > .brain-versions` (single line)
  - Root cause: Manual file writing didn't match expected format

- **优化点**: Schema version updates require multi-file sync
  - `brain/src/selfcheck.js`: EXPECTED_SCHEMA_VERSION constant
  - `brain/src/__tests__/selfcheck.test.js`: Test expectation
  - `brain/package.json`: Version bump (feat: → minor, fix: → patch)
  - `brain/package-lock.json`: Auto-synced via `npm version`
  - `.brain-versions`: Single line version via jq
  - `DEFINITION.md`: Brain 版本 and Schema 版本 fields
  - `VERSION`: Project-level version file
  - Missing any of these will fail CI (Version Check or Facts Consistency)

- **影响程度**: Low
  - Simple task (1 line code change) required 3 CI retry cycles
  - All issues caught by CI before merge
  - Clear error messages guided fixes
  - Workflow validated - /dev handled iterative CI fixes correctly

### [2026-02-14] Fix Infinite Retry on OpenAI Quota Exceeded (P0)

- **Bug**: Brain crashed due to infinite retry when OpenAI quota exceeded
  - Timeline: Migration 031 background task (10:30) → OpenAI quota exceeded (12:05) → PostgreSQL connection pool exhausted (12:57) → Brain crash (13:00)
  - Root cause chain:
    1. OpenAI API quota超限
    2. `generate-capability-embeddings.mjs` 对每个 capability 重试 3 次
    3. 23 capabilities × 3 retries = 69 API calls
    4. 后台任务失败后被重新调度
    5. 循环 1 小时高负载 → CPU 105% → PostgreSQL 连接池耗尽 → Brain 崩溃
  - Solution: Add global consecutive failure limit (3), quota error fast-fail, runtime limit (5min)
  - PR #263: Modified `openai-client.js` to detect permanent errors (quota) vs temporary errors (network)

- **优化点**: Background task retry需要保护机制
  - 永久错误（quota exceeded）应立即失败，不重试
  - 连续失败计数器防止无限循环
  - 运行时间限制防止资源耗尽
  - 区分临时错误（network）和永久错误（quota, auth）
  - Test mocking complexity: `vi.doMock()` doesn't work properly at runtime, use integration tests instead

- **影响程度**: High (P0)
  - 导致 Brain 崩溃（阻塞性）
  - 修复后系统稳定性恢复
  - 后续可以安全地运行 OKR 拆解


### [2026-02-14] Fix PORT Environment Variable Support in Brain Server

- **Bug**: Rolling update failed during deployment due to environment variable mismatch
  - Symptom: Green container health check failed after 60s, EADDRINUSE error
  - Root cause: Brain server.js only checked `BRAIN_PORT`, ignored standard Docker `PORT`
  - rolling-update.sh correctly set `PORT=5222`, but Brain defaulted to 5221
  - Result: Green and blue containers both tried to bind to 5221, causing port conflict
  - Solution: Changed server.js line 16 to `PORT || BRAIN_PORT || 5221` priority chain
  - PR #266: Simple one-line fix, backward compatible with existing BRAIN_PORT usage

- **优化点**: Environment variable naming conventions
  - Standard Docker convention uses `PORT` (not `BRAIN_PORT`)
  - Custom env vars should fallback to standard names for better compatibility
  - Priority chain: standard → custom → default ensures maximum flexibility
  - Testing deployment scripts requires real container execution, not just unit tests

- **影响程度**: High (P0)
  - Blocked zero-downtime deployment capability
  - Fixed with single line change
  - Enables future rolling updates between develop and main
  - Auto-rollback mechanism successfully protected against bad deployments
