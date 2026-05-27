# Credential Alert Threshold Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix false-alarm credential alerts by aligning ALERT_THRESHOLD_MS (8h→4h) and CRITICAL_THRESHOLD_MS (3h→2h) with the actual cron refresh behavior (refreshes at <3h remaining).

**Architecture:** Token lifetime is 8h. Cron refreshes when <3h remaining. With ALERT=8h≡token-lifetime, accounts enter "expiring_soon" the moment after refresh — Brain tick alerts every 30 min for 5 hours unnecessarily. Lowering ALERT to 4h gives a clean 1h overlap between alert and cron refresh. Three files share this threshold: the checker itself, a duplicate in the HTTP status route, and the test suite.

**Tech Stack:** Node.js ESM, vitest, Brain API (port 5221)

---

## Files

- Modify: `packages/brain/src/credential-expiry-checker.js` lines 24-25 — threshold constants
- Modify: `packages/brain/src/routes/infra-status.js` line 399 — hardcoded `8 * 3600000`
- Modify: `packages/brain/src/__tests__/credential-recovery.test.js` lines 226-284 — update test values and descriptions

---

### Task 1: Update test suite for new thresholds (TDD — write tests first)

**Files:**
- Modify: `packages/brain/src/__tests__/credential-recovery.test.js`

- [ ] **Step 1: Update P0 critical test — change 2h→1.5h and rename**

  Currently line 226 tests `2 * 60 * 60 * 1000` (2h) for P0. After CRITICAL drops to 2h, `2h < 2h` is false — test would fail to get P0. Use 1.5h instead.

  Find and replace in the test file:

  ```javascript
  // OLD (lines ~226-238):
  it('< 3h 剩余：通过 raise() 发送 P0 紧急告警', async () => {
    mockExpiringCredential(2 * 60 * 60 * 1000); // 2h remaining

  // NEW:
  it('< 2h 剩余：通过 raise() 发送 P0 紧急告警', async () => {
    mockExpiringCredential(90 * 60 * 1000); // 1.5h remaining — below new 2h CRITICAL threshold
  ```

- [ ] **Step 2: Update P0 dedup test — same value change**

  ```javascript
  // OLD (line ~240-250):
  it('< 3h 剩余：1h 内已告警时跳过（内存去重）', async () => {
    mockExpiringCredential(2 * 60 * 60 * 1000); // 2h remaining

  // NEW:
  it('< 2h 剩余：1h 内已告警时跳过（内存去重）', async () => {
    mockExpiringCredential(90 * 60 * 1000); // 1.5h remaining
  ```

- [ ] **Step 3: Update P1 alert test — 5h is now above 4h threshold (would be 'ok'), change to 3h**

  ```javascript
  // OLD (line ~252-264):
  it('3h~8h 剩余：通过 raise() 发送 P1 常规告警', async () => {
    mockExpiringCredential(5 * 60 * 60 * 1000); // 5h remaining

  // NEW:
  it('2h~4h 剩余：通过 raise() 发送 P1 常规告警', async () => {
    mockExpiringCredential(3 * 60 * 60 * 1000); // 3h remaining — below new 4h ALERT, above new 2h CRITICAL
  ```

- [ ] **Step 4: Update P1 dedup test — same value change**

  ```javascript
  // OLD (line ~266-274):
  it('3h~8h 剩余：1h 内已告警时跳过（内存去重）', async () => {
    mockExpiringCredential(5 * 60 * 60 * 1000); // 5h remaining

  // NEW:
  it('2h~4h 剩余：1h 内已告警时跳过（内存去重）', async () => {
    mockExpiringCredential(3 * 60 * 60 * 1000); // 3h remaining
  ```

- [ ] **Step 5: Update healthy token test — rename from 8h to 4h**

  The test value (10h) still works since 10h > new 4h threshold, just update description:

  ```javascript
  // OLD (line ~276-284):
  it('凭据健康（> 8h）：不告警', async () => {
    mockExpiringCredential(10 * 60 * 60 * 1000); // 10h — above 8h threshold

  // NEW:
  it('凭据健康（> 4h）：不告警', async () => {
    mockExpiringCredential(5 * 60 * 60 * 1000); // 5h — above new 4h threshold
  ```

- [ ] **Step 6: Run tests — expect FAILURES on the threshold boundary tests (not yet changed)**

  ```bash
  cd /Users/administrator/worktrees/cecelia/fix-credential-alert-threshold
  npx vitest run packages/brain/src/__tests__/credential-recovery.test.js 2>&1 | tail -30
  ```

  Expected: tests referencing P0 at 1.5h and P1 at 3h FAIL because checker still uses old 8h/3h thresholds (2h→1.5h is P1 not P0, and 3h is ok not expiring_soon).

---

### Task 2: Fix the threshold constants in credential-expiry-checker.js

