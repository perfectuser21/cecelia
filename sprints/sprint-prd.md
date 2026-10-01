# Sprint PRD — 合同封存补齐任务 Sprint 上下文

## 背景与目标

任务 0994ab2a-0033-4225-9168-485350c5fc39，父任务 903e9956-f677-4af0-9d6f-53ddae717143，关联 e3001293-281c-4ea6-a793-8c03af84aa63。正式合同封存已绑定 run.contract_id，但原 headed task 未提供 sprint_dir 时，下一真实 native TaskBundle 无法定位合同。通用 PATCH 任务不能改 payload。

## Golden Path

1. 操作者以正式 contract-seal 提交已批准 Git SHA 与合同根。
2. 系统校验 Git 产物、唯一合同根和已批准证据，同事务锁定 run 所绑定任务。
3. 缺值任务仅补 payload.sprint_dir；同根重复请求幂等；异根拒绝并回滚。
4. 下一真实 native bundle 使用任务的 Sprint 上下文，原身份与路由授权保持不变。

## 范围

只修改 contract-store 封存事务、真实 PostgreSQL 永久回归与既有 Sprint 合同、版本同步。无 schema 变更，无通用 payload 写入口，不变更 branch/base_sha/routing/status/target_environment，不修改 PF 或网络。

## 测试策略

真实 PostgreSQL 临时表覆盖缺值补齐、已批准合同重封、同根幂等、异根与多根拒绝、封存和上下文写入失败双向回滚、其他 payload 字段保持。永久 CI 测试位于 packages/brain/src/__tests__/integration/contract-task-context.pg.integration.test.js；原生入口 sprints/tests/contract-task-context.test.mjs 只启动同一套断言的 Vitest 子进程，使用仓库根 Vitest loader。

## 验收

永久 failing 测试先提交，修复绿测、DevGate、独审、全 CI；真实 native seal/evaluator/Judge 后正式合并部署，再以 API 回读源任务上下文和后续 native bundle，不伪造事件或裁决。

## journey_type: dev_pipeline
## target_environment: local_api
## target_environment_reason: Brain 合同事务与真实 PostgreSQL 行为，无浏览器变化
## map_scope: F1, MJ5
