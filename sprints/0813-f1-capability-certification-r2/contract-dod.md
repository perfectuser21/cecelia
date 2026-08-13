---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: F1 Capability 认证闭环（冻结 GP Contract identity 贯穿 Evaluator Receipt 与 Mapper）

**范围**: writer 精确落冻结 GP identity + mapper 五重判绿 + 真 PG 五级外键链 fixture + dispatcher/evaluator 透传，复用现有表/API，无新表
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] writer 读取 inputs.gp_contract 并落 gp_contract_id/gp_contract_hash 列（去除按 Journey 猜最新 signed GP）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/assertion-receipts.js','utf8');if(!c.includes('gp_contract'))process.exit(1)"

- [ ] [ARTIFACT] state-resolver 收紧 green 判据（synthetic/executor_kind/gp_contract/impact_contract/子节点齐备）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/map/state-resolver.js','utf8');if(!/synthetic|executor_kind|gp_contract/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 真 PG 五级外键链集成 fixture 存在并注册进 POSTGRES_INTEGRATION_TESTS
  Test: node -e "const p='packages/brain/src/__tests__/integration/f1-gp-identity-closure.integration.test.js';const cfg=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!require('fs').existsSync(p)||!cfg.includes('f1-gp-identity-closure.integration.test.js'))process.exit(1)"

- [ ] [ARTIFACT] TDD RED 证据留存（Red→Green 时序，PRD NFR 第 63 行）
  Test: node -e "const c=require('fs').readFileSync('sprints/0813-f1-capability-certification-r2/tests/RED-evidence-round1.log','utf8');if(!/3 failed/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: writer 冻结 GP identity 单元红转绿全过
  动作: 跑 sprint writer 单测（无 PG），验证 4 个用例（精确落库/缺失 fail-closed/串绑 fail-closed/legacy NULL）全绿
  预期观察: vitest 报 `Tests 4 passed`（当前实现为 3 failed，见 RED-evidence-round1.log）
  等待预算: 0s
  留证: /tmp/f1-writer.log 末 5 行
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/0813-f1-capability-certification-r2/tests/gp-identity-writer.test.js 2>&1 | tee /tmp/f1-writer.log | grep -qE "Tests[[:space:]]+4 passed"'

- [ ] [BEHAVIOR] [L2] B-02: 冻结 GP identity 精确落库且反串绑（真 Postgres 写路径）
  动作: 真 PG 播种同 Journey 两个 signed GP（旧=冻结/新=更晚 version），以冻结旧 id 组 bundle 跑 writer，读回 receipt 行
  预期观察: 落库行 gp_contract_id=冻结旧 id、gp_contract_hash=冻结旧 hash；新 GP id/hash 绝不出现
  等待预算: 0s
  留证: /tmp/f1-b02.log（it 内 client.query 断言输出）
  Test: manual:bash -c 'cd /workspace/packages/brain && DATABASE_URL="$DB_URL" npx vitest run --config vitest.integration.config.js src/__tests__/integration/f1-gp-identity-closure.integration.test.js -t "精确落库" 2>&1 | tee /tmp/f1-b02.log | grep -qE "Test Files[[:space:]]+1 passed"'

- [ ] [BEHAVIOR] [L2] B-03: identity 缺失/与 DB signed hash 不一致 → fail-closed，不落半条（真 Postgres）
  动作: 真 PG 下分别以「gp_contract 缺字段」「hash 与 DB signed content_hash 不符」组 bundle 跑 writer
  预期观察: writer 抛 assertion_receipt_evidence_invalid(409)，journey_assertion_receipts 无新增行
  等待预算: 0s
  留证: /tmp/f1-b03.log
  Test: manual:bash -c 'cd /workspace/packages/brain && DATABASE_URL="$DB_URL" npx vitest run --config vitest.integration.config.js src/__tests__/integration/f1-gp-identity-closure.integration.test.js -t "fail-closed" 2>&1 | tee /tmp/f1-b03.log | grep -qE "Test Files[[:space:]]+1 passed"'

- [ ] [BEHAVIOR] [L2] B-04: mapper 五重判据 green/非green（真 Postgres）
  动作: 真 PG 播种五路 receipt——五重全满足/synthetic=true/错 gp_contract_id/旧 source_sha/缺 Feature 子节点，逐路调 resolveNodeState
  预期观察: 全满足路 state=green；其余四路 state!=green
  等待预算: 0s
  留证: /tmp/f1-b04.log
  Test: manual:bash -c 'cd /workspace/packages/brain && DATABASE_URL="$DB_URL" npx vitest run --config vitest.integration.config.js src/__tests__/integration/f1-gp-identity-closure.integration.test.js -t "mapper 五重" 2>&1 | tee /tmp/f1-b04.log | grep -qE "Test Files[[:space:]]+1 passed"'

- [ ] [BEHAVIOR] [L2] B-05: 真 PG 五级外键链 fixture 播种成功不违反 migration 409/374 约束
  动作: 空库 migrate 后，事务内播种 tasks→initiative_runs→harness_impact_contracts→harness_attempts→journey_assertion_receipts（含前置 golden_path_contract_versions/journey_step_links）
  预期观察: 五级链全部 INSERT 成功，无 FK/CHECK/append-only 违反
  等待预算: 0s
  留证: /tmp/f1-b05.log
  Test: manual:bash -c 'cd /workspace/packages/brain && DATABASE_URL="$DB_URL" npx vitest run --config vitest.integration.config.js src/__tests__/integration/f1-gp-identity-closure.integration.test.js -t "五级外键链" 2>&1 | tee /tmp/f1-b05.log | grep -qE "Test Files[[:space:]]+1 passed"'

- [ ] [BEHAVIOR] [L2] B-06: 空库 migrate 后 writer 真实写入非空 gp_contract_id 的 receipt 行（真 Postgres 效果确认）
  动作: 空库 node src/migrate.js 后，集成测试事务内以冻结 identity 跑 writer，psql 级 client.query 读回该 receipt
  预期观察: 读回行 gp_contract_id IS NOT NULL 且 synthetic=false 且 executor_kind='brain_assertion_runner'（当前实现落 NULL → 该 it 红）
  等待预算: 0s
  留证: /tmp/f1-b06.log
  Test: manual:bash -c 'cd /workspace/packages/brain && DATABASE_URL="$DB_URL" npx vitest run --config vitest.integration.config.js src/__tests__/integration/f1-gp-identity-closure.integration.test.js -t "非空 gp_contract_id" 2>&1 | tee /tmp/f1-b06.log | grep -qE "Test Files[[:space:]]+1 passed"'
