---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel 真读 gear：三档在 orchestrator 状态机内分流

**范围**: `orchestrator/run.js`+loop 启动读 `task.payload.gear` 并持久化 `initiative_runs.gear`；`orchestrator/derive.js` 初始态按 gear 分叉（hotfix 跳 planning/gan 直进 generate、default/segmented 走 planner、非法 fail-closed）；新增 derive gear 单测 + 真 PG 集成测试。不建 param 档、不动入口强制、不改 relay/controller SKILL。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] initiative_runs 新增 gear 持久化列（migration）
  Test: node -e "const fs=require('fs');const d='packages/brain/migrations';const hit=fs.readdirSync(d).some(f=>/\.sql$/.test(f)&&/initiative_runs/.test(fs.readFileSync(d+'/'+f,'utf8'))&&/\bgear\b/.test(fs.readFileSync(d+'/'+f,'utf8')));if(!hit)process.exit(1)"

- [ ] [ARTIFACT] derive.js 读取 observed.gear 并按 gear 分叉（含缺省归一 default）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/gear/.test(c))process.exit(1)"

- [ ] [ARTIFACT] kernel 启动读 task.payload.gear 复用 deriveGear（run.js 或 loop.js）
  Test: node -e "const fs=require('fs');const a=fs.readFileSync('packages/brain/src/orchestrator/run.js','utf8');const b=fs.readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!/deriveGear|\.gear/.test(a+b))process.exit(1)"

- [ ] [ARTIFACT] derive gear 分叉单测文件存在（永久回归）
  Test: node -e "require('fs').accessSync('packages/brain/src/orchestrator/__tests__/derive-gear.test.js')"

- [ ] [ARTIFACT] kernel gear 真 PG 集成测试文件存在（永久回归）
  Test: node -e "require('fs').accessSync('packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: derive(gear=hotfix 初始态) 返回 action 不等于 spawn:planner
  动作: 纯函数真调 derive，喂 {prdExists:false, pr:null, generatorSpawned:false, gear:'hotfix'} 初始态 observed
  预期观察: 返回 action === 'spawn:generator'（≠ 'spawn:planner'），跳过 planning/gan 相位
  等待预算: 0s
  留证: vitest 输出末 5 行（含 PASS 计数）进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run packages/brain/src/orchestrator/__tests__/derive-gear.test.js -t "gear=hotfix 初始态 action 不等于 spawn:planner" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: gear 持久化到 initiative_runs.gear 列，进程启动后可查
  动作: 真 PG 集成测试驱动一条 gear=hotfix 的 kernel run 启动，读回 initiative_runs.gear
  预期观察: initiative_runs 存在 gear 列且该 run 行 gear='hotfix'（真落库，非内存）
  等待预算: 0s（同步 psql 读回）
  留证: 集成测试 pg 断言输出 + initiative_runs.gear 查询结果进 evidence 字段
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && DATABASE_URL="$DB_URL" npx vitest run packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js -t "gear 持久化到 initiative_runs gear 列" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: hotfix run 的 harness_attempts 无 planner/proposer/reviewer 且 generator≥1
  动作: 真 PG 集成测试驱动完整一条 gear=hotfix run（录制式 launcher，attempt 真落 PG），按 role 计数
  预期观察: 该 run role IN (planner,proposer,reviewer) 计数=0 且 role=generator 计数≥1（带 5min 时间窗）
  等待预算: 0s
  留证: harness_attempts role 计数 SQL 结果进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && DATABASE_URL="$DB_URL" npx vitest run packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js -t "hotfix run harness_attempts 无 planner proposer reviewer 且 generator 至少一条" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: default run 的 harness_attempts planner/proposer/reviewer 三角色均≥1（零回归）
  动作: 真 PG 集成测试驱动完整一条 gear=default run（录制式 launcher，attempt 真落 PG），按 role 计数
  预期观察: 该 run role=planner、role=proposer、role=reviewer 三者计数均≥1（带 5min 时间窗）
  等待预算: 0s
  留证: 三角色计数 SQL 结果进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && DATABASE_URL="$DB_URL" npx vitest run packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js -t "default run harness_attempts 三角色均至少一条" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: 非法 gear 在 kernel 侧 fail-closed（reason=invalid_gear，无 attempt 落库）
  动作: 真 PG 集成测试驱动一条 gear=turbo 的 kernel run 启动
  预期观察: 该 run 被 finalize terminal failed，failure_reason 含 invalid_gear，且该 run 的 harness_attempts 行数=0（不 spawn 任何相位）
  等待预算: 0s
  留证: initiative_runs.failure_reason + harness_attempts count 结果进 evidence 字段
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && DATABASE_URL="$DB_URL" npx vitest run packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js -t "非法 gear kernel 侧 fail-closed reason invalid_gear" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-06: derive(gear=default 初始态) 仍返回 spawn:planner（零回归护栏）
  动作: 纯函数真调 derive，喂 {prdExists:false, pr:null, gear:'default'}（及不含 gear 字段的老快照）初始态
  预期观察: 两种输入 action 均 === 'spawn:planner'，现行为一字不改
  等待预算: 0s
  留证: vitest 输出末 5 行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run packages/brain/src/orchestrator/__tests__/derive-gear.test.js -t "gear=default 初始态 action 等于 spawn:planner" --reporter=dot'

## Invariant 覆盖（历史约束三源 → INV 映射）

- [ ] [BEHAVIOR] INV-1 [零回归] gear=default/缺省 现行为一字不改（决策 e8f6134f/1b677ae3）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run packages/brain/src/orchestrator/__tests__/derive.test.js --reporter=dot'
  期望: 存量 derive 全量单测（不传 gear）exit 0，新增 gear 可选字段不破坏 assertObservedShape

- [ ] [BEHAVIOR] INV-2 [枚举单源] gear 合法集唯一真相=GEAR_VALUES，kernel 只读复用不新建平行枚举（决策 e8f6134f）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/orchestrator/derive.js\",\"utf8\")+require(\"fs\").readFileSync(\"packages/brain/src/orchestrator/run.js\",\"utf8\");if(/GEAR_VALUES\s*=\s*\[/.test(c)){process.exit(1)}"'
  期望: kernel 侧文件不出现平行 GEAR_VALUES 定义（=…[…]），只读复用 harness-skill-relay.js 的枚举；exit 0

- [ ] [BEHAVIOR] INV-3 [local_api 验证] 合同已声明 psql 证据消费（避免 judge meta_verification_gap 死锁）
  Test: manual:bash -c 'grep -q "harness_attempts" "${WORKSPACE_PATH:-/workspace}/sprints/08091130-kernel-gear-dispatch/contract-draft.md" && grep -q "psql" "${WORKSPACE_PATH:-/workspace}/sprints/08091130-kernel-gear-dispatch/contract-draft.md"'
  期望: contract-draft.md ## E2E 验收 段含真实 psql 证据消费（harness_attempts role 计数 + initiative_runs.gear）；exit 0

- [ ] [BEHAVIOR] INV-4 [证据实跑] B-02~B-05 集成断言真跑真 PG 确认 exit code，非"测试通过"空话
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && DATABASE_URL="$DB_URL" npx vitest run packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js --reporter=dot'
  期望: 整份集成测试真连 $DB_URL 真跑，全绿 exit 0；不 mock derive/gear 持久化/harness_attempts 写路径
