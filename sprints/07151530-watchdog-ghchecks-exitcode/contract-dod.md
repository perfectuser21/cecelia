# DoD (Definition of Done): 刀A5 — gh pr checks 非零退出码容错

**Task ID**: b5162377-4012-424a-ba2f-0b33003eb602
**Sprint**: 07151530-watchdog-ghchecks-exitcode

---

## 验收条件

### 新增测试必须通过

- [ ] **[BEHAVIOR-1]** GP-A：`gh pr checks` 非零退出 + stdout 含 FAILURE → `execTolerant` 兜底解析 → `ciStatus='fail'` → `spawnFn` 调用一次（`resumed === 1`）
- [ ] **[BEHAVIOR-2]** GP-B：`gh pr checks` 非零退出 + stdout 全 pending → `execTolerant` 兜底解析 → `ciStatus='pending'` → `spawnFn` 不调用（`resumed === 0`），日志含 `wait_ci_running`
- [ ] **[BEHAVIOR-3]** GP-C：`gh pr checks` 非零退出 + 无 stdout（真实查询失败）→ `execTolerant` 重抛 → 外层 catch 保守跳过 → `spawnFn` 不调用（`resumed === 0`），日志含 `CI 状态查询失败`
- [ ] **[BEHAVIOR-4]** 正常路径回归：`gh pr checks` 正常退出（exit 0）+ stdout 含 FAILURE → `resumed === 1`（正常路径不受 execTolerant 改动影响）

### 原有测试不破坏（回归保护）

- [ ] **[BEHAVIOR-R]** 既有 `harness-relay-watchdog.test.js` 中所有用例继续通过：
  - `scanStuckHarness — 逾期收尸 host 覆盖`
  - `resumeStalledRelayRuns`（含 GP-1 ~ GP-4 + 8 条集成用例）
  - `foreground 护栏`
  - `patrol 排除 v2`
  - `watchdog loop 接线`
  - `PATCH phase 白名单扩展`
  - `resumeStalledRelayRuns — pr_url fallback 链`
  - `PATCH /orchestrator/relay-runs — pr_url 字段写入`
  - `_hasEvaluatorGate` / `_raiseUngatedMergeAlert` / `_finalizeMergedRun`
  - `刀A2 — generator_done + pr_url 空 反查修复`

### 实现约束（铁律，必须验证）

- [ ] `execTolerant` 函数实现保持在 `harness-relay-watchdog.js` 第 30-37 行（或就地修复，不新增函数）
- [ ] 不修改重点火触发条件（`isBehind || ciStatus === 'fail'` 不变）
- [ ] 不修改 `MAX_RELAY_ATTEMPTS = 5` / `MAX_CODEX_RELAY_ATTEMPTS = 2`
- [ ] 不改 MERGED / CLOSED 分支逻辑
- [ ] 不改 `_handleHeadedRun`（headed 分支）
- [ ] 不改 foreground 护栏

---

## 测试文件位置

| 文件类型 | 路径 |
|----------|------|
| 合同测试（新增） | `sprints/07151530-watchdog-ghchecks-exitcode/tests/watchdog-gh-checks-exitcode.contract.test.js` |
| 正式回归测试（需合并到此处） | `packages/brain/src/__tests__/harness-relay-watchdog.test.js` |
| 实现文件 | `packages/brain/src/harness-relay-watchdog.js` |

> **注意**：合同测试文件为独立起草文件，PR 实施阶段须将 GP-A/GP-B/GP-C 三条用例追加进 `packages/brain/src/__tests__/harness-relay-watchdog.test.js` 并 commit 进 repo 作为 regression guard，CI 常驻。

---

## CI 门禁

- `engine-ci.yml` 或 `brain-ci.yml` 中 `vitest` 覆盖 `harness-relay-watchdog.test.js` 必须绿
- 禁止用 `--admin` 或跳过 CI 绿灯强行合并
- 所有 failing tests 须先 commit（红→绿流程），不得先改实现再补测试

---

## 不变式（Invariants）校验清单

| 不变式 | 验证断言 |
|--------|----------|
| I-1: execTolerant 遇到 err.stdout 有内容时返回 err.stdout | GP-A/GP-B 中 spawnFn 行为验证 |
| I-2: execTolerant 遇到 err.stdout 为空/不存在时 rethrow | GP-C 中 `CI 状态查询失败` 日志验证 |
| I-3: ciErr catch 分支保守跳过：spawnFn 不得在 CI 查询失败时被调用 | GP-C: `spawnFn` not called |
| I-4: 非零退出但 stdout 含 FAILURE → ciStatus='fail' → spawnFn 必须被调用 | GP-A: `resumed === 1` |
| I-5: 非零退出但 stdout 全 pending → ciStatus='pending' → spawnFn 不得被调用 | GP-B: `resumed === 0` |
| I-6: 既有 GP-1 ~ GP-4 正常路径不回归 | BEHAVIOR-R: 0 failures |
