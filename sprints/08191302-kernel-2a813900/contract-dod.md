---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 步骤 3a reason_code 透传 + fail-closed 出口

**范围**: `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a（`mapper_stale` 分支）改为透传 Mapper 确定性 reason_code + fail-closed 出口判定；配套 failing→passing 回归测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 引入 reason_code 透传分支，且保留 mapper_stale 瞬时分支
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!/reason_code/.test(c)||!/mapper_stale/.test(c)||!/retryable:\s*false/.test(c))process.exit(1)"

- [ ] [ARTIFACT] package 永久回归落在 diff-gate.test.js（含 mapper_stale + retryable 断言）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/__tests__/diff-gate.test.js','utf8');if(!/mapper_stale/.test(c)||!/retryable/.test(c))process.exit(1)"

- [ ] [ARTIFACT] sprint 契约 RED 测试存在
  Test: node -e "require('fs').accessSync('sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type=autonomous，mode A oracle = vitest 断言）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 reason_code 透传且 retryable=false（不再折叠成 mapper_stale）
  动作: 注入 mapClient 返回 `freshness:{status:'stale',reason_code:'projection_revision_mismatch'}`，跑 evaluateDiffGate 步骤 3a 契约用例
  预期观察: 用例通过——出口 `reason==='projection_revision_mismatch'` 且 `retryable===false`
  等待预算: 0s（同步跑测到结束）
  留证: /tmp/b01.log 末尾 Vitest 汇总行（含 1 passed）
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t "确定性 reason_code 透传" --no-cache >/tmp/b01.log 2>&1 && grep -qE "Tests[[:space:]]+1 passed" /tmp/b01.log || { echo FAIL; cat /tmp/b01.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: 透传时 reason_code 字段回填与 reason 同值（透传证据）
  动作: 注入 mapClient 返回 `freshness:{status:'unknown',reason_code:'map_unavailable'}`，跑契约用例
  预期观察: 用例通过——`reason==='map_unavailable'` 且 `reason_code==='map_unavailable'` 且 `retryable===false`
  等待预算: 0s
  留证: /tmp/b02.log 末尾 Vitest 汇总行
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t "回填到 reason_code 字段" --no-cache >/tmp/b02.log 2>&1 && grep -qE "Tests[[:space:]]+1 passed" /tmp/b02.log || { echo FAIL; cat /tmp/b02.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-03: 对照——真·瞬时 stale（reason_code=null）保留 mapper_stale + retryable=true
  动作: 注入 mapClient 返回 `freshness:{status:'stale',reason_code:null}`，跑契约用例
  预期观察: 用例通过——`reason==='mapper_stale'` 且 `retryable===true`（重试语义不回退）
  等待预算: 0s
  留证: /tmp/b03.log 末尾 Vitest 汇总行
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t "真·瞬时 stale" --no-cache >/tmp/b03.log 2>&1 && grep -qE "Tests[[:space:]]+1 passed" /tmp/b03.log || { echo FAIL; cat /tmp/b03.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: 边界——既无 freshness 也无 reason_code 时 fail-closed（impact_unknown/mapper_stale/retryable=true，绝不假绿）
  动作: 注入 mapClient 返回无 freshness、无 reason_code 的结果，跑契约用例
  预期观察: 用例通过——`gate==='impact_unknown'`（不放行为 pass/extend/drift）且 `retryable===true`
  等待预算: 0s
  留证: /tmp/b04.log 末尾 Vitest 汇总行
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t "既无 freshness 也无 reason_code" --no-cache >/tmp/b04.log 2>&1 && grep -qE "Tests[[:space:]]+1 passed" /tmp/b04.log || { echo FAIL; cat /tmp/b04.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: 边界——顶层确定性 reason_code 存在但 Mapper 缺 retryable 字段时，Gate 仍判 retryable=false（有 reason_code ⇒ 非重试）
  动作: 注入 mapClient 返回顶层 `reason_code:'provider_denied'` + `freshness:{status:'stale'}`（无 retryable），跑契约用例
  预期观察: 用例通过——`reason==='provider_denied'` 且 `retryable===false`
  等待预算: 0s
  留证: /tmp/b05.log 末尾 Vitest 汇总行
  Test: manual:bash -c 'node_modules/.bin/vitest run sprints/08191302-kernel-2a813900/tests/diff-gate-reason-code.test.ts -t "非重试" --no-cache >/tmp/b05.log 2>&1 && grep -qE "Tests[[:space:]]+1 passed" /tmp/b05.log || { echo FAIL; cat /tmp/b05.log; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-06: package 永久回归全绿——既有 diff-gate 断言不破坏 + 新增透传回归（子 shell 切进包根，9.25 死规则）
  动作: 从 packages/brain 子 shell 跑 diff-gate.test.js 全量
  预期观察: 全部通过，0 failed（透传 fix 不破坏既有 20 条 + 新回归绿）
  等待预算: 0s
  留证: /tmp/b06.log 末尾 Vitest 汇总行
  Test: manual:bash -c '(cd packages/brain && ../../node_modules/.bin/vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js) >/tmp/b06.log 2>&1 && grep -qE "Tests[[:space:]]+[0-9]+ passed" /tmp/b06.log && ! grep -qE "[1-9][0-9]* failed" /tmp/b06.log || { echo FAIL; cat /tmp/b06.log; exit 1; }'

## Invariant 覆盖（铁律逐条映射 — Step 1.3）

- INV-fail-closed → 由 B-04 覆盖：不可判定情形（无 freshness+无 reason_code）返回 impact_unknown，绝不放行 pass/extend/drift。
- INV-nightly-red 文案 → N/A：本 sprint 不触及 CI job 失败输出/PowerShell 截断逻辑，仅改 diff-gate 决策分支。
