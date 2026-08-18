---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口（r19）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a 分支——透传 `freshness.reason_code`，按 `status` 区分 `stale`(retryable=true) 与 `unknown`(retryable=false / fail-closed)，freshness/reason_code 缺失时保守兜底 `mapper_stale`+retryable:false；新增回归测试；orchestrator loop.test.js 补断言固化 `deny:impact:<reason_code>` 透传契约。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 3a 分支透传 freshness.reason_code（不再无条件硬编码 mapper_stale）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');const seg=c.slice(c.indexOf('3a.'),c.indexOf('3b.'));if(!/reason_code/.test(seg)||!/retryable:\s*false/.test(seg))process.exit(1)"
  期望: exit 0（3a 段落出现 reason_code 透传与 retryable:false 出口）

- [ ] [ARTIFACT] orchestrator loop.test.js 含 deny:impact:<reason_code> 透传断言
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/__tests__/loop.test.js','utf8');if(!c.includes('deny:impact:impact_anchor_missing'))process.exit(1)"
  期望: exit 0（loop 回归断言透传后的确定性 reason_code，而非 mapper_stale）

## BEHAVIOR 条目（五行剧本，autonomous / local_api，node·vitest 复算真实 evaluateDiffGate；postgres:false）

- [ ] [BEHAVIOR] [L2] B-01: unknown 确定性结论透传 reason_code 且非重试终止（fail-closed）
  动作: 以 `mapClient` 注入 `freshness={status:'unknown',reason_code:'impact_anchor_missing'}` 调真实 `evaluateDiffGate`
  预期观察: 返回 `{gate:'impact_unknown', reason:'impact_anchor_missing', reason_code:'impact_anchor_missing', retryable:false}`
  等待预算: 0s
  留证: vitest 输出末 5 行（含 "1 passed"）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-passthrough.test.js -t "unknown 确定性结论" 2>&1 | grep -qE "1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: stale 瞬时滞后透传 reason_code 且保持可重试
  动作: 以 `mapClient` 注入 `freshness={status:'stale',reason_code:'fact_snapshot_stale'}` 调真实 `evaluateDiffGate`
  预期观察: 返回 `{gate:'impact_unknown', reason:'fact_snapshot_stale', reason_code:'fact_snapshot_stale', retryable:true}`
  等待预算: 0s
  留证: vitest 输出末 5 行（含 "1 passed"）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-passthrough.test.js -t "stale 瞬时滞后" 2>&1 | grep -qE "1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: freshness 缺失时保守 fail-closed 兜底 mapper_stale 且非重试
  动作: 以 `mapClient` 注入 `freshness=undefined` 调真实 `evaluateDiffGate`
  预期观察: 返回 `{gate:'impact_unknown', reason:'mapper_stale', retryable:false}`（不因缺 reason_code 而误标可无限重试）
  等待预算: 0s
  留证: vitest 输出末 5 行（含 "1 passed"）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-passthrough.test.js -t "freshness 缺失时" 2>&1 | grep -qE "1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: reason_code 为 null 时保守 fail-closed 兜底 mapper_stale 且非重试
  动作: 以 `mapClient` 注入 `freshness={status:'unknown',reason_code:null}` 调真实 `evaluateDiffGate`
  预期观察: 返回 `{gate:'impact_unknown', reason:'mapper_stale', retryable:false}`
  等待预算: 0s
  留证: vitest 输出末 5 行（含 "1 passed"）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-passthrough.test.js -t "reason_code 为 null" 2>&1 | grep -qE "1 passed" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-05: orchestrator loop 消费透传后 reason_code 不再空转（deny:impact:<reason_code> + 确定性终止）
  动作: 运行 packages/brain 自身 vitest 跑真实 orchestrator loop.test.js（含新增 deny:impact:impact_anchor_missing 透传断言 + 既有 mapper_stale 回归）
  预期观察: 全部用例通过、无失败用例；loop 对 `retryable:false` 走 `impact_contract_invalid` 终止而非 `infrastructure_blocked` 退避空转
  等待预算: 0s
  留证: /tmp/loop-dod.log 末 5 行（含 "passed" 且无 "failed"）
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js" > /tmp/loop-dod.log 2>&1; grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/loop-dod.log && ! grep -qE "Tests[[:space:]]+[0-9]+ failed" /tmp/loop-dod.log || { tail -5 /tmp/loop-dod.log; echo FAIL; exit 1; }; echo OK'

## Invariant 覆盖（铁律 → INV 条目，来源 PRD Invariant 段）

- [ ] [BEHAVIOR] [L2] INV-1 [fail-closed] Mapper 不可判定绝不假绿、确定性结论必须终止而非无限重试
  动作: 运行 packages/brain 自身 vitest 跑真实 diff-gate.test.js（3a 新分支 + 既有 4 类 impact_unknown fail-closed 出口回归：revision_evidence_missing / mapper_unavailable / revision_mismatch / *_digest_mismatch）
  预期观察: 全部用例通过、无失败；既有 fail-closed 出口 retryable 语义不回退
  等待预算: 0s
  留证: /tmp/diffgate-dod.log 末 5 行（含 "passed" 且无 "failed"）
  Test: manual:bash -c 'bash -c "cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js" > /tmp/diffgate-dod.log 2>&1; grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/diffgate-dod.log && ! grep -qE "Tests[[:space:]]+[0-9]+ failed" /tmp/diffgate-dod.log || { tail -5 /tmp/diffgate-dod.log; echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2 [reason 透传] 不得用泛化 mapper_stale 掩盖 Mapper 真实 reason_code
  动作: 运行 sprint 契约测试全 4 用例（unknown/stale 两条均断言 `reason===reason_code` 且 `reason!=='mapper_stale'`，缺失两条断言保守兜底）
  预期观察: 4 用例全绿——有真实 reason_code 时透传真值，无 reason_code 时才兜底 mapper_stale
  等待预算: 0s
  留证: /tmp/sprint-dod.log 末 5 行（含 "4 passed"）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08180424-kernel-c0d4fe12/tests/diff-gate-reason-passthrough.test.js > /tmp/sprint-dod.log 2>&1; grep -qE "4 passed" /tmp/sprint-dod.log || { tail -5 /tmp/sprint-dod.log; echo FAIL; exit 1; }; echo OK'

- INV-3 [nightly-red 归因] N/A：本 sprint 不触及 nightly-red issue 归因逻辑（连续 ≥3 晚同 job 红贴失败 step stdout），无交付物落在该铁律覆盖模块。
