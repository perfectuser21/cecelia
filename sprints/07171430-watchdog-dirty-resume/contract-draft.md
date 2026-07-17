# 合同草案：watchdog DIRTY resume 补丁

- **Task ID**: c6a171e5-1a9c-4058-8364-abd946daccae
- **Sprint Dir**: sprints/07171430-watchdog-dirty-resume
- **Gear**: hotfix
- **Target Env**: local_api
- **日期**: 2026-07-17
- **状态**: DRAFT

---

## 1. 问题背景

`harness-relay-watchdog.js` 在处理 OPEN PR 死局检测时，`mergeStateStatus=DIRTY`（存在合并冲突）被错误归入 `ciStatus=pending` 分支，触发 `wait_ci_running` 干等逻辑。由于冲突状态下 CI 永远不会完整通过，任务卡死，需人工救场（本次为第 4 次）。

**自愈链映射**：S3 对因处置分支——DIRTY/冲突 → 有界重点火（session 复活后 rebase 解冲突）。

---

## 2. 交付目标

修复 `packages/brain/src/harness-relay-watchdog.js` 的 `resumeStalledRelayRuns` 函数，使 `mergeStateStatus=DIRTY` 且容器已消失时，触发有界重点火，日志标 `resume_conflict`。

---

## 3. 行为规约

### [BEHAVIOR-1] DIRTY + 容器消失 → 重点火

**前提条件**:
- PR 状态为 OPEN
- `mergeStateStatus=DIRTY`
- 容器已消失（`docker ps` 返回空）
- CI checks 返回空数组（ciStatus=pending）

**期望行为**:
- `spawnFn` 被调用一次
- `out.resumed === 1`
- 日志含 `resume_conflict`

**本用例在修复前必须 FAIL（验证测试真正覆盖了 bug 路径）**

---

### [BEHAVIOR-2] BEHIND + 容器消失 → 重点火（回归保护）

**前提条件**:
- PR 状态为 OPEN
- `mergeStateStatus=BEHIND`
- 容器已消失

**期望行为**:
- `spawnFn` 被调用一次
- `out.resumed === 1`
- 日志含 `BEHIND`

**修复前后均须 PASS**

---

### [BEHAVIOR-3] CI 全绿 + CLEAN + evaluator 完成 → 等待 merge（回归保护）

**前提条件**:
- PR 状态为 OPEN
- `mergeStateStatus=CLEAN`
- CI checks 全绿（ciStatus=pass）
- evaluator gate 已完成

**期望行为**:
- `spawnFn` 不被调用
- `out.resumed === 0`
- 日志含 `skip_green_waiting_merge`

**修复前后均须 PASS**

---

### [BEHAVIOR-4] BLOCKED（非 DIRTY）+ CI pending → wait_ci_running（回归保护）

**前提条件**:
- PR 状态为 OPEN
- `mergeStateStatus=BLOCKED`（非 DIRTY）
- CI checks 返回空数组（ciStatus=pending）
- 容器已消失

**期望行为**:
- `spawnFn` 不被调用
- `out.resumed === 0`
- 日志含 `wait_ci_running`

**修复前后均须 PASS**

---

### [BEHAVIOR-5] DIRTY + 容器存活 → 不重点火（前提铁律）

**前提条件**:
- PR 状态为 OPEN
- `mergeStateStatus=DIRTY`
- 容器存活（`docker ps` 返回非空）

**期望行为**:
- `spawnFn` 不被调用
- `out.resumed === 0`（容器存活时走现有存活检查路径，不触发 DIRTY 重点火）

---

## 4. 铁律约束

1. **attempt cap 不变**：DIRTY 路径必须遵守现有 `MAX_RELAY_ATTEMPTS` 上限，不得新增豁免
2. **测试不 mock 解析路径**：`execFn` 必须返回含真实 `mergeStateStatus` 字段的 JSON，由 watchdog 内部 `tryParseJson` 真实解析
3. **BEHIND 路径回归不变**：修复后 BEHIND 仍走 `resume_ci_red reason=BEHIND`，不受影响
4. **容器消失是前提**：仅容器消失（无活跃 session）时才走 DIRTY → 重点火；容器存活时仍走现有存活检查

---

## 5. 代码改动范围

| 文件 | 改动说明 |
|------|---------|
| `packages/brain/src/harness-relay-watchdog.js` | 从已有 `mergeStateStatus` 查询中提取 `isDirty`；条件加入重点火分支（`isBehind || isDirty || ciStatus === 'fail'`）；日志标 `resume_conflict` |
| `tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js` | 新增 B1（failing→passing）+ B2/B3/B4 回归测试 |

**不改**：
- attempt cap 数值（`MAX_RELAY_ATTEMPTS=5`, `MAX_CODEX_RELAY_ATTEMPTS=2`）
- Step0.4 / rebase 逻辑
- CI 配置（regression 目录自动纳入）
- 其他 mergeStateStatus 值处置（BLOCKED、DRAFT 等）

---

## 6. 代码变更草稿

