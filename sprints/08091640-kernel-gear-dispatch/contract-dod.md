---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel 真读 gear：三档在 orchestrator 状态机内分流

**范围**: `orchestrator/derive.js` 按 gear 三档分叉 + `initiative_runs.gear` 列 + gear 读入 run context（run 行→observed.gear）+ 非法 gear kernel 侧 fail-closed。**不在范围**：不建 gear=param 档、不动入口强制、不改旧 relay prompt/env、不改 controller SKILL。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 396 新增 `initiative_runs.gear` 列（nullable）
  Test: manual:bash -c 'ls "${REPO_ROOT:-/workspace}"/packages/brain/migrations/396_*.sql >/dev/null 2>&1 && grep -qiE "ALTER TABLE +initiative_runs" "${REPO_ROOT:-/workspace}"/packages/brain/migrations/396_*.sql && grep -qi "gear" "${REPO_ROOT:-/workspace}"/packages/brain/migrations/396_*.sql'
  期望: exit 0

- [ ] [ARTIFACT] `kernel-run-store.createKernelRun` INSERT 增写 gear 列
  Test: manual:bash -c 'grep -q "gear" "${REPO_ROOT:-/workspace}"/packages/brain/src/orchestrator/kernel-run-store.js'
  期望: exit 0

- [ ] [ARTIFACT] 新集成测试登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS
  Test: manual:bash -c 'grep -q "kernel-gear-dispatch.pg.integration.test.js" "${REPO_ROOT:-/workspace}"/packages/brain/vitest.config.js'
  期望: exit 0

## BEHAVIOR 条目（五行剧本 · 内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: gear=hotfix 初始态跳过 planner 直进 generate
  动作: 调 derive({...初始态 prdExists=false, contract.approved=false, gear:'hotfix'})（经 brain-unit CI 跑 derive.test.js gear 用例）
  预期观察: 返回 {phase:'generate', action:'spawn:generator'}，action 不等于 'spawn:planner'
  等待预算: 0s
  留证: vitest 输出末 5 行（含 passed 统计）
  Test: manual:bash -c 'cd "${REPO_ROOT:-/workspace}/packages/brain"; L=$(npx vitest run src/orchestrator/__tests__/derive.test.js -t "不等于 spawn:planner" --reporter=dot 2>&1); echo "$L" | grep -qE "Tests +[0-9]+ passed" && ! echo "$L" | grep -qE "[1-9][0-9]* failed"'

- [ ] [BEHAVIOR] [L2] B-02: gear=hotfix 全程不派 planner/proposer/reviewer
  动作: 调 derive(初始态 gear:'hotfix')，检查返回 action 不在三角色 spawn 集合内
  预期观察: action ∉ {spawn:planner, spawn:proposer, spawn:reviewer}
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd "${REPO_ROOT:-/workspace}/packages/brain"; L=$(npx vitest run src/orchestrator/__tests__/derive.test.js -t "全程不派" --reporter=dot 2>&1); echo "$L" | grep -qE "Tests +[0-9]+ passed" && ! echo "$L" | grep -qE "[1-9][0-9]* failed"'

- [ ] [BEHAVIOR] [L2] B-03: INV-1 gear=default 初始态零回归返回 spawn:planner
  动作: 调 derive(初始态 gear:'default') 与 derive(初始态 不传 gear)，二者均应走现行 planning 门
  预期观察: 两种情形 action 均为 'spawn:planner'，phase 'planning'（与改动前逐字节等价）
  等待预算: 0s
  留证: vitest 输出末 5 行 + derive.test.js 既有 100+ 用例全绿
  Test: manual:bash -c 'cd "${REPO_ROOT:-/workspace}/packages/brain"; L=$(npx vitest run src/orchestrator/__tests__/derive.test.js --reporter=dot 2>&1); echo "$L" | grep -qE "Tests +[0-9]+ passed" && ! echo "$L" | grep -qE "[1-9][0-9]* failed"'

