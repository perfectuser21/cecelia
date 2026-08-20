---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口（r19/r28）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a（mapper freshness 非 fresh 折叠点）——透传 `mapperResult.freshness.reason_code` + 终态/缺失 fail-closed 非重试出口 + 真瞬态保持可重试。
**大小**: S

## 历史铁律映射（controller 注入铁律 → 覆盖方式）

- [真验证]: 满足——所有 BEHAVIOR 为 node/vitest 真执行真实 `diff-gate.js`，exit code 驱动，无空泛断言。
- [禁写死]: 满足——无写死环境假设值；瞬态白名单从 `map/radius.js` 枚举推导，非臆造阈值。
- [多租户]: N/A——Brain 内部裁决纯函数，无租户维度、无跨租户数据。
- [端点鉴权]: N/A——本单不新增/修改 HTTP 端点，无鉴权面。
- [status枚举全grep]: 见 INV-1（BEHAVIOR）——瞬态白名单与 radius.js 枚举全 grep 同步。
- [else显式]: 满足——步骤 3a `!mapperResult?.freshness || status!=='fresh'` 分支显式兜底 null/缺失 reason_code（B-03 验），无漏判。
- [fail-closed]: 满足——终态（B-01/B-04）与 null/缺失（B-03）一律 retryable:false，绝不假绿放行。

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 引入显式瞬态白名单常量（终态默认非重试）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/TRANSIENT_FRESHNESS_REASON_CODES/.test(c)||!/fact_snapshot_stale/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 永久回归测试落入 brain __tests__（修复后保留）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!/capability_not_in_active_projection/.test(c)||!/retryable/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，内嵌单行 manual: 命令；导入真实 diff-gate.js，无 Postgres）

- [ ] [BEHAVIOR] [L2] B-01: 终态 unknown/capability_not_in_active_projection 透传 reason_code 且 retryable=false
  动作: 调 evaluateDiffGate，mapClient 返回 freshness={status:'unknown', reason_code:'capability_not_in_active_projection'}（db=undefined）
  预期观察: 返回 gate='impact_unknown'、reason_code='capability_not_in_active_projection'、reason≠'mapper_stale'、retryable=false（run 不再空转）
  等待预算: 0s
  留证: /tmp/dod-b01.log（vitest Test Files 1 passed）
  Test: manual:bash -c 'bash -c "npx vitest run --no-cache sprints/08201318-kernel-b7aecbef/tests/diff-gate-mapper-stale-reason-code.test.js -t B-01"'

- [ ] [BEHAVIOR] [L2] B-02: 真瞬态 stale/fact_snapshot_stale 透传 reason_code 且 retryable=true（既有行为不回退）
  动作: 调 evaluateDiffGate，mapClient 返回 freshness={status:'stale', reason_code:'fact_snapshot_stale'}
  预期观察: 返回 gate='impact_unknown'、reason_code='fact_snapshot_stale'、retryable=true（瞬态仍可重试）
  等待预算: 0s
  留证: /tmp/dod-b02.log（vitest Test Files 1 passed）
  Test: manual:bash -c 'bash -c "npx vitest run --no-cache sprints/08201318-kernel-b7aecbef/tests/diff-gate-mapper-stale-reason-code.test.js -t B-02"'

- [ ] [BEHAVIOR] [L2] B-03: reason_code 缺失但 non-fresh 时 fail-closed 兜底 retryable=false（禁未知即重试）
  动作: 调 evaluateDiffGate，mapClient 返回 freshness={status:'unknown'}（无 reason_code）
  预期观察: 返回 gate='impact_unknown'、reason_code=null、retryable=false（不静默假绿、不空转）
  等待预算: 0s
  留证: /tmp/dod-b03.log（vitest Test Files 1 passed）
  Test: manual:bash -c 'bash -c "npx vitest run --no-cache sprints/08201318-kernel-b7aecbef/tests/diff-gate-mapper-stale-reason-code.test.js -t B-03"'

- [ ] [BEHAVIOR] [L2] B-04: 终态 stale/manifest_projection_mismatch 也 fail-closed retryable=false（覆盖 stale 类终态，reason≠mapper_stale）
  动作: 调 evaluateDiffGate，mapClient 返回 freshness={status:'stale', reason_code:'manifest_projection_mismatch'}
  预期观察: 返回 reason_code='manifest_projection_mismatch'、retryable=false、reason≠'mapper_stale'（确定性结论绝不再输出裸常量）
  等待预算: 0s
  留证: /tmp/dod-b04.log（vitest Test Files 1 passed）
  Test: manual:bash -c 'bash -c "npx vitest run --no-cache sprints/08201318-kernel-b7aecbef/tests/diff-gate-mapper-stale-reason-code.test.js -t B-04"'

- [ ] [BEHAVIOR] [L2] INV-1 [status枚举全grep]: 既有 diff-gate 全套单测不回退 + 瞬态白名单字面同步 radius.js
  动作: 子 shell 进 packages/brain 跑既有 diff-gate.test.js 全套；并核瞬态白名单成员 fact_snapshot_stale 是 radius.js baseFreshness 的字面枚举
  预期观察: 既有套件 Test Files 1 passed（fresh→pass/extend/drift/revision 各分支不回退）；fact_snapshot_stale 同时存在于 diff-gate.js 白名单与 radius.js
  等待预算: 0s
  留证: /tmp/dod-inv1.log
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js && grep -q fact_snapshot_stale src/impact-contract/diff-gate.js && grep -q fact_snapshot_stale src/map/radius.js"'
  期望: exit 0
