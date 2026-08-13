---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness Evaluator 真环境取证闭环 r2（PG runtime 自动申请 + Judge 反馈回灌）

**范围**: `packages/brain/src/orchestrator/{dispatcher,derive,execution-contract}.js`、`preflight/requirements.js`、`harness-judge.js` 及配套测试；合同→PG capability 机械派生 + fail-closed + judge 缺证反馈跨轮回灌 + 必验项 unverifiable 禁 PASS + 同 SHA 一次收敛。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `preflight/requirements.js` 导出 `contractRequiresPostgres`，并让 `deriveCapabilityRequirements` 接受 `contract` 入参
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/preflight/requirements.js','utf8');if(!/contractRequiresPostgres/.test(c)||!/\bcontract\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 新 PG 集成测试文件存在且已注册进 `POSTGRES_INTEGRATION_TESTS`（否则 CI 不跑）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('harness-evaluator-pg-recollect.pg.integration.test.js'))process.exit(1)"

- [ ] [ARTIFACT] PG 集成测试从 `DB_URL`（或 DB_DEFAULTS）建隔离库，库名含 pid 会话独享（禁固定库名，遵守 INV 多租户/禁写死环境）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/integration/harness-evaluator-pg-recollect.pg.integration.test.js','utf8');if(!/process\.pid/.test(c)||!/CREATE DATABASE/.test(c))process.exit(1)"

- [ ] [ARTIFACT] dispatcher fail-closed 单测断言 `control_status==='BLOCKED'`（防假绿：必须真断言 BLOCKED，非只跑不判）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/dispatcher-pg-capability.test.js','utf8');if(!c.includes('BLOCKED')||!c.includes('judge_feedback'))process.exit(1)"

## BEHAVIOR 条目（五行剧本，evaluator 逐条真执行）

- [ ] [BEHAVIOR] [L2] B-01: 批准合同含 psql 命令 → runtime PG capability 机械派生 true
  动作: 调 `contractRequiresPostgres(含 psql 的合同文本)` 与 `deriveCapabilityRequirements({role:'evaluator',requirements:{},contract:该文本})`
  预期观察: 两者均判定需要 PG，`postgres===true`（未手填 requirements.postgres 也成立）
  等待预算: 0s
  留证: vitest -t 输出末 5 行（含 PASS 行）进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && node /workspace/node_modules/vitest/vitest.mjs run src/orchestrator/preflight/requirements-contract-pg.test.js -t "合同含 psql 命令派生 postgres 为 true" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 合同/payload 均无 PG 要求 → 不派生 PG（不回退老路，边界不变）
  动作: 调 `deriveCapabilityRequirements({role:'evaluator',requirements:{},contract:'纯 curl 无 psql 的合同'})`
  预期观察: `postgres===false`，node_deps 默认路径不受影响
  等待预算: 0s
  留证: vitest -t 输出末 5 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && node /workspace/node_modules/vitest/vitest.mjs run src/orchestrator/preflight/requirements-contract-pg.test.js -t "无 PG 要求合同派生 postgres 为 false" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: PG 不可供给 → dispatcher fail-closed 返回 control_status=BLOCKED，未创建 attempt
  动作: 以 requirements.postgres=true 但 preflightGate 返回 status!=ok 驱动真实 `dispatch()`
  预期观察: 返回 `control_status==='BLOCKED'` 且 `should_create_attempt===false`，attemptStore.createAttempt 未被调用
  等待预算: 0s
  留证: vitest -t 输出末 5 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && node /workspace/node_modules/vitest/vitest.mjs run src/orchestrator/__tests__/dispatcher-pg-capability.test.js -t "PG 不可供给返回 control_status BLOCKED" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: Evaluator 执行位真跑 PG，留 stdout/stderr/exit code（真环境核心）[接缝×2]
  动作: 在 runtime_resources.postgres=true 执行位真实 psql 建隔离库 + 建表 + 查行（集成测试真库跑）
  预期观察: psql 命令 exit_code=0，隔离库真实建成、查得到写入行；证据（exit code + psql 输出）可采集进 behavior_tests[].log_tail
  等待预算: 60s
  留证: PG 集成测试 -t 输出（含 psql exit code / count 行）进 behavior_tests[].log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && export DATABASE_URL="$DB_URL" NODE_ENV=test && node /workspace/node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/harness-evaluator-pg-recollect.pg.integration.test.js -t "PG 真跑留 exit code" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 合同必验项 unverifiable（要求 PG 但执行位无 PG）→ verdict 不为 PASS
  动作: 调 execution-contract 出口守卫，输入「合同要求 postgres 但 runtime_resources.postgres!=true / behavior_tests 缺 PG 真跑证据」
  预期观察: 守卫强制 `verdict !== 'PASS'`（归 FAIL/DONE_WITH_CONCERNS，failure_class 反映缺证）
  等待预算: 0s
  留证: vitest -t 输出末 5 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && node /workspace/node_modules/vitest/vitest.mjs run src/orchestrator/execution-contract-unverifiable.test.js -t "必验项 unverifiable 时 verdict 不为 PASS" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: Judge evidence_insufficient → 缺证清单结构化落库 + 下一轮 evaluator bundle inputs 携带 judge_feedback（真库全链）[接缝×2]
  动作: 真库写入 judge evidence_insufficient verdict（含 missing_evidence）→ 触发 recollect → 组装下一轮 Evaluator TaskBundle
  预期观察: 落库 verdict 的 `missing_evidence` 为非空数组；recollect bundle `inputs.judge_feedback.missing_evidence` 非空且 `raw_feedback` 非空，与上一轮不同构
  等待预算: 60s
  留证: PG 集成测试 -t 输出（含 missing_evidence / inputs.judge_feedback 断言）进 behavior_tests[].log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && export DATABASE_URL="$DB_URL" NODE_ENV=test && node /workspace/node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/harness-evaluator-pg-recollect.pg.integration.test.js -t "judge evidence_insufficient 落库 missing_evidence 非空" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-07: 同 SHA 已 recollect 一次仍 evidence_insufficient → derive 收敛 wait:human_review（不再重派 evaluator）
  动作: 回放 decisionLog（同 head_sha 已有 `judge_evidence_insufficient_recollect` + 再次 evidence_insufficient）走真实 `derive`
  预期观察: 路由 `action==='wait:human_review'`（reason=`evidence_insufficient_after_recollect`），不再 `spawn:evaluator`
  等待预算: 0s
  留证: vitest -t 输出末 5 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && node /workspace/node_modules/vitest/vitest.mjs run src/orchestrator/__tests__/derive-recollect-convergence.test.js -t "同 SHA 已 recollect 一次再判不足收敛 wait human_review" --reporter=verbose'