- [ ] [BEHAVIOR] [L2] B-04: gear=segmented 初始态照跑 planner（≠hotfix，对齐 controller segmented）
  动作: 调 derive(初始态 gear:'segmented')
  预期观察: action 'spawn:planner'，phase 'planning'（planner→proposer 多段语义，段循环留待独立交付）
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd "${REPO_ROOT:-/workspace}/packages/brain"; L=$(npx vitest run src/orchestrator/__tests__/derive.test.js -t "segmented 初始态 照跑 planner" --reporter=dot 2>&1); echo "$L" | grep -qE "Tests +[0-9]+ passed" && ! echo "$L" | grep -qE "[1-9][0-9]* failed"'

- [ ] [BEHAVIOR] [L2] B-05: INV-2 非法 gear（turbo）kernel 侧 fail-closed → mark_failed invalid_gear
  动作: 调 derive(初始态 gear:'turbo')
  预期观察: 返回 {phase:'failed', action:'mark_failed', reason:'invalid_gear'}（不静默降级、不进任何相位，对齐 executor.js:3097）
  等待预算: 0s
  留证: vitest 输出末 5 行
  Test: manual:bash -c 'cd "${REPO_ROOT:-/workspace}/packages/brain"; L=$(npx vitest run src/orchestrator/__tests__/derive.test.js -t "fail-closed" --reporter=dot 2>&1); echo "$L" | grep -qE "Tests +[0-9]+ passed" && ! echo "$L" | grep -qE "[1-9][0-9]* failed"'

- [ ] [BEHAVIOR] [L2] B-06: gear 列 round-trip + observed.gear 注入（真 Postgres）[接缝×2]
  动作: 真 PG 上 createKernelRun(gear='hotfix')，再 collectGroundTruth 读回该 run
  预期观察: SELECT gear FROM initiative_runs = 'hotfix'；collectGroundTruth 返回 observed.gear === 'hotfix'；gear 缺省时列 NULL 且 observed.gear==='default'
  等待预算: 0s
  留证: gear PG 集成套件 vitest 输出末 10 行（含 round-trip / observed.gear 用例）
  Test: manual:bash -c 'cd "${REPO_ROOT:-/workspace}/packages/brain"; export DATABASE_URL="${DB_URL:?}"; L=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-gear-dispatch.pg.integration.test.js -t "round-trip" --reporter=dot 2>&1); echo "$L" | grep -qE "Tests +[0-9]+ passed" && ! echo "$L" | grep -qE "[1-9][0-9]* failed"'

- [ ] [BEHAVIOR] [L2] B-07: hotfix run harness_attempts 角色分布 planner/proposer/reviewer=0 且 generator≥1（真 PG，时间窗防伪）[接缝×2]
  动作: 真 PG 一跳驱动 runLoop（真 collectGroundTruth+真 derive+真 attemptStore，仅替身最外层 launcher），产出 hotfix run 的 harness_attempts 行，再 psql 断言
  预期观察: `role IN ('planner','proposer','reviewer')` 计数=0 且 `role='generator'` 计数≥1（均带 created_at 时间窗）
  等待预算: 0s
  留证: 两条 psql 计数输出（0 与 ≥1）
  Test: manual:bash -c 'cd "${REPO_ROOT:-/workspace}/packages/brain"; export DATABASE_URL="${DB_URL:?}"; L=$(npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-gear-dispatch.pg.integration.test.js -t "hotfix 首角色" --reporter=dot 2>&1); echo "$L" | grep -qE "Tests +[0-9]+ passed" && ! echo "$L" | grep -qE "[1-9][0-9]* failed"'

## Invariant 覆盖

- INV-1 [零回归] gear=default derive 输出不变（决策 1b677ae3）→ B-03 覆盖（default+undefined 双路径 + 全套 derive.test.js 100+ 用例绿）
- INV-2 [fail-closed] 非法 gear kernel 侧 terminal failed 不静默降级（决策 e8f6134f）→ B-05 覆盖
- INV-3 [确定性] derive 分叉禁 Date.now/Math.random/new Date → N/A 断言：gear 分叉为纯 switch/枚举比对，无时间/随机源（derive 既有确定性纪律，B-01~B-05 纯函数可复跑即隐含验证）
