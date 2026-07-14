# Contract Draft：watchdog 死局解除（07150220）

**Task ID**: d3343415-8ff6-427c-b867-8d36faa54448
**Sprint Dir**: sprints/07150220-watchdog-deadlock-resume
**Date**: 2026-07-14
**Proposer**: harness-contract-proposer（首轮，无 reviewer feedback）

---

## 问题陈述

`resumeStalledRelayRuns` 在容器消失 + PR OPEN 时无条件跳过重点火，导致 CI 红/BEHIND 场景陷入死局（无人修 → 等待 6h deadline）。根因是未区分"CI 红（需 agent 修复）"和"CI 跑中/全绿（等待 merge）"两种状态。

---

## 变更范围

| 文件 | 变更类型 |
|------|---------|
| `packages/brain/src/harness-relay-watchdog.js` | 修改：OPEN 分支内新增 CI 状态检查 + mergeStateStatus 判断 |
| `packages/brain/src/__tests__/harness-relay-watchdog.test.js` | 新增：GP-1 ~ GP-4 四条测试用例 + 扩展 makeDeps |

**不得触碰**：
- `MAX_RELAY_ATTEMPTS` / `MAX_CODEX_RELAY_ATTEMPTS` 数值
- MERGED / CLOSED 分支逻辑
- `_handleHeadedRun` 逻辑
- `orchestrator_host=foreground` 护栏

---

## Golden Path 行为规范

### GP-1：OPEN + BEHIND → 重点火
- **输入**：容器消失 + `prState=OPEN` + `mergeStateStatus=BEHIND`
- **断言**：`spawnFn` 被调用恰好 1 次；`out.resumed === 1`；日志含 `resume_ci_red`

### GP-2：OPEN + CI FAILURE → 重点火
- **输入**：容器消失 + `prState=OPEN` + `mergeStateStatus=CLEAN` + `gh pr checks` 返回含 `state=FAILURE` 的记录
- **断言**：`spawnFn` 被调用恰好 1 次；`out.resumed === 1`；日志含 `resume_ci_red`

### GP-3：OPEN + CI pending/running → 跳过
- **输入**：容器消失 + `prState=OPEN` + `gh pr checks` 全部 `state=IN_PROGRESS/PENDING`（无 FAILURE）
- **断言**：`spawnFn` 不被调用；`out.resumed === 0`；日志含 `wait_ci_running`

### GP-4：attempt cap → 不重点火（熔断优先回归）
- **输入**：`attempts >= MAX_RELAY_ATTEMPTS` + `prState=OPEN` + `mergeStateStatus=BEHIND`
- **断言**：`spawnFn` 不被调用；`out.capped` 增加（熔断优先于 BEHIND 检查）

---

## 实现约束

1. **CI 状态判断**：复用 `ground-truth.js` 的 `mapCiStatus` 逻辑（导出或等价内联），禁止重复造轮子
2. **mergeStateStatus 获取**：在现有 `gh pr view --json` 的 `state` 字段基础上追加 `mergeStateStatus`
3. **重点火路径**：唯一来源为 `deps.spawnFn || spawnSkillRelaySession`，禁止新增 spawn 路径
4. **失败保守策略**：`gh pr checks` 调用失败时，保守跳过（不重点火），等价于现有失败处理
5. **日志三分**：
   - `resume_ci_red`：BEHIND 或 CI FAILURE → 重点火
   - `wait_ci_running`：CI 跑中/pending → 等待
   - `skip_green_waiting_merge`：CI 全绿 + 非 BEHIND → 等待 merge

---

## Invariants（合同级不可违反）

| # | 不变量 |
|---|--------|
| INV-1 | 熔断优先：`attempts >= cap` 时，无论 PR 状态如何，不重点火 |
| INV-2 | MERGED 路径完全不变：走 `_finalizeMergedRun`，不受本次改动影响 |
| INV-3 | CLOSED 路径完全不变：走原逻辑，不受本次改动影响 |
| INV-4 | headed 路径完全不变：`_handleHeadedRun` 不动 |
| INV-5 | foreground 护栏完全不变：`orchestrator_host=foreground` 跳过逻辑不动 |
| INV-6 | 既有 harness-relay-watchdog.test.js 所有用例必须继续通过（零回归） |

---

## E2E 验收

### E2E-1：GP-1 单元测试通过（BEHIND → 重点火）

**验证方式**：`manual:bash`

```bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1 | grep -E "GP-1|BEHIND.*重点火|resume_ci_red|✓|✗|PASS|FAIL"
```

**通过标准**：输出含 `PASS` 且 `spawnFn` 被调用 1 次的用例通过（无 FAIL）

---

### E2E-2：GP-2 单元测试通过（CI FAILURE → 重点火）

**验证方式**：`manual:bash`

```bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1 | grep -E "GP-2|CI FAILURE|resume_ci_red|✓|✗|PASS|FAIL"
```

**通过标准**：输出含 `PASS` 且 CI FAILURE 用例通过（无 FAIL）

---

### E2E-3：GP-3 单元测试通过（CI pending → 跳过）

**验证方式**：`manual:bash`

```bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1 | grep -E "GP-3|pending.*跳过|wait_ci_running|✓|✗|PASS|FAIL"
```

**通过标准**：输出含 `PASS` 且 pending 跳过用例通过（无 FAIL）

---

### E2E-4：GP-4 回归测试通过（熔断优先）

**验证方式**：`manual:bash`

```bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1 | grep -E "GP-4|熔断|capped|✓|✗|PASS|FAIL"
```

**通过标准**：输出含 `PASS` 且熔断用例中 `spawnFn` 未被调用（无 FAIL）

---

### E2E-5：全量测试无回归

**验证方式**：`manual:bash`

```bash
cd /workspace && pnpm --filter brain test harness-relay-watchdog 2>&1 | tail -20
```

**通过标准**：全部测试通过，0 failures，既有用例无回归

---

## 开发顺序

1. 先写 failing tests（GP-1 ~ GP-4）→ commit
2. 扩展 `makeDeps`（增加 `mergeStateStatus` / `ciChecks` mock 参数）
3. 修改 `harness-relay-watchdog.js` OPEN 分支
4. 导出或内联 `mapCiStatus`
5. 运行全量测试确认既有用例全绿
6. PR → CI 全绿 → merge
