contract_branch: cp-harness-propose-r1-23e93b86-r7f939e7c-a4
sprint_dir: sprints/08210608-kernel-23e93b86

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性 fail-closed 出口（r19）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` step 3a 非 fresh 出口 —— 透传 `freshness.reason_code` 作 `reason`，按 `status` 分流 `retryable`（stale→true / unknown→false / 缺失→false）；+ 对应回归（`diff-gate.test.js` 永久保留 + sprint spec）。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js step 3a 按 status 分流（不再无条件恒返 mapper_stale/true）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/freshness\.status\s*===\s*'stale'|status\s*===\s*'stale'/.test(c)||!/reason_code/.test(c))process.exit(1)"
  期望: exit 0（源码含 stale 分流分支 + reason_code 透传）

- [ ] [ARTIFACT] 永久回归实体落 PRD 预期受影响文件路径（diff-gate.test.js 含 unknown 分流断言）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!/unknown/.test(c)||!/retryable/.test(c))process.exit(1)"
  期望: exit 0（brain 回归文件新增 unknown/retryable 分流回归）

## BEHAVIOR 条目（内嵌可执行 manual: 命令，node 直调 evaluateDiffGate — local_api / autonomous）

- [ ] [BEHAVIOR] [L2] B-01: unknown 状态透传 reason_code 且 retryable false
  动作: 注入 db:null + mapClient 返回 `{freshness:{status:'unknown',reason_code:'capability_not_in_active_projection'}}`，调用 evaluateDiffGate
  预期观察: 返回 `{gate:'impact_unknown', reason:'capability_not_in_active_projection', retryable:false}`（确定性终局出口）
  等待预算: 0s
  留证: node 命令 stdout（OK unknown terminal）+ 退出码 0
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const r=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({freshness:{status:'unknown',reason_code:'capability_not_in_active_projection'}})}); if(r.gate!=='impact_unknown'||r.reason!=='capability_not_in_active_projection'||r.retryable!==false){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK unknown terminal')"

- [ ] [BEHAVIOR] [L2] B-02: unknown 无 reason_code 回退 mapper_unknown 且 retryable false
  动作: 注入 mapClient 返回 `{freshness:{status:'unknown',reason_code:null}}`，调用 evaluateDiffGate
  预期观察: 返回 `{gate:'impact_unknown', reason:'mapper_unknown', retryable:false}`（无 code 回退确定性桶默认标签）
  等待预算: 0s
  留证: node 命令 stdout（OK unknown fallback）+ 退出码 0
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const r=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({freshness:{status:'unknown',reason_code:null}})}); if(r.reason!=='mapper_unknown'||r.retryable!==false){console.error('FAIL',JSON.stringify(r));process.exit(1)} console.log('OK unknown fallback')"

- [ ] [BEHAVIOR] [L2] B-03: stale 状态透传 reason_code 且 retryable true（无 code 回退 mapper_stale）
  动作: 注入 mapClient 分别返回 stale+reason_code 与 stale+null，调用 evaluateDiffGate
  预期观察: 有 code → `{reason:'projection_snapshot_expired', retryable:true}`；无 code → `{reason:'mapper_stale', retryable:true}`（瞬态可重试）
  等待预算: 0s
  留证: node 命令 stdout（OK stale retryable）+ 退出码 0
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const a=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({freshness:{status:'stale',reason_code:'projection_snapshot_expired'}})}); const b=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({freshness:{status:'stale',reason_code:null}})}); if(a.reason!=='projection_snapshot_expired'||a.retryable!==true||b.reason!=='mapper_stale'||b.retryable!==true){console.error('FAIL',JSON.stringify(a),JSON.stringify(b));process.exit(1)} console.log('OK stale retryable')"

- [ ] [BEHAVIOR] [L2] B-04: freshness 缺失 fail-closed 且 retryable false（不假绿）
  动作: 注入 mapClient 返回无 freshness 字段的对象 `{affected_nodes:[]}`，调用 evaluateDiffGate
  预期观察: 返回 `{gate:'impact_unknown', retryable:false}`（结构异常走确定性终局出口，不折可重试）
  等待预算: 0s
  留证: node 命令 stdout（OK missing-freshness fail-closed）+ 退出码 0
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const m=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>({affected_nodes:[]})}); if(m.gate!=='impact_unknown'||m.retryable!==false){console.error('FAIL',JSON.stringify(m));process.exit(1)} console.log('OK missing-freshness fail-closed')"

- [ ] [BEHAVIOR] [L2] B-05: 既有 fail-closed mapper_unavailable 与 revision_mismatch 不回退
  动作: 注入 mapClient 抛错（unavailable）与 fresh+fact_revisions 不对齐（revision_mismatch），调用 evaluateDiffGate
  预期观察: unavailable → `{reason:'mapper_unavailable', retryable:true}`；mismatch → `{reason:'revision_mismatch', retryable:true}`（既有出口零回退）
  等待预算: 0s
  留证: node 命令 stdout（OK no-regress）+ 退出码 0
  Test: manual:node --input-type=module -e "import {evaluateDiffGate} from './packages/brain/src/impact-contract/diff-gate.js'; const u=await evaluateDiffGate({db:null,taskId:'t',mapClient:async()=>{throw new Error('ETIMEDOUT')}}); const r=await evaluateDiffGate({db:{query:async()=>({rows:[{id:'c1',repo:'cecelia',base_revision:'base123',contract_body:{affected_capabilities:[],required_assertions:[]}}]})},taskId:'t',repo:'cecelia',headRevision:'h',mapClient:async()=>({freshness:{status:'fresh'},fact_revisions:{cecelia:'stale999'},affected_nodes:[],required_assertions:[]})}); if(u.reason!=='mapper_unavailable'||u.retryable!==true||r.reason!=='revision_mismatch'||r.retryable!==true){console.error('FAIL',JSON.stringify(u),JSON.stringify(r));process.exit(1)} console.log('OK no-regress')"

- [ ] [BEHAVIOR] [L2] B-06 / INV-2: 永久回归全绿且真跑（brain config include 内路径，exit code 真实）
  动作: 从 packages/brain 子 shell（该包自身 vitest config，src/** in include）跑 diff-gate 回归
  预期观察: 全部测试绿（既有 20 例 + 本 sprint 新增分流回归），退出码 0；非 "No test files found"
  等待预算: 0s
  留证: vitest stdout 末尾 "Test Files 1 passed" + 退出码 0
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js'

## INV 条目（铁律逐条映射 — Step 1.3 历史约束）

- [ ] [BEHAVIOR] [L2] INV-1 [status 枚举 sweep]: 全仓库硬编码折叠 sweep 已执行，两站点登记
  动作: 复跑 sweep grep，核对折叠站点仅 diff-gate.js（已修）+ structure-gate.js（已登记 deferred）
  预期观察: sweep 命中 diff-gate.js 已含 stale 分流（不再无条件 mapper_stale）；contract-draft.md 含 sweep 结果段
  等待预算: 0s
  留证: grep 输出 + contract-draft.md 「## 状态枚举 sweep 结果」段
  Test: manual:bash -c 'grep -q "## 状态枚举 sweep 结果" sprints/08210608-kernel-23e93b86/contract-draft.md && grep -Eq "status\s*===\s*.stale." packages/brain/src/impact-contract/diff-gate.js'

- INV-2 [验证命令真跑]: 见 B-06（验证命令落 brain config include 内路径 `src/**` + sprint spec 落根 config include `sprints/**`，退出码真实；死规则子 shell 执行 packages/brain/src 的 vitest）。
- INV-3 [脚本会话独享]: N/A — 本合同 Test 命令为 node 直调/vitest 定向，无 evaluator 临时脚本落共享 /tmp 固定文件名。
- INV-4 [generator 重试身份]: N/A — generator 基础设施重试身份由 kernel/worker 管控，非本合同（Impact Contract 逻辑）范畴。
- INV-5 [Brain URL 权威]: N/A — 本改动为 Brain 进程内 Impact Contract 分支逻辑，无 Fleet/Generator 旁路 Brain URL 的调用面。
- INV-6 [planner 分支]: N/A — planner 分支纪律由 planner 角色遵守，非本 proposer/generator task 范畴。

## Response Schema 字段自查映射（PRD 内部函数返回契约 → 断言）

- `gate === 'impact_unknown'` → B-01/B-04 断言覆盖
- `reason` 透传 reason_code（unknown/stale）→ B-01/B-03 断言覆盖
- `reason` 无 code 回退（unknown→mapper_unknown / stale→mapper_stale）→ B-02/B-03 断言覆盖
- `retryable` 按 status 分流（stale→true / unknown→false / 缺失→false）→ B-01/B-03/B-04 断言覆盖
- 禁用：reason 恒为字面 'mapper_stale' → B-01（unknown 下 reason≠mapper_stale）反向锁定
- 既有出口零回退（mapper_unavailable/revision_mismatch）→ B-05 断言覆盖