**Files:**
- Modify: `packages/brain/src/credential-expiry-checker.js` lines 24-25

- [ ] **Step 1: Change the two constants**

  ```javascript
  // OLD (line 24-25):
  const ALERT_THRESHOLD_MS = 8 * 60 * 60 * 1000; // 8 小时（给更多响应窗口）
  const CRITICAL_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 小时 — 触发升级 P0 告警

  // NEW:
  const ALERT_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 小时（cron 在 <3h 时刷新，给 1h 安全窗口）
  const CRITICAL_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 小时 — 触发升级 P0 告警（cron 最差 2h 一次）
  ```

- [ ] **Step 2: Run tests — expect test suite to now pass**

  ```bash
  npx vitest run packages/brain/src/__tests__/credential-recovery.test.js 2>&1 | tail -20
  ```

  Expected: all 5 threshold-related tests PASS.

---

### Task 3: Fix hardcoded threshold in infra-status.js

**Files:**
- Modify: `packages/brain/src/routes/infra-status.js` line 399

- [ ] **Step 1: Update hardcoded value**

  ```javascript
  // OLD (line 399):
  else if (remainingMs < 8 * 3600000) token_status = 'expiring_soon';

  // NEW:
  else if (remainingMs < 4 * 3600000) token_status = 'expiring_soon';
  ```

- [ ] **Step 2: Run full Brain test suite to confirm no regressions**

  ```bash
  npx vitest run packages/brain/src/__tests__/ 2>&1 | tail -20
  ```

  Expected: all tests pass.

---

### Task 4: Commit and push

- [ ] **Step 1: Write PRD + DoD files**

  Create `.prd-cp-0527152922-fix-credential-alert-threshold.md` in worktree root:

  ```markdown
  # fix: 修复 credential-expiry-checker 告警阈值误报

  ## 问题
  Claude OAuth token 生命周期 8h，ALERT_THRESHOLD_MS 也是 8h，导致 token 刚刷新就进入
  expiring_soon 状态，Brain tick 每 30 分钟持续误报告警。

  ## 修法
  - ALERT_THRESHOLD_MS: 8h → 4h（cron 在 <3h 时自动刷新，4h 给 1h 安全缓冲）
  - CRITICAL_THRESHOLD_MS: 3h → 2h（cron 最差 2h 一次）
  - infra-status.js 同步更新硬编码值
  - 测试用例同步更新边界值

  ## 成功标准
  账号 token 剩余 >4h 时 Brain credential 检查返回 status=ok，不再触发告警。
  ```

  Create `.dod-cp-0527152922-fix-credential-alert-threshold.md` in worktree root:

  ```markdown
  # DoD: fix-credential-alert-threshold

  - [x] [ARTIFACT] packages/brain/src/credential-expiry-checker.js ALERT_THRESHOLD_MS=4h
        Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/src/credential-expiry-checker.js','utf8');if(!s.includes('4 * 60 * 60 * 1000'))process.exit(1)"
  - [x] [ARTIFACT] packages/brain/src/routes/infra-status.js 硬编码阈值已更新
        Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/src/routes/infra-status.js','utf8');if(s.includes('8 * 3600000'))process.exit(1)"
  - [x] [BEHAVIOR] 凭据剩余 >4h 时 checkCredentialExpiry() 返回 status=ok
        Test: tests/brain/credential-recovery.test.js
  - [x] [BEHAVIOR] 凭据剩余 1.5h 时触发 P0 告警（CRITICAL_THRESHOLD=2h）
        Test: tests/brain/credential-recovery.test.js
  ```

- [ ] **Step 2: Stage and commit**

  ```bash
  cd /Users/administrator/worktrees/cecelia/fix-credential-alert-threshold
  git add packages/brain/src/credential-expiry-checker.js \
          packages/brain/src/routes/infra-status.js \
          packages/brain/src/__tests__/credential-recovery.test.js \
          .prd-cp-0527152922-fix-credential-alert-threshold.md \
          .dod-cp-0527152922-fix-credential-alert-threshold.md \
          docs/superpowers/plans/2026-05-27-credential-alert-threshold-fix.md
  git commit -m "fix(brain): 修复凭据告警阈值误报 — ALERT 8h→4h，CRITICAL 3h→2h"
  ```

- [ ] **Step 3: Push branch**

  ```bash
  git push -u origin cp-0527152922-fix-credential-alert-threshold
  ```

- [ ] **Step 4: Open PR**

  ```bash
  gh pr create \
    --title "fix(brain): 修复凭据告警阈值误报 — ALERT 8h→4h，CRITICAL 3h→2h" \
    --body "$(cat .prd-cp-0527152922-fix-credential-alert-threshold.md)"
  ```

- [ ] **Step 5: Invoke engine-ship skill**
