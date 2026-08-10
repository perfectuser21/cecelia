---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: kernel 真读 gear：三档在 orchestrator 状态机内分流

**范围**: 复核确认 kernel derive() 真读 `observed.gear`（源自 `initiative_runs.gear` ← `payload.gear`）三档分叉 + 非法 gear fail-closed；真实表名 = `harness_attempts`（非 PRD 误写的 `initiative_attempts`）。
**大小**: S（验证型 sprint，实现已由 #4747 落地）

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js 含 gear 分档判定（GEAR_VALUES + hotfix 跳相位 + invalid_gear fail-closed）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!(c.includes('GEAR_VALUES')&&c.includes('invalid_gear')&&c.includes(\"gear === 'hotfix'\")))process.exit(1)"

- [ ] [ARTIFACT] migration 396 为 initiative_runs 增 gear 列
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/396_initiative_runs_gear.sql','utf8');if(!(c.includes('initiative_runs')&&c.includes('gear')))process.exit(1)"

- [ ] [ARTIFACT] ground-truth.js 每跳注入 run.gear（缺省 default）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!c.includes(\"run.gear ?? 'default'\"))process.exit(1)"

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: derive() gear=hotfix 初始态跳过 planning 直进 generate
  动作: 直调 derive({...初始态, gear:'hotfix'})（prdExists=false && contract.approved=false）
  预期观察: 返回 action=='spawn:generator' 且 phase=='generate'，action != 'spawn:planner'（PRD 验收点3）
  等待预算: 0s
  留证: assert-derive.mjs 输出 OK 行（含 phase/action）
  Test: manual:bash -c 'node sprints/08091130-kernel-gear-dispatch/tests/assert-derive.mjs hotfix generator'

- [ ] [BEHAVIOR] [L2] B-02: derive() gear=hotfix 全程不派 planner/proposer/reviewer
  动作: 直调 derive({...初始态, gear:'hotfix'})
  预期观察: 返回 action 不属于 {spawn:planner, spawn:proposer, spawn:reviewer}
  等待预算: 0s
  留证: assert-derive.mjs 输出 OK 行
  Test: manual:bash -c 'node sprints/08091130-kernel-gear-dispatch/tests/assert-derive.mjs hotfix notgan'

- [ ] [BEHAVIOR] [L2] B-03: derive() gear=default/缺省/segmented 初始态仍进 planner（零回归红线）
  动作: 直调 derive() 三次，分别喂 gear='default'、不传 gear、gear='segmented'
  预期观察: 三次均返回 action=='spawn:planner' 且 phase=='planning'（与改动前逐字节等价）
  等待预算: 0s
  留证: 三条 assert-derive.mjs OK 行
  Test: manual:bash -c 'node sprints/08091130-kernel-gear-dispatch/tests/assert-derive.mjs default planner && node sprints/08091130-kernel-gear-dispatch/tests/assert-derive.mjs none planner && node sprints/08091130-kernel-gear-dispatch/tests/assert-derive.mjs segmented planner'

- [ ] [BEHAVIOR] [L2] B-04: derive() gear=turbo（非法）kernel 侧 fail-closed
  动作: 直调 derive({...初始态, gear:'turbo'})
  预期观察: 返回 phase=='failed'、action=='mark_failed'、reason=='invalid_gear'（不静默降级、不进任何相位）
  等待预算: 0s
  留证: assert-derive.mjs 输出 OK 行（reason=invalid_gear）
  Test: manual:bash -c 'node sprints/08091130-kernel-gear-dispatch/tests/assert-derive.mjs turbo invalid'

- [ ] [BEHAVIOR] [L2] B-05: 真 PG — initiative_runs.gear round-trip + harness_attempts 角色分布 [接缝×2]
  动作: 真跑集成测试（隔离空库真跑 migrate 至 396 + createKernelRun gear=hotfix/default + collectGroundTruth + derive + attemptStore 写 harness_attempts）
  预期观察: hotfix run 的 harness_attempts 中 role∈{planner,proposer,reviewer} 计数=0 且 role=generator 计数>=1；default run role=planner 计数>=1；gear 列 round-trip=hotfix、缺省=NULL 降级 default（10 分钟时间窗防伪）
  等待预算: 0s（同步等 vitest 退出；测试自管超时）
  留证: /tmp/gear-pg.log 末尾 Test Files 1 passed
  Test: manual:bash -c 'cd packages/brain && NODE_ENV=test npx vitest run --config vitest.integration.config.js kernel-gear-dispatch.pg.integration 2>&1 | tee /tmp/gear-pg.log; grep -q "No test files found" /tmp/gear-pg.log && exit 1; grep -qE "Test Files[[:space:]]+1 passed" /tmp/gear-pg.log'

- [ ] [BEHAVIOR] [L2] INV-1: 零回归 — sprints 单测 6 例全绿且无 failed（gear=default 逐字节等价现行）
  动作: 跑 sprints/08091130-kernel-gear-dispatch/tests/derive-gear.test.js 全量
  预期观察: Test Files 1 passed / Tests 6 passed，无 failed；default/缺省/segmented 用例均 spawn:planner
  等待预算: 0s
  留证: /tmp/gear-unit.log（Tests 6 passed）
  Test: manual:bash -c 'npx vitest run sprints/08091130-kernel-gear-dispatch/tests/derive-gear.test.js 2>&1 | tee /tmp/gear-unit.log; grep -q "No test files found" /tmp/gear-unit.log && exit 1; grep -qE "Tests[[:space:]]+6 passed" /tmp/gear-unit.log && ! grep -qE "Tests[[:space:]]+[1-9][0-9]* failed" /tmp/gear-unit.log'

- [ ] [BEHAVIOR] [L2] INV-2: fail-closed 与 SSOT — deriveGear 白名单枚举且非法 throw invalid_gear
  动作: 直调 harness-skill-relay.js 的 deriveGear，喂合法与非法 gear
  预期观察: GEAR_VALUES==['default','hotfix','segmented']；合法值透传；非法值 throw（message 含 invalid_gear）
  等待预算: 0s
  留证: node 命令 stdout（GEAR ok / throw:invalid_gear）
  Test: manual:bash -c 'node --input-type=module -e "import {deriveGear,GEAR_VALUES} from \"./packages/brain/src/harness-skill-relay.js\"; if(JSON.stringify(GEAR_VALUES)!==JSON.stringify([\"default\",\"hotfix\",\"segmented\"]))process.exit(1); if(deriveGear({payload:{gear:\"hotfix\"}})!==\"hotfix\")process.exit(1); try{deriveGear({payload:{gear:\"turbo\"}});process.exit(1)}catch(e){if(!/invalid_gear/.test(e.message))process.exit(1)} console.log(\"OK\")"'
