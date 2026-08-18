---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传确定性 reason_code + fail-closed 出口（r19）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a —— 透传 `mapperResult.freshness.reason_code` + 按确定性集合分类 `retryable`；对应回归断言落 `diff-gate.test.js`。
**大小**: S

## Invariant 覆盖（铁律映射 — Step 1.3）

- INV-1 [fail-closed]（来源: diff-gate.js 模块契约 + PRD Invariant）：确定性不可判定 → 终态阻断而非无限重试 → 由 **B-01/B-02**（确定性码 retryable:false）验证；瞬态不得误挡 → 由 **B-03**（fact_snapshot_stale retryable:true）验证。
- （decisions 表 step/journey_feature/area 三源无本 line 其它直接相关铁律，N/A）

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 定义确定性 reason_code 集合并透传
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/reason_code/.test(c)||!/DETERMINISTIC|deterministic/i.test(c)||!/projection_revision_mismatch/.test(c))process.exit(1)"

- [ ] [ARTIFACT] diff-gate.test.js 含新增确定性/瞬态/向后兼容断言
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!c.includes('projection_revision_mismatch')||!c.includes('fact_snapshot_stale'))process.exit(1)"

- [ ] [ARTIFACT] 下游 loop.js 已就绪消费 diff-gate 新出口（reason 拼 gateVerdict，非本 sprint 修改，佐证 PRD 假设 2）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/loop.js','utf8');if(!c.includes('deny:impact:${impactGateReceipt?.reason')||!c.includes('impactGateReceipt?.retryable === false'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，五行剧本；L2=真实 evaluateDiffGate 模块逻辑真跑，db-read/mapClient 为注入缝，见合同未覆盖清单）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 stale 码 projection_revision_mismatch 透传且 retryable=false（fail-closed 终态｜覆盖 INV-1）
  动作: 以 mapperResult.freshness={status:'stale',reason_code:'projection_revision_mismatch'} 调真实 evaluateDiffGate（注入 db-read 返回 active contract + mapClient）
  预期观察: 返回 {gate:'impact_unknown', reason:'projection_revision_mismatch', reason_code:'projection_revision_mismatch', retryable:false}（旧行为返 reason:'mapper_stale',retryable:true——RED 复现点）
  等待预算: 0s
  留证: vitest -t 用例输出末 5 行（含 ✓ 行）进 behavior_tests.log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "projection_revision_mismatch"'

- [ ] [BEHAVIOR] [L2] B-02: 确定性 unknown 码 capability_not_in_active_projection 透传且 retryable=false（覆盖 INV-1）
  动作: 以 mapperResult.freshness={status:'unknown',reason_code:'capability_not_in_active_projection'} 调真实 evaluateDiffGate
  预期观察: 返回 {gate:'impact_unknown', reason:'capability_not_in_active_projection', reason_code:'capability_not_in_active_projection', retryable:false}
  等待预算: 0s
  留证: vitest -t 用例输出末 5 行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "capability_not_in_active_projection"'

- [ ] [BEHAVIOR] [L2] B-03: 瞬态码 fact_snapshot_stale 保持 retryable=true（不被误 fail-closed 挡死｜覆盖 INV-1 边界）
  动作: 以 mapperResult.freshness={status:'stale',reason_code:'fact_snapshot_stale'} 调真实 evaluateDiffGate
  预期观察: 返回 {gate:'impact_unknown', reason_code:'fact_snapshot_stale', retryable:true}（瞬态可自愈，不终态阻断）
  等待预算: 0s
  留证: vitest -t 用例输出末 5 行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "fact_snapshot_stale"'

- [ ] [BEHAVIOR] [L2] B-04: 向后兼容——freshness 存在但 reason_code=null 回退 mapper_stale + retryable=true
  动作: 以 mapperResult.freshness={status:'stale',reason_code:null} 调真实 evaluateDiffGate
  预期观察: 返回 {gate:'impact_unknown', reason:'mapper_stale', retryable:true}（旧 Map 响应无 reason_code 时行为不变）
  等待预算: 0s
  留证: vitest -t 用例输出末 5 行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "reason_code 为 null"'

- [ ] [BEHAVIOR] [L2] B-05: 边界不变——freshness 缺失回退 mapper_stale + retryable=true（error/边界路径，行为不变）
  动作: 以 mapperResult 无 freshness 对象调真实 evaluateDiffGate
  预期观察: 返回 {gate:'impact_unknown', reason:'mapper_stale', retryable:true}（freshness 缺失既有行为不回退）
  等待预算: 0s
  留证: vitest -t 用例输出末 5 行进 behavior_tests.log_tail
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js -t "freshness 缺失"'
