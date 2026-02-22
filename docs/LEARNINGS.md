# Cecelia Core Learnings

> **WARNING: OBSOLETE**: Line 10的alertness.js 4级系统描述已过时，仅作历史记录保留。当前系统为5级（SLEEPING/CALM/AWARE/ALERT/PANIC），实现在 `alertness/` 目录。

开发过程中的经验总结和最佳实践。

---

### [2026-02-22] OKR 拆解质量治理 v1.59.0

- **Bug**: 中文测试描述长度不够 MIN_DESCRIPTION_LENGTH (100字符)，导致测试失败。质量门禁验证字符串时要确保测试数据足够长。
- **优化点**: decomposition_depth 用 COALESCE 默认值处理存量数据，无需回填所有记录
- **架构决策**: KR 进度计算采用双触发（initiative 关闭时 + tick 每小时同步），确保实时性和最终一致性
- **影响程度**: High — 解决了拆解无限递归、任务质量差、KR 进度永远为 0 三个系统性问题

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


### [2026-02-15] Comprehensive Cleanup - Migration 034 and Dead Code Removal

- **Goal**: Fix all 90+ issues identified in deep-cleanup scan using parallel team approach
  - Deep cleanup scan identified: runtime bugs, orphan tables, timer leaks, dead code, version inconsistencies
  - Original plan: 7 phases with 5 parallel agents (critical-fixer, version-unifier, code-cleaner, schema-config-fixer, doc-updater)
  - Actual execution: Verification-first approach discovered most Critical fixes already complete
  - Strategy pivot: Direct verification + cleanup instead of redundant parallel fixes
  - Result: PR #272 merged successfully, 1113 lines deleted, 115 added (net -1000 lines)

- **验证发现** (Verification-First Discovery)
  - **Phase 1 Critical fixes already done**:
    - selfcheck.js line 159: Already using correct `event_type` column
    - query-okr-status.mjs: Already using correct `type='kr'` filter
    - promotion-job.js: Timer leak already fixed with `_promotionJobInterval` tracking
    - healing.js: Timer leak already fixed with `_recoveryTimers` array + cleanup
    - Fake success logs already removed from healing.js
  - **Lesson**: Verify before parallel fixing - saves agent resources, prevents duplicate work
  - **Strategy**: verification-first > assumption-based parallel execution

- **Migration 034 创建**
  - Dropped orphan tables: `areas`, `cortex_quality_reports`
  - Fixed `task_type` constraint: removed ghost 'automation' type
  - Updated `EXPECTED_SCHEMA_VERSION` to '034'
  - Test updates required: migration-015.test.js, selfcheck.test.js

- **CI Failures and Fixes** (3 iterations to pass)
  1. **First failure**: Test expectations stale
     - selfcheck.test.js expected '033', needed '034'
     - migration-015.test.js expected cortex_quality_reports to exist
     - Fix: Update test expectations, document why table dropped
  2. **Second failure**: DEFINITION.md version mismatch
     - facts-check: code=1.40.1 ≠ doc=1.40.0
     - Root cause: Edit tool changes weren't auto-staged
     - Fix: Stage DEFINITION.md version references explicitly
  3. **Third iteration**: CI passed ✅
     - All 8 facts consistent
     - 1227 tests passed
     - PR merged successfully

- **Dead Code Cleanup** (Phase 3)
  - Deleted files (6 of 20+ identified):
    - `brain/src/test-utils.js` - Unused test helper
    - `brain/src/reset-alertness.mjs` - Obsolete script
    - `ALERTNESS_ANALYSIS.md` - Outdated analysis
    - `ALERTNESS_QUICK_REF.md` - Duplicated in DEFINITION.md
    - `.dev-lock`, `.dev-sentinel` - Temporary workflow files
  - Removed dead code from: diagnosis.js, escalation.js, healing.js, metrics.js, auto-fix.js, monitor-loop.js, similarity.js
  - Net deletion: ~1000 lines of unused code

- **Version Management** (Phase 2)
  - Bumped: 1.40.0 → 1.40.1 (patch for cleanup + fixes)
  - Synced 4 files: package.json, package-lock.json, .brain-versions, DEFINITION.md
  - DevGate validation: facts-check, version-sync both required

- **Key Learnings**
  - **Verification > Assumption**: Check what's already done before starting parallel work
  - **Edit tool caveat**: Changes aren't auto-staged, must `git add` manually
  - **Test co-evolution**: Schema migrations require test updates (both expectations and reasons)
  - **facts-check is strict**: Even doc version mismatches fail CI (good!)
  - **Iterative fixing works**: /dev workflow + Stop Hook enabled 3 CI fix iterations seamlessly
  - **Team cleanup important**: Shutdown agents properly, delete team files after work

- **影响程度**: Medium (Code Health)
  - No runtime behavior changes (all fixes already present)
  - -1000 lines of dead code removed (improves maintainability)
  - Migration 034 cleanup (reduces schema clutter)
  - Version consistency enforced (1.40.1 across all files)
  - Foundation for future cleanups (Phase 7 deferred)

- **Process Validation**
  - ✅ Deep-cleanup scan effective at identifying issues
  - ✅ /dev workflow handles multi-iteration CI fixes correctly
  - ✅ DevGate (facts-check, version-sync) catches integration errors
  - ✅ Team agents useful but verification-first prevents waste
  - ✅ Stop Hook successfully drove workflow to PR merge

### [2026-02-15] Migration 036 KR 类型兼容性修复

- **Bug**: Migration 036 引入新 KR 类型（global_kr, area_kr）后，planner.js, similarity.js, planner.test.js 中仍查询旧的 'kr' 类型，导致 Brain 无法找到任何 KR → 24/7 自动化完全失效
  - **Root Cause**: Schema migration 未同步更新所有查询该表的代码
  - **Solution**: 统一修改为 `type IN ('kr', 'global_kr', 'area_kr')`，向后兼容旧数据
  - **Files**: brain/src/planner.js:23, brain/src/similarity.js:140, brain/src/__tests__/planner.test.js:175

- **优化点**: 
  1. **Schema migration checklist**: 引入新类型/字段时，全局搜索所有查询该表的代码
  2. **CI 版本检查有效**: 捕获了 .brain-versions 格式错误和版本未更新问题
  3. **合并策略**: 合并 develop 后需再次 bump 版本（develop 已包含最新版本）
  4. **测试覆盖**: planner.test.js 修复后 19 个测试全部通过，验证了修复正确性

- **影响程度**: High
  - **修复前**: Brain 无法生成任务 → 24/7 自动化失效 → P0 阻塞
  - **修复后**: Brain 能识别所有 KR 类型 → 自动化恢复
  - **向后兼容**: 支持旧的 'kr' 类型数据，无需数据迁移
  - **测试保障**: 1244 测试全部通过

- **Process Validation**
  - ✅ /dev workflow 完整流程顺畅执行（Step 1-11）
  - ✅ CI DevGate 成功拦截版本同步问题
  - ✅ Stop Hook 驱动循环：CI 失败 → 修复 → 重试 → 通过 → 合并
  - ✅ Task Checkpoint 实时展示进度
  - ✅ 合并冲突自动解决并重试
