# PRD: Harness v2 M5 — Initiative 级 Final E2E + 失败归因

分支: cp-04200957-harness-v2-m5-final-e2e
Milestone: M5（对齐 `docs/design/harness-v2-prd.md` §8 实施里程碑）
PRD 主文档: `docs/design/harness-v2-prd.md`（由主 worktree 维护，不在本 PR commit）

---

## 背景

Harness v2 把 Initiative 的生命周期切成三阶段：

* 阶段 A（M1-M3）— 一次性规划 + GAN 对抗合同
* 阶段 B（M4）— Task 级顺序合并 + CI Gate + Evaluator
* **阶段 C（M5，本 PR）— Initiative 级真实 E2E 收尾 + 失败归因**

M1-M4 已合并到 main：
- #2439 M1 数据模型（initiative_contracts / task_dependencies / initiative_runs）
- #2442 M2 Planner + DAG + harness-initiative-runner.js
- #2445 M3 GAN 合同 v2
- #2449 M4 Task 级循环 + Generator Fix + CI Gate + Evaluator

本 PR 补上阶段 C 的收尾机制：Initiative 所有 Task 合完后，起真实三件套（PG 55432 / Brain 5222 / Frontend 5174）按 `initiative_contracts.e2e_acceptance` 逐条跑 curl/playwright，收集失败场景，按 `covered_tasks` 归因到具体 Task，触发 Fix 循环；超过 3 轮仍 FAIL 则标 Initiative failed。

## 范围

### 新建

* `packages/brain/src/harness-final-e2e.js` — 纯业务逻辑编排（mock-friendly）
  * `runFinalE2E(initiativeId, contract, opts)` — 主入口，返回 verdict + failedScenarios
  * `attributeFailures(failedScenarios)` — 按 covered_tasks 聚合
  * `runScenarioCommand` / `normalizeAcceptance` / `bootstrapE2E` / `teardownE2E` — 工具函数
* `scripts/harness-e2e-up.sh` — 启动 staging 三件套 + 健康探测
* `scripts/harness-e2e-down.sh` — 清理（compose down -v + pkill）
* `docker-compose.e2e.yml` — 仅含 postgres:17，端口 55432:5432
* 单元测试 2 个（mock-based）：
  * `src/__tests__/harness-final-e2e.test.js`（34 用例）
  * `src/__tests__/harness-initiative-runner-phase-c.test.js`（17 用例）

### 修改

* `packages/brain/src/harness-initiative-runner.js`
  * 新增导出 `checkAllTasksCompleted(initiativeTaskId, client)` — 判所有子 task 是否 completed
  * 新增导出 `createFixTask(...)` — 建 fix-mode `harness_task`（携带 fix_round + 失败证据）
  * 新增导出 `runPhaseCIfReady(initiativeTaskId, opts)` — 阶段 C 推进器
  * `runInitiative` 阶段 A 逻辑不改，向后兼容 M2 入库契约

### 不做

* 不跑真 docker-compose（生产路径由 `harness-e2e-up.sh` 在 E2E 时起）
* 不改 `harness-graph.js`（阶段 B 已在 M4 完成）
* 不改 migrations（schema 在 M1 已定）
* 不删 v1 兼容代码
* 不做 M6 Dashboard / Preview / 飞书（留给下一个 PR）

## e2e_acceptance jsonb 结构（合同 SSOT）

```jsonc
{
  "scenarios": [
    {
      "name": "Initiative KPI 查询链路",
      "covered_tasks": ["task-uuid-1", "task-uuid-2"],
      "commands": [
        { "type": "curl",       "cmd": "curl -sf http://localhost:5222/api/brain/tick/status" },
        { "type": "playwright", "cmd": "node tests/e2e/dashboard-kpi.js" }
      ]
    }
  ]
}
```

- `covered_tasks` 是本 scenario 的归因锚点：scenario 失败 → 归因到全部 covered_tasks
- `commands[]` 内 fail-fast —— 第一条失败即算整条 scenario 失败

## 状态机

```
                         ┌─────── not_ready ─────── tick 稍后重试
                         │
parent harness_initiative│    ┌─── e2e_pass ────→ initiative_runs.phase='done' + completed_at=NOW()
         │               │    │
         └→ runPhaseCIfReady → ├─── e2e_fail ────→ 建 fix harness_task + phase='B_task_loop'
                              │
                              └─── e2e_failed_terminal ──→ phase='failed' + failure_reason
                                   （fix_round > MAX_FIX_ROUNDS=3 时）
```

## 成功标准

1. 对合法 contract.e2e_acceptance 输入，`runFinalE2E` 按 scenarios 顺序跑完，verdict ∈ {PASS, FAIL}
2. verdict=FAIL 时，`attributeFailures` 按 covered_tasks 聚合，同 Task 被多 scenario 击中 failureCount 累加
3. `runPhaseCIfReady` 子任务未全完成时返回 not_ready，不调 runFinalE2E
4. E2E PASS → initiative_runs.phase='done' + completed_at=NOW()
5. E2E FAIL 且所有 Task fix_round ≤ 3 → 为每个归因 Task 建 fix-mode harness_task，phase 回 'B_task_loop'
6. E2E FAIL 且任一 Task fix_round > 3 → phase='failed'，failure_reason 写入 DB
7. scripts/harness-e2e-up.sh 按顺序起 PG → migrate → Brain → Frontend，任一 timeout 返回非 0
8. `docker-compose.e2e.yml` 用独立端口 55432、独立数据卷 e2e-pgdata，不与 production 冲突

## 风险与已知限制

* **e2e_acceptance.commands** 当前只支持 curl/node/playwright CLI，shell pipeline/redirect 由 execSync 透传，未做 shell 注入校验。信任链在合同 GAN APPROVED 阶段建立。
* **bootstrapE2E failure 归因** 把所有 scenario 的 covered_tasks 都算进去（去重），避免"起不来 → 归因空集 → 无 Task 回 Generator"死循环。这会产生偶发假阳性（比如本地 docker 没开），需要配合 M6 Dashboard 让主理人看到再决定。
* **runPhaseCIfReady 要求 approved 合同** — 实际 M3 的 Reviewer APPROVED 动作会把 initiative_contracts.status 从 'draft' → 'approved'，相关代码已在 M3 合并。本 PR 只消费该状态。
* **parent.payload.initiative_id 兜底** 若未设 → 用 parent.id。这跟 runInitiative 的兜底行为一致，不违反 M2 契约。
