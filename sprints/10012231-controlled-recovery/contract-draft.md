# Contract — 受控再基恢复

任务：2e39312a-eb63-474d-9a47-1c9280193cb3。target_environment: local_api。journey_type: dev_pipeline。

## 批准范围

只允许内部鉴权 canonical relay-runs 入口的显式 recovery_rebase、同任务最新 failed 前任、无活动 run/attempt、期望旧收据、fresh Map 当前 base、同仓同分支实际 head 及 Git 血统。planning 重新签发 Controller/run，事务内 append-only 收据与事件；旧 run/receipt/合同不改，新 run 不继承旧裁决。原有限制保持，旧 adapter 拒绝。无数据库 schema、网络或设备变更。

实现边：packages/brain/src/orchestrator/recovery-rebase.js、kernel-run-store.js 与 packages/brain/src/routes/initiatives.js；永久 unit、真实 PG integration、F1 HTTP入口回归、版本/DEFINITION 及本合同为执行工件。

## E2E 验收（target_environment: local_api）

```bash
set -euo pipefail
npx vitest run tests/gp/f1/step1-controlled-recovery.test.js --maxWorkers=1 --minWorkers=1
cd packages/brain
npx vitest run src/orchestrator/__tests__/recovery-rebase.test.js src/orchestrator/__tests__/kernel-run-store.test.js src/__tests__/relay-runs-canonical-create.test.js src/orchestrator/preflight/base-sha-reanchor.test.js --maxWorkers=1 --minWorkers=1
```

通过标准：真 HTTP 入口 401/201，新 Controller/receipt、保留旧记录，四套永久测试全过、进程退出0。真实 PG 六项事务、并发、回滚与实际地图 preflight 必须在隔离库另跑，永久进入 postgres-integration CI。native evaluator/Judge/完整CI/上产恢复903e均需真实证据，不能以本地PASS替代。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 原生入口 | `sprints/10012231-controlled-recovery/tests/recovery-entry.test.mjs` | `native entry verifies authenticated recovery and original guard` | 旧 main 永久回归4失败2通过，真实F1入口400而非401 |
