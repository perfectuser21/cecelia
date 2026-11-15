- [x] 清退旧 Harness Final E2E 启停及专属 Compose、旧合同 lint、退役根回填入口及专属测试；不增加退役占位守卫。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] Ops 自动发现继续执行现役部署与容量保护回归，移除旧预览文字测试。
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [x] 现役容量阈值及并发预留行为测试通过，事实、版本与DoD映射一致。
  Test: manual:npm exec -w packages/brain -- vitest run --config vitest.integration.config.js src/__tests__/integration/capacity-gate.test.js
- [x] 固定候选源码CI通过后正常合并，读回Task合并证据并清理本次工作树，不部署生产。
  Test: manual:bash -c 'gh pr checks --repo perfectuser21/cecelia'