**修复前**（`harness-relay-watchdog.js` L381-431）：
```js
let isBehind = false;
// ...查询 mergeStateStatus...
isBehind = viewDetail?.mergeStateStatus === 'BEHIND';
// ...
if (isBehind || ciStatus === 'fail') {
  const reason = isBehind ? 'BEHIND' : 'CI_FAILURE';
  console.log(`[relay-watchdog] resume_ci_red initiative=... reason=${reason}`);
} else if (ciStatus === 'pending') {
  console.log(`[relay-watchdog] wait_ci_running initiative=...`);
  continue;
} else {
  // CI 全绿...
}
```

**修复后**：
```js
let isBehind = false;
let isDirty = false;
// ...查询 mergeStateStatus...
isBehind = viewDetail?.mergeStateStatus === 'BEHIND';
isDirty = viewDetail?.mergeStateStatus === 'DIRTY';
// ...
if (isBehind || isDirty || ciStatus === 'fail') {
  const reason = isDirty ? 'resume_conflict' : (isBehind ? 'BEHIND' : 'CI_FAILURE');
  console.log(`[relay-watchdog] resume_ci_red initiative=... pr=... reason=${reason}`);
} else if (ciStatus === 'pending') {
  console.log(`[relay-watchdog] wait_ci_running initiative=...`);
  continue;
} else {
  // CI 全绿 + 非 DIRTY + 非 BEHIND...
}
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| DIRTY+容器消失→重点火 | `tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js` | B1: mergeStateStatus=DIRTY+容器消失 → out.resumed=1+日志resume_conflict（核心 bug 修复前 FAIL） | 修复前 ciStatus=pending 走 wait_ci_running → out.resumed=0 ≠ 1 → FAIL |
| BEHIND 回归保护 | `tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js` | B2: mergeStateStatus=BEHIND → out.resumed=1+日志含BEHIND（不变） | BEHIND 分支被 DIRTY 补丁意外破坏 → resumed=0 → FAIL |
| CI全绿+CLEAN→不重点火 | `tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js` | B3: mergeStateStatus=CLEAN+CI全绿+evaluator完成 → out.resumed=0（skip_green_waiting_merge） | 绿灯路径被重点火 → resumed=1 → FAIL |
| BLOCKED+CI_pending→等待 | `tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js` | B4: mergeStateStatus=BLOCKED+CI_pending → out.resumed=0（wait_ci_running，非DIRTY） | BLOCKED 被误判 DIRTY → resumed=1 → FAIL |
| DIRTY+attempt_cap→封顶 | `tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js` | B5: DIRTY+attempts≥cap → out.resumed=0，spawnFn不调用（铁律：cap不绕过） | DIRTY 绕过 cap → resumed=1 → FAIL |

---

## E2E 验收

### 验收条件

**FR-1 验收**：`mergeStateStatus=DIRTY` 且容器消失时，`resumeStalledRelayRuns` 调用 `spawnFn` 一次，`out.resumed === 1`，日志含 `resume_conflict`。

**FR-2 验收**：DIRTY 路径使用 attempt cap（attempts=5 时，`out.capped` 递增，`spawnFn` 不被调用）。

**FR-3 验收**：BEHIND 路径仍触发重点火（`out.resumed === 1`，日志含 `BEHIND`）；CI 全绿路径不触发重点火（`out.resumed === 0`）；CI pending 非 DIRTY 路径不触发重点火（`out.resumed === 0`）。

**FR-4 验收**：vitest 跑通 4 条测试用例（B1 修复后变绿，B2/B3/B4 全程绿）。

### E2E 执行步骤

```bash
# Step 1: 修复前跑 B1（必须 FAIL 才证明测试真正覆盖 bug）
cd /workspace
npx vitest run tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js \
  --reporter=verbose 2>&1 | grep -E "FAIL|PASS|resume_conflict"

# Step 2: 应用修复（packages/brain/src/harness-relay-watchdog.js）

# Step 3: 修复后跑全部 4 条用例（全须 PASS）
npx vitest run tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js \
  --reporter=verbose

# Step 4: 确认 B1 日志断言——日志必须含 resume_conflict
npx vitest run tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js \
  --reporter=verbose 2>&1 | grep "resume_conflict"

# Step 5: 全量回归（确保不破坏其他测试）
cd packages/brain && npx vitest run --reporter=verbose 2>&1 | tail -20
```

### 验收通过判定

- `npx vitest run` 退出码 `0`（全绿）
- 输出含 `4 passed`
- B1 场景的 log spy 捕获到 `resume_conflict`
- B2 场景的 log spy 捕获到 `BEHIND`
- B3 场景 `spawnFn` 调用次数为 `0`
- B4 场景 `spawnFn` 调用次数为 `0`

---

## 8. 成功标准汇总

| # | 标准 | 验证方式 |
|---|------|---------|
| 1 | B1 修复前 FAIL，修复后 PASS | vitest 跑 B1 用例两次 |
| 2 | B2/B3/B4 修复前后均 PASS | vitest 跑全量 |
| 3 | DIRTY 场景日志含 `resume_conflict` | console.log spy |
| 4 | `out.resumed === 1` 且 spawnFn 被调一次 | vitest 断言 |
| 5 | CI 全绿（brain-ci.yml） | GitHub Actions |
| 6 | attempt cap 未改变 | 代码 review + B5 |
