# Kernel attempt 成本回写：复活 GAN budget cap

- 日期：2026-08-04
- 任务：7bd1fa03（fix(kernel): attempt 用量回写 run.cost_usd 复活 GAN budget cap）
- 关联：issue ce42f68f / 决策 ba33fc68、c953a263、fbb0bc9d / docs/prd/2026-08-04-kernel-cost-writeback-prep-prd.md

## 问题

`deriveGan` 的唯一预算保护 `caps.budgetExceeded(counters.ganCostUsd)` 读 `initiative_runs.cost_usd`（loop.js:588，每 tick 从 DB 新鲜加载），但全 orchestrator 无任何调用方累加该列。r17 实证 8 个 attempt 后 cost_usd=0.00，BUDGET_CAP_USD=10 永不触发，GAN 可无限烧配额。

## 设计决定：本修复是"固定记账安全网"，不是真实成本核算

调查确认（Research Subagent 取证）：

1. callback 请求体经 `execution-contract.js` 的 zod schema 解析，顶层默认 strip 未知键——`total_cost_usd`/`usage` 即使上报也会被剥掉；三家 provider 适配层目前都不上报成本。任何"优先真实用量"分支都是死代码。
2. `cost_usd` 列为 `NUMERIC(8,2)`，也装不下真实 token 成本（如 0.0031 会归零）。

因此本修复**如实做成 attempt 计数代理**：每个经 callback 达到终态的 attempt，固定累加 `ATTEMPT_COST_ACCRUAL_USD`。真实用量上报（provider 上报 + schema 顶层显式字段 + 列宽扩 NUMERIC(10,6)）是独立后续增强，不混入本 PR。

## 修改点

1. `packages/brain/src/orchestrator/constants.js`
   新增 `export const ATTEMPT_COST_ACCRUAL_USD = 0.25;`
   注释写明：这是每 attempt 固定记账单价（代理值，非真实成本）；BUDGET_CAP_USD=10 ÷ 0.25 = 40 个 attempt ≈ 13 轮 GAN 后触发 cap，定位是"明显异常才触发"的安全网，正常收敛靠案卷机制与趋势观测（决策 ba33fc68）。

2. `packages/brain/src/orchestrator/attempt-store.js` — `recordCallbackTerminal`
   在 `!isTerminal` 分支（首次终态写入成功后）的**块末尾、COMMIT 之前**追加：

   ```sql
   UPDATE initiative_runs
      SET cost_usd = COALESCE(cost_usd, 0) + $2,
          updated_at = NOW()
    WHERE id = $1
   ```

   - 同事务安全：事务开头已持 `pg_advisory_xact_lock(runId)` + run 行 `FOR UPDATE`，同事务内已有 `UPDATE initiative_runs SET pr_url=...` 活先例，无死锁风险。
   - 幂等：重复/exact-retry callback 走 `isTerminal` 早退分支，不会二次累加。
   - `COALESCE` 防历史 NULL 行静默失效。

## 显式不做（记录原因）

- **旁路终态不计账**：`expired-attempt-reconciler`（lease 过期打 failed）、`attemptStore.complete()`（in-brain judge）、`attemptStore.fail()`（launch 前失败）绕过 callback 路径不累加。GAN cap 关心的 proposer/reviewer 主路径全走 callback，已覆盖；过期 attempt 漏计造成的低估方向安全（cap 晚触发不早触发误杀）。后续真实用量增强时一并收编。
- **不加 schema 字段 / 不迁移列宽**：当前无上报方，YAGNI。
- **generator/evaluator 阶段的累加照常发生但无人读**（budgetExceeded 只在 deriveGan 调用）——账面如实记录，不额外加读取方。
- **cost_usd 的第二个消费方被一并激活，非本修复目标**：`directive-validator`（loop.js 传入
  `spentUsd = observed.run.cost_usd` → `cost_budget_exceeded` deny，软降级回退 `defaultDecision`）
  此前因 cost_usd 恒 0 是死代码，本修复后在所有相位被激活；`commander_mode` 默认
  `kernel-only`，生产实际触达面窄，行为激活视为已知副作用而非本次目标。
- **固定单价对所有角色一视同仁记账**：planner/canary/context 等重试路径同样按
  `ATTEMPT_COST_ACCRUAL_USD` 累加，"高估方向"会挤占 40 格分母（budget cap 触发阈值），
  属已知取舍，与安全网代理值定位一致，不单独为角色差异化计价。
- **Dashboard / DAG 端点直接以 `$` 展示该代理值，无"估算"标注**：UI 层未区分真实用量与
  固定记账代理值，标注/提示属后续任务，不在本次范围内。

## 判定点

| 判定点 | 候选 | 所选 | 依据 | 误判后果 |
|---|---|---|---|---|
| 每 attempt 记账单价 | 0.25 / 0.50 / 真实用量 | 0.25（40 attempt 触发 cap） | 安全网定位：明显异常才触发，主刹车是趋势观测；真实用量当前物理不可达 | 定太低→cap 过晚（多烧若干 attempt）；定太高→GAN 被钱闸误杀（违背无上限拍板） |

## 测试策略（unit 档）

`packages/brain/src/orchestrator/__tests__/attempt-store.test.js`（现有 mock 模式：手搓 client.query mockResolvedValueOnce 队列 + 按下标断言）：

1. **failing test（commit-1）**：首次终态 callback → 断言事务内存在 `UPDATE initiative_runs … cost_usd = COALESCE(cost_usd, 0) +` 语句且参数含 `[runId, 0.25]`（断言 `calls.at(-2)`，COMMIT 前一格）。修复前必红。
2. **负向：exact-retry 不重复累加**——isTerminal 重放路径断言无 cost_usd UPDATE（沿用现有 `some(sql => /UPDATE initiative_runs/)` 断言模式）。
3. 连坐修复：新增语句使既有按下标断言的 ~5 个用例下标后移，同 PR 内一并修正 mock 队列与下标。
4. PG 集成测试 `kernel-wiring.pg.integration.test.js` 调用真实路径但不断言 cost，预期不红；跑一遍确认。

守卫：纯逻辑接缝，CI regression test 即守卫（proven-to-fire：commit-1 亲眼红过）。

## 验收

- commit-1 failing test 红 → commit-2 实现绿
- 全量 attempt-store 测试绿 + PG 集成不回归
- DevGate 三关（facts-check / check-version-sync / check-dod-mapping）+ brain version bump
- CI 全绿，PR 合并
