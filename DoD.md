- [x] 并行清退无调用旧Runner检查汇总、旧任务规划与提案弱smoke及专属文字测试，默认与未知输入Ops保护仍有效。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] 删除重复quota shell并同步smoke清单；保留现役额度loader、真实PG合同和HTTP投影，测试fixture不冒充真实西安转发配置。
  Test: manual:bash -c 'node --test packages/brain/scripts/smoke/__tests__/*.node-test.mjs'
- [x] 现役proposal生命周期/回滚、定时任务、任务状态、Golden Path HTTP及预算行为回归通过。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/proposal-apply.test.js src/__tests__/proposal-lifecycle.test.js src/__tests__/proposal-rollback-receipt.test.js src/__tests__/recurring-engine.test.js src/__tests__/task-state-behavior.test.js src/routes/__tests__/golden-paths.test.js src/routes/__tests__/capacity-budget.test.js
- [x] 五个Codex账号不再宣告旧西安转发目的地；真实采集成功/失败入库与HTTP读回验证false/[]，额度与实际授权不变。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/ops-model-accounts-collector.test.js src/orchestrator/preflight/account-quota-ledger.test.js
- [x] 三组结果独立复审后整合，固定候选源码CI通过再正常合并、回写任务并清理工作树，不部署生产。
  Test: manual:bash -c 'gh pr checks --repo perfectuser21/cecelia'
