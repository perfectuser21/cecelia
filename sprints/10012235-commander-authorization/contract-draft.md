# Contract — Commander 公开授权说明分类

任务：88049aa6-d4fd-4acd-8cb8-0cdf71481691。target_environment: local_api。journey_type: dev_pipeline。

## 批准范围

仅 parseCommanderProfile 的任务 payload 边，对 user_authorization 做字符串、4000字上限、凭据标签拒绝及现有 redactSecrets 恒等检查，然后从安全扫描副本排除该字段；原 payload 不修改，其他字段递归扫描与所有 Actor/Directive/Bundle 扫描不变。拒绝隐含秘密文本、对象、数组及超长说明。无 schema、无网络、无执行模式改动。

实现路径为 packages/brain/src/orchestrator/commander-profile.js；永久测试在 packages/brain/src/orchestrator/__tests__/commander-profile.test.js；Brain 六面版本同步与 DEFINITION.md 更新；仅本 Sprint 合同及原生测试入口为附属执行工件。

## E2E 验收（target_environment: local_api）

```bash
set -euo pipefail
cd packages/brain
DB_NAME=cecelia_scratch npx vitest run src/orchestrator/__tests__/commander-profile.test.js src/orchestrator/__tests__/commander-contract.test.js src/orchestrator/__tests__/commander-bundle.test.js src/orchestrator/__tests__/commander-store.test.js --maxWorkers=1 --minWorkers=1
```

通过标准：四个指定永久套件全部通过、实际行为断言全通过且无跳过、进程 exit 0；真实 task.payload 形状与秘密拒绝分别验证，无 mock profile 或 secret 判定。native evaluator/Judge 必须正式运行，不能用本地 PASS 替代。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 正式原生入口 | `sprints/10012235-commander-authorization/tests/commander-authorization.test.mjs` | `native entry executes permanent task authorization and secret rejection suites` | 永久真实 task.payload 回归在原 main 上2失败20通过：secret_material_forbidden |
