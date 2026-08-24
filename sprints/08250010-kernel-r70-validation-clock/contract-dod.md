---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: validation clock 按 fix 轮自动顺延（有界）[r70]

**范围**: `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock`：decision_log 含 N 条 `spawn:generator-fix` 行时，以第 min(N,6) 条 fix 行（按 hop 排序）为新原点重算 deadline（顺延有界 6）；N=0 语义不变；fail-closed 不削弱。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] sprint 封印冻结测试存在且含 fix 行顺延 + 有界 + fail-closed 断言
  Test: manual:bash -c "node -e \"const c=require('fs').readFileSync('sprints/08250010-kernel-r70-validation-clock/tests/validation-clock-fix-round-deferral.test.js','utf8'); if(!c.includes('spawn:generator-fix')||!c.includes('2026-08-03T13:30:00.000Z')||!c.includes('2026-08-03T17:30:00.000Z')||!c.includes('validation_clock_invalid')) process.exit(1)\""
  期望: exit 0

- [ ] [ARTIFACT] gp 闸冻结测试存在且含 r50 顺延 + 有界断言
  Test: manual:bash -c "node -e \"const c=require('fs').readFileSync('tests/gp/f1/step3-validation-clock-fix-round-deferral.test.js','utf8'); if(!c.includes('2026-08-03T13:30:00.000Z')||!c.includes('2026-08-03T17:30:00.000Z')) process.exit(1)\""
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令；autonomous / local_api，纯函数进程内直调无 DB）

- [ ] [BEHAVIOR] [L2] B-01: r50 replay — 2 条 generator-fix 后 deadline 顺延到最后一条 fix 原点（旧判死新存活）
  动作: 构造 decision_log = 1 条 spawn:generator(10:00) + 2 条 spawn:generator-fix(11:00/12:00)，以 downstream action=spawn:evaluator 调 resolveValidationClock
  预期观察: 返回 pipeline_started_at=12:00、deadline_at=13:30（新原点=最后一条 fix；旧逻辑返回 11:30）
  等待预算: 0s
  留证: node 命令 stdout 末行 `OK 2026-08-03T13:30:00.000Z`
  Test: manual:bash -c "node --input-type=module -e \"const {resolveValidationClock}=await import('./packages/brain/src/orchestrator/validation-clock.js'); const log=[{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'},{hop:20,action:'spawn:generator-fix',created_at:'2026-08-03T11:00:00.000Z'},{hop:30,action:'spawn:generator-fix',created_at:'2026-08-03T12:00:00.000Z'}]; const r=resolveValidationClock({action:'spawn:evaluator',decisionLog:log,intentAt:'2026-08-03T12:30:00.000Z',timeoutSeconds:5400}); if(r.pipeline_started_at!=='2026-08-03T12:00:00.000Z'||r.deadline_at!=='2026-08-03T13:30:00.000Z'){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK',r.deadline_at)\""
  期望: exit 0 且 stdout 含 OK 2026-08-03T13:30:00.000Z

- [ ] [BEHAVIOR] [L2] B-02: 有界冻结 — 7 条 generator-fix 时 deadline 冻结在第 6 条原点（超限不再顺延）
  动作: 构造 1 条 generator(10:00) + 7 条 generator-fix(11:00..17:00)，以 action=spawn:judge 调用
  预期观察: 返回 pipeline_started_at=16:00（第 6 条 fix）、deadline_at=17:30（非第 7 条 18:30）
  等待预算: 0s
  留证: node 命令 stdout 末行 `OK 2026-08-03T17:30:00.000Z`
  Test: manual:bash -c "node --input-type=module -e \"const {resolveValidationClock}=await import('./packages/brain/src/orchestrator/validation-clock.js'); const log=[{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'}]; for(let i=0;i<7;i++){log.push({hop:20+i*10,action:'spawn:generator-fix',created_at:'2026-08-03T'+String(11+i).padStart(2,'0')+':00:00.000Z'})} const r=resolveValidationClock({action:'spawn:judge',decisionLog:log,intentAt:'2026-08-03T18:00:00.000Z',timeoutSeconds:5400}); if(r.pipeline_started_at!=='2026-08-03T16:00:00.000Z'||r.deadline_at!=='2026-08-03T17:30:00.000Z'){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK',r.deadline_at)\""
  期望: exit 0 且 stdout 含 OK 2026-08-03T17:30:00.000Z

- [ ] [BEHAVIOR] [L2] B-03: regression-nofix — 无 generator-fix 行时 deadline 与现状逐字节一致
  动作: 构造仅 1 条 generator(10:00)（无 fix 行），以 action=spawn:evaluator 调用
  预期观察: 返回 pipeline_started_at=10:00、deadline_at=11:30（首 generator 原点，语义不变）
  等待预算: 0s
  留证: node 命令 stdout 末行 `OK 2026-08-03T11:30:00.000Z`
  Test: manual:bash -c "node --input-type=module -e \"const {resolveValidationClock}=await import('./packages/brain/src/orchestrator/validation-clock.js'); const r=resolveValidationClock({action:'spawn:evaluator',decisionLog:[{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'}],intentAt:'2026-08-03T10:20:00.000Z',timeoutSeconds:5400}); if(r.pipeline_started_at!=='2026-08-03T10:00:00.000Z'||r.deadline_at!=='2026-08-03T11:30:00.000Z'){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK',r.deadline_at)\""
  期望: exit 0 且 stdout 含 OK 2026-08-03T11:30:00.000Z