## Invariant 覆盖（PRD 铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [真环境验证]: PG 必验项在执行位真跑并留 exit code（由 B-04 覆盖，禁 source-only 假绿）
  动作: 见 B-04
  预期观察: psql 真实 exit_code=0 证据入 behavior_tests[]，非仅引用 GitHub CI
  等待预算: 60s
  留证: 同 B-04
  Test: manual:bash -c 'cd /workspace/packages/brain && export DATABASE_URL="$DB_URL" NODE_ENV=test && node /workspace/node_modules/vitest/vitest.mjs run --config vitest.integration.config.js src/__tests__/integration/harness-evaluator-pg-recollect.pg.integration.test.js -t "PG 真跑留 exit code" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-5 [先分证据缺陷]: evidence_insufficient 走 evaluator 补证/收敛人审，不误派 generator-fix（由 B-07 覆盖）
  动作: 见 B-07
  预期观察: 路由为 evaluator recollect 或 wait:human_review，任何分支均不出现 `spawn:generator-fix`
  等待预算: 0s
  留证: 同 B-07
  Test: manual:bash -c 'cd /workspace/packages/brain && node /workspace/node_modules/vitest/vitest.mjs run src/orchestrator/__tests__/derive-recollect-convergence.test.js -t "同 SHA 已 recollect 一次再判不足收敛 wait human_review" --reporter=verbose'

- INV-2 [禁写死环境]: PG 隔离库名写入侧=校验侧同一变量 → 由 [ARTIFACT] 隔离库 pid 断言 + B-04 集成测试单一 databaseName 变量贯穿覆盖
- INV-3 [多租户/会话独享]: 隔离库名含 pid+uuid → 由 [ARTIFACT] `process.pid` 断言覆盖
- INV-4 [租户隔离]: 隔离库 attempt 独享、用完销毁 → 由 B-04 集成测试 afterAll DROP DATABASE 覆盖
- INV-6 [judge证据结构]: `.brain-result` 顶层 exit_code+log_tail+behavior_tests[]（每条含 exit_code+log_tail）+ missing_evidence 结构化 → 由 B-05/B-06 覆盖

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A —— 被改的边全部真跑：dispatcher/derive 真函数、judge/recollect 真 Postgres、PG 必验命令真 psql。preflightGate 作为 dispatcher 外部注入依赖在 B-03 单测里以 stub 提供 status 输入，属「更外层无关依赖」，非被改的边。）
