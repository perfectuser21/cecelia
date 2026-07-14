# Contract DoD：watchdog 死局解除（07150220）

**Task ID**: d3343415-8ff6-427c-b867-8d36faa54448
**Sprint Dir**: sprints/07150220-watchdog-deadlock-resume
**Date**: 2026-07-14

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] OPEN + BEHIND → 重点火（resume_ci_red）

**前提**：
- 运行记录存在，容器已消失（`container_id` 为 null 或容器不在线）
- `gh pr view` 返回 `state=OPEN`，`mergeStateStatus=BEHIND`
- `attempts < MAX_RELAY_ATTEMPTS`（熔断未触发）

**必须发生**：
- `deps.spawnFn` 被调用恰好 1 次
- 返回值 `out.resumed === 1`
- 日志输出包含字符串 `resume_ci_red`
- 日志包含 reason 标识（`BEHIND` 或等价）

**禁止发生**：
- `spawnFn` 调用超过 1 次（不得重复点火）
- 修改 MERGED / CLOSED / headed / foreground 路径的任何行为

**验收命令**：
```bash
# manual:bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog --reporter=verbose 2>&1 | grep -E "BEHIND|resume_ci_red|✓|✗" | head -20
```

---

### [BEHAVIOR-2] OPEN + CI FAILURE → 重点火（resume_ci_red）

**前提**：
- 容器消失，`prState=OPEN`，`mergeStateStatus=CLEAN`（非 BEHIND）
- `gh pr checks --json state` 结果中至少一条记录 `state=FAILURE`
- `attempts < MAX_RELAY_ATTEMPTS`

**必须发生**：
- `deps.spawnFn` 被调用恰好 1 次
- 返回值 `out.resumed === 1`
- 日志输出包含 `resume_ci_red`

**禁止发生**：
- CI 失败时跳过（即保留旧的 `continue` 行为）
- 重复造 CI 状态判断轮子（必须复用 `mapCiStatus` 逻辑）

**验收命令**：
```bash
# manual:bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog --reporter=verbose 2>&1 | grep -E "FAILURE|CI.*重点火|resume_ci_red|✓|✗" | head -20
```

---

### [BEHAVIOR-3] OPEN + CI pending/running → 跳过（wait_ci_running）

**前提**：
- 容器消失，`prState=OPEN`，`mergeStateStatus=CLEAN`
- `gh pr checks` 返回全部 `state=IN_PROGRESS` 或 `PENDING`（无 FAILURE）

**必须发生**：
- `deps.spawnFn` 不被调用（`toHaveBeenCalledTimes(0)`）
- 返回值 `out.resumed === 0`
- 日志输出包含 `wait_ci_running`

**禁止发生**：
- CI 跑中时触发重点火
- 产生重复 PR 或重复 spawn

**验收命令**：
```bash
# manual:bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog --reporter=verbose 2>&1 | grep -E "pending|wait_ci_running|✓|✗" | head -20
```

---

### [BEHAVIOR-4] attempt cap → 熔断优先，不重点火（回归保护）

**前提**：
- `attempts >= MAX_RELAY_ATTEMPTS`（熔断条件满足）
- `prState=OPEN`，`mergeStateStatus=BEHIND`（即便满足重点火前提条件）

**必须发生**：
- `deps.spawnFn` 不被调用（熔断优先于 BEHIND 检查）
- `out.capped` 增加（熔断计数器递增）
- `MAX_RELAY_ATTEMPTS` / `MAX_CODEX_RELAY_ATTEMPTS` 数值不得改变

**禁止发生**：
- 熔断条件满足时仍触发重点火
- 修改 attempt cap 数值

**验收命令**：
```bash
# manual:bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog --reporter=verbose 2>&1 | grep -E "cap|熔断|capped|✓|✗" | head -20
```

---

### [BEHAVIOR-5] 全量测试无回归（既有用例零 FAIL）

**前提**：
- GP-1 ~ GP-4 新增测试已实现
- `harness-relay-watchdog.js` OPEN 分支已修改

**必须发生**：
- `pnpm --filter brain test harness-relay-watchdog` 输出 0 failures
- 既有所有测试用例（`OPEN + CI 全绿 + 非 BEHIND → 跳过` 等）继续通过

**验收命令**：
```bash
# manual:bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1 | tail -10
```

**通过标准**：末尾含 `Tests: X passed` 且 `failed: 0`（或等价的 vitest/jest 通过输出）

---

## 完整验收流程（按序执行）

```bash
# manual:bash
# Step 1：运行全量 watchdog 测试，确认 GP-1~GP-4 全通过且无回归
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1

# Step 2：确认 BEHIND 路径日志标识正确
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1 | grep -c "resume_ci_red"

# Step 3：确认熔断优先（capped 计数器）
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1 | grep -E "capped|熔断"

# Step 4：确认未触碰铁律文件（diff 范围检查）
git diff --name-only HEAD | grep -v "harness-relay-watchdog"
```

---

## 铁律核查清单

- [x] `MAX_RELAY_ATTEMPTS` 数值未改变
- [x] `MAX_CODEX_RELAY_ATTEMPTS` 数值未改变
- [x] MERGED 分支逻辑（`_finalizeMergedRun`）无改动
- [x] CLOSED 分支逻辑无改动
- [x] `_handleHeadedRun` 无改动
- [x] `foreground` 护栏无改动
- [x] 重点火唯一走 `deps.spawnFn || spawnSkillRelaySession`
- [x] CI 判断复用 `mapCiStatus` 逻辑（不重复造轮子）
- [x] `gh pr checks` 失败时保守跳过（不重点火）
