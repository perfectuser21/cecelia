# Contract — 合同封存补齐任务 Sprint 上下文

任务：0994ab2a-0033-4225-9168-485350c5fc39。target_environment: local_api。journey_type: dev_pipeline。

## 批准范围

materializeApprovedContract 从 validateContractArtifacts 验证后的唯一 contract-draft.md 根取得 Sprint 路径。在同一封存事务内锁定 run.current_task_id，缺值时仅写 payload.sprint_dir，同根保持幂等；非对象 payload、多根或异根拒绝。无 artifacts 的旧调用不推测路径。附着 approved 的证据必须匹配后才修复缺值。合同、seal、run 附着与任务上下文任何一步失败全部回滚。

## 授权边界

不提供任意 payload 写接口；不修改 branch、base_sha、routing_receipt_id、status、target_environment 或身份。无 schema/drop、无 PF/网络变更。源码与永久测试属于本任务，与父任务及 PF 独立。

## 验证命令

```bash
DB_NAME=cecelia_scratch npx vitest run sprints/tests/contract-task-context.test.mjs
cd packages/brain && DB_NAME=cecelia_scratch DB=cecelia_scratch POSTGRES_INTEGRATION=1 npx vitest run --config vitest.integration.config.js src/__tests__/integration/contract-task-context.pg.integration.test.js src/orchestrator/__tests__/contract-store.test.js
```

原生入口由 Vitest 执行，启动永久测试子进程并验证成功结果，无重复业务断言；CI brain-integration 已显式运行整个 src/__tests__/integration/ 目录。测试仅建连接私有临时表，不写业务真身表。

## E2E 验收（target_environment: local_api）

真实 PostgreSQL 连接私有临时表中运行正式 materializeApprovedContract：封存后 SELECT 回读 task.payload 与 run.contract_id，校验缺值修复和原授权字段完整；已批准合同同根重封不增合同与 seal；异根拒绝、合同写入和上下文写入失败都回读零增及原 payload。

```bash
set -euo pipefail
cd packages/brain
DB_NAME=cecelia_scratch DB=cecelia_scratch POSTGRES_INTEGRATION=1 npx vitest run --config vitest.integration.config.js src/__tests__/integration/contract-task-context.pg.integration.test.js
```

通过标准：13 条真实 PostgreSQL 行为断言全部通过、进程 exit 0；任何失败或无测试阻断。本段验证候选的数据库行为，不代替部署后正式 API seal 回读或 native evaluator/Judge 裁决。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 原生执行入口 | `sprints/tests/contract-task-context.test.mjs` | `native entry executes the permanent PostgreSQL contract context suite` | 真子进程运行同一永久回归，异常退出拒绝 |
| 永久事务回归 | `packages/brain/src/__tests__/integration/contract-task-context.pg.integration.test.js` | `fills missing sprint_dir from sealed artifacts and preserves task authority`; `repairs missing context on an already approved identical seal`; `keeps same-root reseals idempotent`; `rejects conflicting task context without creating or attaching a contract`; `rejects multiple draft roots before persisting any task context`; `rolls back task context if seal persistence fails` | fb6b83aa46，真实 PostgreSQL 7失败4通过 |
| F1 合同上下文边界 | `tests/gp/f1/step2-direct-contract-artifact-root.test.js` | `approved task context rejects ambiguous Git roots before acquiring a database lease` | 原封存逻辑不会在数据库租约前拒绝两个draft根 |
| 既有根合同登记回归 | `sprints/tests/root-contract.test.mjs` | `根合同登记通过且子Sprint孤儿仍被真实守卫拒绝` | main 已合入5793的永久根/子归属守卫，保留并登记 |
