---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code 并 fail-closed 出口

**范围**: `diff-gate.js` 步骤 3a 透传 `freshness.reason_code` + 依确定性名单判 `retryable`；`harness-gates.js` `gateReceipt` 透传 `reason_code`（导出以便验证）。不改 `mapper_unavailable`/`revision_mismatch`/`*_digest_mismatch` 出口、不改 Map 服务端、不改 kernel 重试调度器。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] diff-gate.js 步骤 3a 出口透传 reason_code 且含瞬时白名单常量
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('reason_code')||!/TRANSIENT_FRESHNESS_REASON_CODES/.test(c))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] harness-gates.js 导出 gateReceipt 且收据透传 reason_code 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/harness-gates.js','utf8');if(!/export\s+function\s+gateReceipt|export\s*\{[^}]*gateReceipt/.test(c)||!/reason_code:\s*result\.reason_code/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，autonomous / L2 服务端真验；被改判定边由真实 gate 代码执行）

- [x] [BEHAVIOR] [L2] B-01: 确定性结论（projection_revision_mismatch）透传真码且 fail-closed retryable=false
  动作: 以 `freshness={status:'stale',reason_code:'projection_revision_mismatch'}` 的 Mapper 桩调用真实 evaluateDiffGate
  预期观察: 返回 `gate='impact_unknown'`、`reason_code='projection_revision_mismatch'`、`reason='projection_revision_mismatch'`（不再裸 mapper_stale）、`retryable=false`
  等待预算: 0s
  留证: node 断言 stdout（OK deterministic_mismatch）
  Test: manual:bash -c 'node sprints/08212023-kernel-df8f8d37/tests/dod-assert.mjs deterministic_mismatch'

- [x] [BEHAVIOR] [L2] B-02: 确定性判定以 reason_code 为准，不看 status 字面（unknown 也 fail-closed）
  动作: 以 `freshness={status:'unknown',reason_code:'capability_not_in_active_projection'}` 调用真实 evaluateDiffGate
  预期观察: `reason_code='capability_not_in_active_projection'`、`retryable=false`（status='unknown' 不改变确定性判定）
  等待预算: 0s
  留证: node 断言 stdout（OK deterministic_unknown_status）
  Test: manual:bash -c 'node sprints/08212023-kernel-df8f8d37/tests/dod-assert.mjs deterministic_unknown_status'

- [x] [BEHAVIOR] [L2] B-03: 瞬时 staleness（fact_snapshot_stale）保留 retryable=true 且透传真码
  动作: 以 `freshness={status:'stale',reason_code:'fact_snapshot_stale'}` 调用真实 evaluateDiffGate
  预期观察: `reason_code='fact_snapshot_stale'`、`retryable=true`（可刷新 staleness 不被 fail-closed 卡死）
  等待预算: 0s
  留证: node 断言 stdout（OK transient_fact_stale）
  Test: manual:bash -c 'node sprints/08212023-kernel-df8f8d37/tests/dod-assert.mjs transient_fact_stale'

- [x] [BEHAVIOR] [L2] B-04: reason_code 缺失退回瞬时语义 retryable=true，reason 回退 mapper_stale
  动作: 以 `freshness={status:'stale'}`（无 reason_code）调用真实 evaluateDiffGate
  预期观察: `reason_code` 为 null、`retryable=true`、`reason='mapper_stale'`（旧瞬时语义保留）
  等待预算: 0s
  留证: node 断言 stdout（OK transient_null）
  Test: manual:bash -c 'node sprints/08212023-kernel-df8f8d37/tests/dod-assert.mjs transient_null'

- [x] [BEHAVIOR] [L2] B-05: gateReceipt 透传 reason_code——receipt.reason 展示真码、retryable=false，kernel deny 标签不再裸 mapper_stale
  动作: 对确定性 gate 结果调用真实 gateReceipt('diff', result) 并拼 `deny:impact:${receipt.reason}`
  预期观察: `receipt.reason='projection_revision_mismatch'`、`receipt.reason_code='projection_revision_mismatch'`、`receipt.retryable=false`，deny 标签为 `deny:impact:projection_revision_mismatch`
  等待预算: 0s
  留证: node 断言 stdout（OK receipt_passthrough）
  Test: manual:bash -c 'node sprints/08212023-kernel-df8f8d37/tests/dod-assert.mjs receipt_passthrough'

- [x] [BEHAVIOR] [L2] INV-1 [失败不降级]: 未知非 null reason_code 默认按确定性 fail-closed（retryable=false）
  动作: 以 `freshness={status:'stale',reason_code:'some_unregistered_reason_code'}`（不在瞬时白名单也不在已知确定性名单）调用真实 evaluateDiffGate
  预期观察: `reason_code='some_unregistered_reason_code'`、`retryable=false`（不降级放行，宁 blocked 待核对）
  等待预算: 0s
  留证: node 断言 stdout（OK unknown_code_failclosed）
  Test: manual:bash -c 'node sprints/08212023-kernel-df8f8d37/tests/dod-assert.mjs unknown_code_failclosed'

- [x] [BEHAVIOR] [L2] INV-2 [语义一致]: 判定端(diff-gate)与验证端(gateReceipt)同一 reason_code 处理策略一致（冻结 vitest 全过）
  动作: 从仓库根跑冻结 sprint 测试文件（覆盖判定端 + 收据端全部场景）
  预期观察: 6 个 it 全绿，无 failed（判定端返回值与收据端透传值语义一致，无跨脚本分叉）
  等待预算: 0s
  留证: /tmp/inv2-sprint.log 末尾 Test Files/Tests passed 行
  Test: manual:bash -c 'npx vitest run sprints/08212023-kernel-df8f8d37/tests/diff-gate-reason-code.test.js --reporter=dot 2>&1 | tee /tmp/inv2-sprint.log | grep -qiE "[0-9]+ +failed" && { echo FAIL; exit 1; } || grep -qE "Tests +[6-9]" /tmp/inv2-sprint.log'

> Invariant [status枚举] N/A：本 sprint 不新增/变更 freshness status 枚举值（仅消费既有 fresh/stale/unknown），无需全仓库 grep status 硬编码同步。
> Invariant [显式else]/[kernel时钟]/[系统]* N/A：本 sprint 无新 null-契约调用点、不改 kernel 时钟、不涉多租户/鉴权/跨 slot 并行。
