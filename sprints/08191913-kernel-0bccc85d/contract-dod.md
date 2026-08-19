---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code 并 fail-closed 出口

**范围**: diff-gate.js 步骤 3a 与 structure-gate.js 规则 3 的非 fresh 语义分流（透传 reason_code + 确定性 unknown fail-closed）；orchestrator loop 对 retryable=false 的终止消费回归锁；diff-evaluate HTTP 表面按 retryable 分 422/503；配套回归测试 grep 同步。
**大小**: S
**不在范围**: Mapper（queryImpactRadius）freshness 判定逻辑；影响半径对账（compareImpactContract）；impact contract 持久化/extend。

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 按 freshness.status 分流（unknown→fail-closed，透传 reason_code，不再无条件 mapper_stale）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8'); const b=c.slice(c.indexOf('3a.')); const ok=/freshness\.status\s*===?\s*'unknown'/.test(c)&&/reason_code/.test(b)&&/retryable:\s*false/.test(b); if(!ok){console.error('FAIL: 3a 未按 status 分流/未透传 reason_code/无 fail-closed');process.exit(1)} console.log('OK')"

- [ ] [ARTIFACT] structure-gate.js 规则 3 同语义分流（unknown→retryable:false，透传 reason_code）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/structure-gate.js','utf8'); const ok=/freshness\.status\s*===?\s*'unknown'/.test(c)&&/reason_code/.test(c); if(!ok){console.error('FAIL: structure-gate 未同语义分流');process.exit(1)} console.log('OK')"

- [ ] [ARTIFACT] diff-evaluate 路由按 retryable 分 422/503 + doc 同步
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/impact-contracts.js','utf8'); const ok=/422/.test(c)&&/retryable/.test(c); if(!ok){console.error('FAIL: 路由未按 retryable 分 422/503');process.exit(1)} console.log('OK')"

## BEHAVIOR 条目（五行剧本，manual:bash 内嵌单行命令，evaluator 直接跑）

- [ ] [BEHAVIOR] [L2] B-01: 瞬态 stale → diff-gate retryable:true 且透传具体 reason_code（非 mapper_stale 折叠）
  动作: 以 mapClient 返回 freshness={status:'stale',reason_code:'fact_snapshot_stale'} 真调 evaluateDiffGate
  预期观察: 返回 gate='impact_unknown', retryable=true, reason_code='fact_snapshot_stale'（reason 非 'mapper_stale'）
  等待预算: 0s
  留证: sprints/08191913-kernel-0bccc85d/checks/assert-diff-stale-passthrough.mjs stdout（OK B-01 行 + JSON）
  Test: manual:bash -c 'cd /workspace && node sprints/08191913-kernel-0bccc85d/checks/assert-diff-stale-passthrough.mjs'

- [ ] [BEHAVIOR] [L2] B-02: 确定性 unknown → diff-gate fail-closed（retryable:false）且透传 reason_code
  动作: 以 mapClient 返回 freshness={status:'unknown',reason_code:'impact_unknown'} 真调 evaluateDiffGate
  预期观察: 返回 gate='impact_unknown', retryable=false, reason_code='impact_unknown'（不可重试出口）
  等待预算: 0s
  留证: sprints/08191913-kernel-0bccc85d/checks/assert-diff-unknown-failclosed.mjs stdout（OK B-02 行 + JSON）
  Test: manual:bash -c 'cd /workspace && node sprints/08191913-kernel-0bccc85d/checks/assert-diff-unknown-failclosed.mjs'

- [ ] [BEHAVIOR] [L2] B-03: structure-gate 与 diff-gate 同一语义分流（跨端一致，不分叉）
  动作: 以 stale / unknown 两种 freshness 真调 evaluateStructureGate（db:null 走 freshness 早退）
  预期观察: stale→blocked/retryable:true/reason='ttl_exceeded'；unknown→blocked/retryable:false（httpStatus 422）
  等待预算: 0s
  留证: sprints/08191913-kernel-0bccc85d/checks/assert-structure-split.mjs stdout（OK B-03 行）
  Test: manual:bash -c 'cd /workspace && node sprints/08191913-kernel-0bccc85d/checks/assert-structure-split.mjs'

- [ ] [BEHAVIOR] [L2] B-04: 边界 — freshness 缺 reason_code（只 status）→ 保守 fallback，不静默丢/不误判
  动作: 以 freshness={status:'stale'} 与 {status:'unknown'}（均无 reason_code）真调 evaluateDiffGate
  预期观察: staleNoCode→retryable:true(fallback mapper_stale)；unknownNoCode→retryable:false(fallback impact_unknown)
  等待预算: 0s
  留证: sprints/08191913-kernel-0bccc85d/checks/assert-missing-reason.mjs stdout（OK B-04 行）
  Test: manual:bash -c 'cd /workspace && node sprints/08191913-kernel-0bccc85d/checks/assert-missing-reason.mjs'

- [ ] [BEHAVIOR] [L2] B-05: 全仓库回归绿 — loop 消费 retryable:false 终止（非空转）+ grep 同步 + 跨端一致
  动作: 从 packages/brain 包根跑三处 __tests__（harness-gates / structure-gate / loop），含 fail-closed 新用例与 mapper_stale grep 同步后的断言
  预期观察: 三文件全绿；loop.test.js 新增用例断言 retryable:false→exitReason='impact_gate_deterministic'（终止），retryable:true→退避不终止
  等待预算: 0s
  留证: vitest 输出末 5 行（Test Files N passed / Tests M passed，无 failed）
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/harness-gates.test.js ./src/impact-contract/__tests__/structure-gate.test.js ./src/orchestrator/__tests__/loop.test.js'

## Invariant 覆盖（controller 注入铁律逐条映射；真实断言归 B-NN，其余 N/A 显式声明）

- INV-1 [失败路径不降级]：确定性 unknown 走 fail-closed retryable:false / loop failRun('impact_gate_deterministic') 非零终止，绝不 warning 降级或假绿放行 → 由 B-02 + B-05（loop 用例）覆盖。
- INV-2 [显式else兜底]：3a 写完 `status==='unknown'` fail-closed 分支后，必须显式 else（或 fall-through 到）瞬态 retryable:true 分支兜底，不得漏返回 → 由 B-01/B-04（瞬态与 fallback 均有确定返回）覆盖。
- INV-3 [语义跨端一致]：diff-gate 与 structure-gate 判别器（status==='unknown'→fail-closed，else→瞬态）逐字段一致，判变端/终验端不分叉 → 由 B-03 覆盖。
- INV-4 [status枚举同步]：新增语义值（透传 reason_code）后全仓库 grep 同步硬编码 `mapper_stale` 断言（structure-gate.test.js:155 等），避免遗留断言转红 → 由 B-05（三文件全绿即证同步完成）覆盖。
- INV-5 [真环境验证]：B-01..B-05 均真调 gate/真跑 loop（L2 真实函数执行，非替身），非 mock gate 本身 → 由 B-01..B-05 覆盖。
- INV-6 [禁写死环境]：判别器从 `freshness.status` 枚举推导，不写死环境假设值（无坐标/阈值/假 env）→ 由 B-01..B-04 输入均为运行时 freshness 推导覆盖。
- INV-7 [租户隔离]：N/A — 本 sprint 是 harness gate 纯 freshness 分流逻辑，无租户维度、无记忆/数据读写，不涉及多租户隔离面。