- [ ] [BEHAVIOR] [L2] B-04: invariant-failclosed — downstream 角色缺原点仍 fail-closed
  动作: 以 action=spawn:evaluator、decisionLog=[] 调用（下游角色无 generator clock）
  预期观察: 抛 Error 且 message 含 validation_clock_required（拦截，不静默放行）
  等待预算: 0s
  留证: node 命令 stdout 末行 `OK threw ...validation_clock_required`
  Test: manual:bash -c "node --input-type=module -e \"const {resolveValidationClock}=await import('./packages/brain/src/orchestrator/validation-clock.js'); try{resolveValidationClock({action:'spawn:evaluator',decisionLog:[],intentAt:'2026-08-03T10:00:00.000Z',timeoutSeconds:5400});console.error('FAIL no throw');process.exit(1)}catch(e){if(!String(e.message).includes('validation_clock_required')){console.error('FAIL',e.message);process.exit(1)} console.log('OK threw',e.message)}\""
  期望: exit 0 且 stdout 含 OK threw

- [ ] [BEHAVIOR] [L2] B-05: replay-order — 乱序 hop 传入按 hop 排序后取顺延原点，可重放
  动作: 用与 B-01 相同的行但数组顺序打乱（fix30, gen10, fix20），调用
  预期观察: 返回 deadline_at=13:30（按 hop 排序后同 B-01，结果不依赖数组顺序）
  等待预算: 0s
  留证: node 命令 stdout 末行 `OK 2026-08-03T13:30:00.000Z`
  Test: manual:bash -c "node --input-type=module -e \"const {resolveValidationClock}=await import('./packages/brain/src/orchestrator/validation-clock.js'); const log=[{hop:30,action:'spawn:generator-fix',created_at:'2026-08-03T12:00:00.000Z'},{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'},{hop:20,action:'spawn:generator-fix',created_at:'2026-08-03T11:00:00.000Z'}]; const r=resolveValidationClock({action:'spawn:evaluator',decisionLog:log,intentAt:'2026-08-03T12:30:00.000Z',timeoutSeconds:5400}); if(r.deadline_at!=='2026-08-03T13:30:00.000Z'){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK',r.deadline_at)\""
  期望: exit 0 且 stdout 含 OK 2026-08-03T13:30:00.000Z

- [ ] [BEHAVIOR] [L2] B-06: persisted-inconsistent — 顺延原点 detail 自相矛盾时 fail-closed
  动作: 构造最后一条 fix 携带自相矛盾 detail(pipeline_started_at=12:00, deadline_at=14:00，与 12:00+5400s=13:30 不符)，调用
  预期观察: 抛 Error 且 message 含 validation_clock_invalid（顺延原点复用 persistedClock 一致性校验，防造假）
  等待预算: 0s
  留证: node 命令 stdout 末行 `OK threw ...validation_clock_invalid`
  Test: manual:bash -c "node --input-type=module -e \"const {resolveValidationClock}=await import('./packages/brain/src/orchestrator/validation-clock.js'); const log=[{hop:10,action:'spawn:generator',created_at:'2026-08-03T10:00:00.000Z'},{hop:20,action:'spawn:generator-fix',created_at:'2026-08-03T12:05:00.000Z',detail:{pipeline_started_at:'2026-08-03T12:00:00.000Z',deadline_at:'2026-08-03T14:00:00.000Z'}}]; try{resolveValidationClock({action:'spawn:evaluator',decisionLog:log,intentAt:'2026-08-03T12:30:00.000Z',timeoutSeconds:5400});console.error('FAIL no throw');process.exit(1)}catch(e){if(!String(e.message).includes('validation_clock_invalid')){console.error('FAIL',e.message);process.exit(1)} console.log('OK threw',e.message)}\""
  期望: exit 0 且 stdout 含 OK threw

## Invariant 覆盖（历史约束三源 — 铁律逐条映射）

- [ ] [BEHAVIOR] INV-1 [fail-closed]: 顺延逻辑不得使缺失原点时静默放行 —— 由 B-04（缺原点抛 validation_clock_required）+ B-06（detail 不自洽抛 validation_clock_invalid）共同覆盖
  Test: manual:bash -c "node --input-type=module -e \"const {resolveValidationClock}=await import('./packages/brain/src/orchestrator/validation-clock.js'); let ok=0; try{resolveValidationClock({action:'spawn:judge',decisionLog:[],intentAt:'2026-08-03T10:00:00.000Z',timeoutSeconds:5400})}catch(e){if(String(e.message).includes('validation_clock_required'))ok++} if(ok!==1){console.error('FAIL fail-closed 被削弱');process.exit(1)} console.log('OK fail-closed 保留')\""
  期望: exit 0 且 stdout 含 OK fail-closed 保留
- INV-2 [planner-branch] N/A：本 sprint 不涉及 planner workspace 分支操作（proposer 只写合同产物，不 checkout/switch）。
- INV-3 [合同边界] N/A（非可执行行为断言）：可写白名单已在 contract-draft.md「可写白名单」段显式含全部 CI 门禁产物，禁建计划外文件、禁锁死为仅实现文件。
- INV-4 [纯函数] 由 B-05（乱序可重放）+ determinism 冻结测试覆盖：只依赖入参 action+hop，同输入必同输出。
