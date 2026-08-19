---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性 unknown fail-closed

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a（freshness 非 fresh 分支）reason_code 透传 + retryable 按瞬态/确定性分流；对应回归测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 不再硬编码折叠 reason:'mapper_stale'（返回值改为透传 + 分流）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');const m=c.match(/freshness\.status\s*!==\s*'fresh'\)\s*\{([\s\S]*?)\n  \}/);if(!m)process.exit(1);if(/reason:\s*'mapper_stale'/.test(m[1]))process.exit(1);if(!/reason_code/.test(m[1])||!/status\s*===\s*'stale'/.test(m[1]))process.exit(1)"

- [ ] [ARTIFACT] 回归测试文件存在且断言瞬态/确定性分流
  Test: node -e "const c=require('fs').readFileSync('sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js','utf8');if(!c.includes('[B-01]')||!c.includes('[B-02]')||!c.includes('mapper_stale'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，L2 服务端真验 — 真跑 diff-gate.js 真实判定逻辑，仅注入 mapClient 外层边界）

- [ ] [BEHAVIOR] [L2] B-01: 瞬态 stale → retryable:true 且透传具体 reason_code（非 mapper_stale）
  动作: 以 freshness={status:'stale', reason_code:'fact_snapshot_stale'} 注入 mapClient，真调 evaluateDiffGate（db=null）
  预期观察: 返回 gate='impact_unknown', retryable=true, reason='fact_snapshot_stale'（透传），reason 不等于 'mapper_stale'
  等待预算: 0s
  留证: vitest verbose 输出末 25 行（含 ✓ ...[B-01] 用例 + Tests N passed）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; OUT=$(npx vitest run --no-cache --reporter=verbose sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js 2>&1); echo "$OUT" | grep -q "\[B-01\]" && echo "$OUT" | grep -qE "Tests[[:space:]]+[0-9]+ passed" && ! echo "$OUT" | grep -qE "[1-9][0-9]* failed" && echo OK || { echo "$OUT" | tail -25; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: 确定性 unknown → retryable:false（fail-closed）且透传具体 reason_code
  动作: 以 freshness={status:'unknown', reason_code:'impact_unknown'} 注入 mapClient，真调 evaluateDiffGate（db=null）
  预期观察: 返回 gate='impact_unknown', retryable=false（fail-closed）, reason='impact_unknown'（透传），reason 不等于 'mapper_stale'
  等待预算: 0s
  留证: vitest verbose 输出末 25 行（含 ✓ ...[B-02] 用例 + Tests N passed）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; OUT=$(npx vitest run --no-cache --reporter=verbose sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js 2>&1); echo "$OUT" | grep -q "\[B-02\]" && echo "$OUT" | grep -qE "Tests[[:space:]]+[0-9]+ passed" && ! echo "$OUT" | grep -qE "[1-9][0-9]* failed" && echo OK || { echo "$OUT" | tail -25; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: 边界 缺 reason_code / 未知 status → fail-closed 占位 unknown（不回退 mapper_stale）
  动作: 以 freshness={status:'unknown'}（缺 reason_code）及 freshness 完全缺失两种输入，真调 evaluateDiffGate（db=null）
  预期观察: 两种输入均返回 retryable=false（fail-closed）, gate='impact_unknown'；缺字段场景 reason='unknown' 占位，reason 均不等于 'mapper_stale'
  等待预算: 0s
  留证: vitest verbose 输出末 25 行（含 ✓ ...[B-03] 用例 + Tests N passed）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; OUT=$(npx vitest run --no-cache --reporter=verbose sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js 2>&1); echo "$OUT" | grep -q "\[B-03\]" && echo "$OUT" | grep -qE "Tests[[:space:]]+[0-9]+ passed" && ! echo "$OUT" | grep -qE "[1-9][0-9]* failed" && echo OK || { echo "$OUT" | tail -25; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: 禁 mapper_stale 残留 — 所有非 fresh 分支 reason 绝不等于 mapper_stale（堵无限重试出口）
  动作: 遍历 4 组 freshness（瞬态/确定性/多确定性码/缺码）真调 evaluateDiffGate（db=null）矩阵断言
  预期观察: 4 组输入返回的 reason 均不等于 'mapper_stale'，retryable 均为 boolean，gate 恒 'impact_unknown'
  等待预算: 0s
  留证: vitest verbose 输出末 25 行（含 ✓ ...[B-04] 用例 + Tests N passed）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; OUT=$(npx vitest run --no-cache --reporter=verbose sprints/08192211-kernel-4bf639e3/tests/diff-gate-reason-passthrough.test.js 2>&1); echo "$OUT" | grep -q "\[B-04\]" && echo "$OUT" | grep -qE "Tests[[:space:]]+[0-9]+ passed" && ! echo "$OUT" | grep -qE "[1-9][0-9]* failed" && echo OK || { echo "$OUT" | tail -25; exit 1; }'

- [ ] [BEHAVIOR] [L2] INV-1/B-05: 既有 brain 单测无回退（diff-gate.test.js + harness-gates.test.js 全绿）
  动作: 从 packages/brain 子 shell 跑既有两份单测（含 mapper_unavailable/revision_mismatch/beforeMerge 折叠等既有断言）
  预期观察: 两份单测全绿（35 用例），既有 mapper_stale 相关断言（harness-gates beforeMerge mock 路径）不被破坏，确认重试身份不变量未回退
  等待预算: 0s
  留证: vitest 输出末 25 行（Test Files 2 passed / Tests N passed）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)/packages/brain"; OUT=$(npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/harness-gates.test.js 2>&1); echo "$OUT" | grep -qE "Tests[[:space:]]+[0-9]+ passed" && ! echo "$OUT" | grep -qE "[1-9][0-9]* failed" && echo OK || { echo "$OUT" | tail -25; exit 1; }'
