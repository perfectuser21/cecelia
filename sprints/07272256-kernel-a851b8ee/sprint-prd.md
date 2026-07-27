# Sprint PRD — 收敛既有 Draft PR #4372 的 Kernel F1 基线验收

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

本 sprint 是 task `a851b8ee-1edb-4ade-b2c4-7c26dbf6b230` 的恢复规划，目标是收敛既有 Draft PR #4372，并以当前 `origin/main` 为真相重绑基线。旧 proposer commit `dc21fddda` 与 reviewer attempt `575b687a` 只保留为历史证据，不可直接继承批准；新合同必须围绕“真实隔离 DB、完整 fail-closed oracles、F1 Golden Path × 11 要素及 Claude Code P0/P1 等价基线”重新验收。

## Golden Path（核心场景）

用户/系统从 [既有 Draft PR #4372] → 经过 [main 新鲜度重绑、真实隔离 DB 双跑迁移、真实业务 oracle 全链执行] → 到达 [同一 SHA 下可复验且需人工审批的收敛合同]

具体：
1. 执行时先抓取当前 `origin/main`，若仍等于任务出生基线 `1dc9d4107` 则继续沿用；若已变化，则当场作废旧 evaluator/judge/human-review 证据，并把新 merge-base 作为唯一权威基线。
2. 系统只在 Draft PR #4372 上收敛六个重叠面：`DoD.md`、`packages/brain/DEFINITION.md`、`packages/brain/package.json`、`packages/brain/package-lock.json`、`packages/quality/smoke-allowlist.txt`、`regression-contract.yaml`，要求零冲突标记、零并行旧/新行为分叉。
3. 系统使用真实 `packages/brain/migrations/366_kernel_harness_f1_baseline.sql`，仅在语义需要时更新 `packages/brain/src/__tests__/integration/migration-365-kernel-harness-f1-baseline.integration.test.js`，对隔离白名单数据库经 `HARNESS_TEST_DATABASE_URL` 连跑两次迁移并记录前后快照，证明幂等、schema-history 落账与 fail-closed 收据校验。
4. 系统执行真实 contract、integration、endpoint、runtime-nonregression、DevGate、`gh` current-head 检查，并运行 `kernel-harness-f1-baseline-smoke.sh` 的七个精确模式：`unique-journey`、`history-and-backbone`、`cells-and-evidence`、`legacy-baseline`、`assertion-refs`、`endpoint-semantics`、`runtime-nonregression`。
5. 系统用真实适配器、路由、数据库与 GitHub 事实证明 11 个账本要素 `FR`、`NFR`、`Invariant`、`checkpoints`、`freshness`、`death_alert`、`failure_semantics`、`effect_confirmed`、`adversarial`、`ledger_status`、`axis_aligned` 的字段语义，同时验证 approve/reject 的字段级 schema oracle；任一 authority 记录或 PR head SHA 不匹配时必须失效并阻止 merge，最终停在人工审批前。

## 边界情况

- `origin/main` 已变更时，旧证据全部失效，但 Draft PR #4372 本身继续作为唯一收敛目标。
- DB 收据若解析出 loopback 主机、非显式白名单库名、或任何可能指向生产的痕迹，必须 fail closed，禁止迁移。
- Red 必须在依赖安装完成后因缺行为而失败；若失败原因是 vitest/config/缺模块，则视为合同不合格。
- `migration-365-executor-kind-kernel-process` 是合法既有测试，不在本 sprint 修改范围内。

## 范围限定

**在范围内**：重绑 `origin/main` 基线与 authority 失效规则；收敛 Draft PR #4372 的六个重叠面；真实 migration 366 双跑与收据白名单校验；F1 七个 smoke 模式与六类真实检查；11 个账本要素及 approve/reject 字段级 oracle；same-SHA 与新 head 失效语义。
**不在范围内**：新建 PR、把 Draft PR #4372 标记 Ready、修改无关 migration、保留 helper-existence/source-string theater、对生产数据库做任何写入。

## 假设

- [ASSUMPTION: `kernel-harness-f1-baseline-smoke.sh` 已存在于仓库且可按七个精确模式逐一执行，proposer 只需把其真实调用接入合同。]
- [ASSUMPTION: `HARNESS_TEST_DATABASE_URL` 可提供非 loopback 且显式隔离白名单数据库，满足“连跑两次迁移+快照”验收。]
- [ASSUMPTION: Draft PR #4372 仍处于 OPEN Draft 状态，且本 sprint 继续复用它而非创建新 PR。]

## 预期受影响文件

- `DoD.md`: 收敛业务 oracle 与人工审批停点描述
- `packages/brain/DEFINITION.md`: 同步 Kernel F1 基线能力定义与版本变更
- `packages/brain/package.json`: 对齐真实测试/脚本入口依赖
- `packages/brain/package-lock.json`: 锁定与 `package.json` 同步的依赖事实
- `packages/quality/smoke-allowlist.txt`: 收敛 F1 smoke 模式与 DevGate 放行面
- `regression-contract.yaml`: 固化本 sprint 的 executable acceptance contract
- `packages/brain/migrations/366_kernel_harness_f1_baseline.sql`: 作为唯一权威迁移脚本被验收
- `packages/brain/src/__tests__/integration/migration-365-kernel-harness-f1-baseline.integration.test.js`: 按语义需要更新 migration 366 的真实幂等验证

## NFR 约束

- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Claude Code P0/P1 等价基线必须保持一致
- 可观测: 失败必须提供真实 DB/GitHub/authority 收据，并对 same-SHA 与新 head 失效给出字段级证据

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [共享文件禁区] 跨 sprint 共享 CI 判定文件如 `packages/quality/smoke-allowlist.txt` 未经合同显式授权不可修改，若自身改动触发 CI 红需在本合同内明示（来源: area）
- [SHA锚定] PR head SHA 必须与 evaluator/judge verdict 文件及实际合并 SHA 对账一致，发生漂移时不得沿用旧证据（来源: area）
- [真环境验证] 依赖真实 DB、真实 GitHub head、真实 authority 记录的接缝断言，未在真目标上验证前不得标 done（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块先锚定端到端必须验到的真实业务结果；最终可执行脚本由 proposer 按 `local_api` 环境写入合同。

```bash
# 占位：proposer 将填入真实脚本，至少覆盖以下业务终点
# 1. 抓取 origin/main 与 PR #4372 当前 head，对比任务出生基线 1dc9d4107，验证 unchanged-main 通过或 old-evidence 失效
# 2. 用 HARNESS_TEST_DATABASE_URL 连跑 migrate.js 两次，快照迁移前/后与 schema-history，且 receipt 白名单检查通过
# 3. 运行真实 contract、integration、endpoint、runtime-nonregression、DevGate、gh current-head 检查
# 4. 逐一运行 kernel-harness-f1-baseline-smoke.sh 的七个模式并验证 11 个账本要素语义
# 5. 验证 approve/reject 字段级 schema oracle，以及 same-SHA authority 记录与新 head 失效规则
```

## journey_type: autonomous
## journey_type_reason: 任务聚焦 `packages/brain/` 合同、迁移、DB 与 GitHub 权威核验，属于纯后端自主收敛
## target_environment: local_api
## target_environment_reason: payload 已显式指定 `local_api`，验收依赖本地 Brain API、PostgreSQL 与 `gh` 事实，不涉及前端或远端真机
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
