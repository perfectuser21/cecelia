---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate reason_code 透传 + 确定性码 fail-closed 出口 [r42]

**范围**: `diff-gate.js` 步骤 3a 出口透传 `freshness.reason_code` + 确定性/瞬时分流 `retryable`；`harness-gates.js` `gateReceipt` 透传 `reason_code`（deny 标签不再裸 `mapper_stale`）
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 出口读取并透传 freshness.reason_code
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/freshness[^\n]*reason_code/.test(c)||!/retryable/.test(c))process.exit(1)"

- [ ] [ARTIFACT] harness-gates.js gateReceipt 返回对象含 reason_code 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/harness-gates.js','utf8');const g=c.slice(c.indexOf('function gateReceipt'),c.indexOf('function gateReceipt')+400);if(!/reason_code/.test(g))process.exit(1)"

- [ ] [ARTIFACT] 冻结回归测试文件存在且含五类分流覆盖
  Test: node -e "const c=require('fs').readFileSync('sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts','utf8');if(!/B-01/.test(c)||!/B-04/.test(c)||!/B-05/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 确定性码 no_anchor 透传进 reason_code 且 fail-closed
  动作: 注入 mapClient 返回 freshness={status:'stale',reason_code:'no_anchor'} + 受控 db，调用真实 evaluateDiffGate
  预期观察: gate=impact_unknown，result.reason_code==='no_anchor'（不再丢弃），result.retryable===false（fail-closed 停机）
  等待预算: 0s
  留证: vitest -t "B-01" 命令输出末 5 行（含 pass）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-01" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-02: 瞬时白名单 fact_snapshot_stale / projection_revision_missing 保留 retryable=true
  动作: 注入 mapClient 分别返回 freshness.reason_code=fact_snapshot_stale 与 projection_revision_missing，调用真实 evaluateDiffGate
  预期观察: 两码均 reason_code 透传且 result.retryable===true（瞬时可重试不停机）
  等待预算: 0s
  留证: vitest -t "B-02" 命令输出末 5 行（含 pass）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-02" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-03: freshness 缺失时 reason_code=null 且 retryable=true
  动作: 注入 mapClient 返回不含 freshness 的结果（保守当瞬时），调用真实 evaluateDiffGate
  预期观察: gate=impact_unknown，result.reason_code===null，result.retryable===true
  等待预算: 0s
  留证: vitest -t "B-03" 命令输出末 5 行（含 pass）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-03" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-04: gateReceipt diff deny 标签透传具体 reason_code，不再裸 mapper_stale
  动作: 经真实 createHarnessImpactGates(...).beforeEvaluate 走真实 gateReceipt，注入 diffGate 返回 {gate:'impact_unknown',reason_code:'no_anchor',retryable:false}
  预期观察: 回执 receipt.reason_code==='no_anchor' 且 receipt.reason==='no_anchor'（非裸 'mapper_stale'）
  等待预算: 0s
  留证: vitest -t "B-04" 命令输出末 5 行（含 pass）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-04" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-05: 白名单外未知 reason_code 归确定性 fail-closed retryable=false
  动作: 注入 mapClient 返回 freshness.reason_code='some_unknown_code'（白名单外），调用真实 evaluateDiffGate
  预期观察: reason_code 透传该未知码，result.retryable===false（默认 fail-closed，宁停勿空转）
  等待预算: 0s
  留证: vitest -t "B-05" 命令输出末 5 行（含 pass）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts -t "B-05" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-fail-closed: 3a 非 fresh 出口仍返回 impact_unknown 绝不假绿放行（铁律强化不破）
  动作: 跑整套冻结回归，确认所有非 fresh 分流的 gate 均为 impact_unknown（无 pass/extend 假绿）
  预期观察: 整文件全绿，无任一非 fresh 分支返回 pass/extend
  等待预算: 0s
  留证: 整文件 vitest --reporter=verbose 输出（含 passed 汇总）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; npx vitest run sprints/08220415-kernel-99e5425b/tests/diff-gate-reason-code.test.ts --no-cache --reporter=verbose'
  期望: exit 0
