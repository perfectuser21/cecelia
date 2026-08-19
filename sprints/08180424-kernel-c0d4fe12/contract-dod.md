---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code 并对确定性结论 fail-closed 出口（r19）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a（mapper_stale 分支）reason_code 透传 + 确定性终态 `retryable:false`；`diff-gate.test.js` 永久回归。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 透传 freshness.reason_code 并按确定性集合判定 retryable
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/reason_code/.test(c)||!/no_anchor|DETERMINISTIC|freshness\.reason_code/.test(c))process.exit(1)"

- [ ] [ARTIFACT] diff-gate.test.js 永久回归包含 reason_code 透传 + no_anchor + retryable 断言（f62c7e87/d1360a48 空转不复现）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!/no_anchor/.test(c)||!/reason_code/.test(c)||!/retryable/.test(c))process.exit(1)"

## BEHAVIOR 条目（五行剧本，manual:bash 内嵌单行命令）

- [ ] [BEHAVIOR] [L2] B-01: 确定性结论 no_anchor 透传 reason_code 且 retryable:false（Golden Path step 1-3 fail-closed 出口）
  动作: 调 evaluateDiffGate，Mapper 返回 freshness.status=stale + reason_code=no_anchor（确定性终态）
  预期观察: 返回体 gate=impact_unknown、reason_code=no_anchor、retryable=false
  等待预算: 0s
  留证: verify --case deterministic stdout（含 "OK: no_anchor 透传且 retryable=false"）
  Test: manual:bash -c 'node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case deterministic'

- [ ] [BEHAVIOR] [L2] B-02: 确定性终态集合每个 code 均 retryable:false 且原样透传
  动作: 遍历确定性集合(no_anchor/anchor_missing/revision_mismatch/manifest_projection_mismatch/fail_current_revision)逐个调 evaluateDiffGate
  预期观察: 每个 code 返回 reason_code 原样透传、retryable=false、gate=impact_unknown
  等待预算: 0s
  留证: verify --case deterministic_all stdout（含 "5 个 code 全部 retryable=false"）
  Test: manual:bash -c 'node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case deterministic_all'

- [ ] [BEHAVIOR] [L2] B-03: 暂态原因仍 retryable:true 且透传（边界②，不误判为终态）
  动作: 遍历暂态集合(map_unavailable/resolver_error/fact_stale/fact_snapshot_stale)逐个调 evaluateDiffGate
  预期观察: 每个 code 返回 reason_code 透传、retryable=true、gate=impact_unknown
  等待预算: 0s
  留证: verify --case transient stdout（含 "4 个 code 全部 retryable=true"）
  Test: manual:bash -c 'node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case transient'

- [ ] [BEHAVIOR] [L2] B-04: reason_code 缺失保留 mapper_stale 语义 + retryable:true（边界①）
  动作: 调 evaluateDiffGate，Mapper 返回 freshness.status=stale 但无 reason_code
  预期观察: 返回体 reason=mapper_stale、retryable=true、无凭空生成的 reason_code
  等待预算: 0s
  留证: verify --case null_reason stdout（含 "mapper_stale + retryable=true"）
  Test: manual:bash -c 'node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case null_reason'

- [ ] [BEHAVIOR] [L2] B-05: Mapper 抛异常出口不受本改动波及（边界③回归 guard）
  动作: 调 evaluateDiffGate，mapClient 抛 ETIMEDOUT
  预期观察: 返回体 reason=mapper_unavailable、retryable=true、gate=impact_unknown
  等待预算: 0s
  留证: verify --case mapper_unavailable stdout（含 "mapper_unavailable + retryable=true"）
  Test: manual:bash -c 'node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case mapper_unavailable'

- [ ] [BEHAVIOR] [L2] INV-1: fail-closed 不变量——所有不可判定分支 gate 恒为 impact_unknown 绝不放行
  动作: 遍历确定性+暂态+缺失+抛异常全部分支调 evaluateDiffGate
  预期观察: 每个分支 gate=impact_unknown 且 verdict 不落 pass/extend/drift
  等待预算: 0s
  留证: verify --case fail_closed stdout（含 "绝不假绿放行"）
  Test: manual:bash -c 'node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case fail_closed'

- [ ] [BEHAVIOR] [L2] INV-2: 不无限空转不变量——确定性终态集合每个 code retryable=false（brain 永久回归套件全绿）
  动作: 子 shell 切进 packages/brain 跑 diff-gate 回归套件（含新增 reason_code 透传用例）
  预期观察: vitest 全绿，reason_code 透传 + retryable=false 用例通过，既有分支不回退
  等待预算: 0s
  留证: brain vitest --reporter=dot 输出末尾（passed 计数、无 failed）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=dot'
