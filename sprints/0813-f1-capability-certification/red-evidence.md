# Red 证据 — F1 Capability 可信认证闭环

合同测试随 GAN contract import 已存在于本分支（relay 常态），Red commit 记录测试基线与预期红证据。

## 预期红（认证闸未实现时）

`packages/brain/src/lib/map-state-resolver.js` 的 `resolveEvidenceState` 此前只要
`receipt.verdict === 'PASS'` + `assertion_revision` 匹配 + `source_sha` 匹配即投 `green`，
**不校验**：signed GP contract 存在性 / receipt `gp_contract_id` 绑定 / `impact_contract_id` 绑定 /
step-link `feature_id`+`assertion_ref` 绑定。

因此下列 fail-closed 断言在闸实现前全部 FAIL（capability 现为 green）：

- 集成测试 `tests/f1-capability-certification.integration.test.ts`
  - 「无 signed GP contract 时 F1 非绿」→ 现为 green（FAIL）
  - 「receipt 未绑定 gp_contract_id 时非绿」→ 现为 green（FAIL）
  - 「receipt 未绑定 impact 时非绿」→ 现为 green（FAIL）
  - 「step link 未绑定 feature/assertion 时非绿」→ 现为 green（FAIL）
  - 「evaluator writer 绑定 gp_contract_id」→ 写侧未落 gp identity（FAIL）
- E2E oracle `tests/f1-cert-harness.mjs --mode=full`
  - S1/S3/S5 观察到 green → harness `exit 1`（红证据）

## 运行说明

集成测试与 harness 需真 PostgreSQL（`TEST_DATABASE_URL` / `DB_URL` 指向 `*_test`/`*_scratch` 或 Fleet 注入空库）；
本机（fleet-worker）无 PG server（仅 libpq 客户端），故 Red/Green 真跑由 `brain-integration` CI job 与 evaluator 真库执行。
DB-independent 单测（`map-state-resolver.test.js` / `assertion-receipts.test.js` / `routes/map.test.js`）本机全绿（24/24），
证明 `aggregateMapStates` 冒泡改动与 `resolveEvidenceState` 新增可选认证参数不破坏既有聚合契约与写侧 mock 调用序。
