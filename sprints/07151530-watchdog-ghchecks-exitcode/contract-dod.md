# DoD (Definition of Done): 刀A5 — gh pr checks 非零退出码容错

**Task ID**: b5162377-4012-424a-ba2f-0b33003eb602
**Sprint**: 07151530-watchdog-ghchecks-exitcode
**Target Environment**: local_api（vitest）
**Date**: 2026-07-15

---

## [ARTIFACT] 产物清单

- [ARTIFACT] `sprints/07151530-watchdog-ghchecks-exitcode/tests/harness-relay-watchdog-exitcode.test.js`
  — 新增 TDD Red 测试文件，覆盖 GP-A（resume_ci_red）/ GP-B（wait_ci_running）/ GP-C（skip_query_failure）三条 Golden Path，在当前代码下预期为红（failing）

- [ARTIFACT] `packages/brain/src/__tests__/harness-relay-watchdog.test.js`
  — PR 实施阶段须将 GP-A/GP-B/GP-C 三条用例追加进此文件，作为 regression guard 常驻 CI

- [ARTIFACT] `packages/brain/src/harness-relay-watchdog.js`（按需修复）
  — 若测试证明 `execTolerant` 实现有缺陷则就地修复；若实现已正确则测试驱动验证即可

---

## 行为条目（[BEHAVIOR]）

- [ ] [BEHAVIOR] GP-A（resume_ci_red）：`gh pr checks` 以非零退出码抛出错误（模拟 exit 1），`err.stdout` 为含 `FAILURE` 状态的 JSON 字符串时，`execTolerant` 捕获错误并用 `err.stdout` 兜底返回数据，`mapCiStatus` 将其映射为 `'fail'`，`spawnFn` 被调用一次，`r.resumed === 1`
  Test: `manual:bash` — `cd /workspace/packages/brain && npx vitest run ../../sprints/07151530-watchdog-ghchecks-exitcode/tests/harness-relay-watchdog-exitcode.test.js --reporter=verbose 2>&1 | grep -E "resume_ci_red|PASS|FAIL"`

- [ ] [BEHAVIOR] GP-B（wait_ci_running）：`gh pr checks` 以非零退出码抛出错误（模拟 exit 8），`err.stdout` 为含 `IN_PROGRESS` 状态的 JSON 字符串时，`execTolerant` 兜底返回数据，`mapCiStatus` 将其映射为 `'pending'`，`spawnFn` 不被调用，`r.resumed === 0`
  Test: `manual:bash` — `cd /workspace/packages/brain && npx vitest run ../../sprints/07151530-watchdog-ghchecks-exitcode/tests/harness-relay-watchdog-exitcode.test.js --reporter=verbose 2>&1 | grep -E "wait_ci_running|PASS|FAIL"`

- [ ] [BEHAVIOR] GP-C（skip_query_failure）：`gh pr checks` 抛出无 `stdout` 属性（或空字符串）的错误（模拟真实网络/auth 失败）时，`execTolerant` rethrow 原错误，外层 `catch (ciErr)` 触发保守跳过，`spawnFn` 不被调用，`r.resumed === 0`
  Test: `manual:bash` — `cd /workspace/packages/brain && npx vitest run ../../sprints/07151530-watchdog-ghchecks-exitcode/tests/harness-relay-watchdog-exitcode.test.js --reporter=verbose 2>&1 | grep -E "skip_query_failure|PASS|FAIL"`

- [ ] [BEHAVIOR] GP-R（regression）：既有 `harness-relay-watchdog.test.js` 中所有用例（含 GP-1～GP-4 正常路径、scanStuckHarness、foreground 护栏、PR 发现等所有 describe 块）继续通过，0 failures
  Test: `manual:bash` — `cd /workspace/packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js 2>&1 | tail -5`

- [ ] [BEHAVIOR] execTolerant 存在且在 gh pr checks 调用处生效：`packages/brain/src/harness-relay-watchdog.js` 第 30 行存在 `execTolerant` 函数，第 371 行附近存在 `execTolerant(execFn, ...)` 调用
  Test: `manual:bash` — `grep -n "execTolerant" /workspace/packages/brain/src/harness-relay-watchdog.js`

---

## 实现约束（铁律）

- [ ] `execTolerant` 函数实现保持在 `harness-relay-watchdog.js` 第 30-37 行（不新增函数，就地修复）
- [ ] 不修改重点火触发条件（`isBehind || ciStatus === 'fail'` 不变）
- [ ] 不修改 `MAX_RELAY_ATTEMPTS = 5` / `MAX_CODEX_RELAY_ATTEMPTS = 2`
- [ ] 不改 MERGED / CLOSED 分支逻辑
- [ ] 不碰 `_handleHeadedRun`（headed 分支）
- [ ] 不碰 `foreground` orchestrator_host 护栏

---

## 不变式（Invariants）

| # | 断言 |
|---|------|
| I-1 | execTolerant 遇到 err.stdout 有内容时，必须返回 err.stdout 而不是 throw |
| I-2 | execTolerant 遇到 err.stdout 为空/不存在时，必须 rethrow 原错误 |
| I-3 | ciErr catch 分支保守跳过：spawnFn 不得在 CI 查询失败时被调用 |
| I-4 | 非零退出但 stdout 含 FAILURE → ciStatus === 'fail' → spawnFn 必须被调用 |
| I-5 | 非零退出但 stdout 全 pending → ciStatus === 'pending' → spawnFn 不得被调用 |
| I-6 | 既有 GP-1～GP-4 正常路径：行为不回归 |

---

## 测试文件位置

| 文件类型 | 路径 |
|----------|------|
| 合同测试（TDD Red，新增） | `sprints/07151530-watchdog-ghchecks-exitcode/tests/harness-relay-watchdog-exitcode.test.js` |
| 正式回归测试（PR 阶段追加） | `packages/brain/src/__tests__/harness-relay-watchdog.test.js` |
| 实现文件 | `packages/brain/src/harness-relay-watchdog.js` |

---

## CI 门禁

- `brain-ci.yml` 中 `vitest` 覆盖 `harness-relay-watchdog.test.js` 必须绿
- 禁止用 `--admin` 或跳过 CI 绿灯强行合并
- 所有 failing tests 须先 commit（红→绿流程），不得先改实现再补测试
