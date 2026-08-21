contract_branch: cp-harness-propose-r1-638f9ae4-re1f52e3f-a4
sprint_dir: sprints/08211041-kernel-638f9ae4

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性结论 fail-closed 出口（r19）

**范围**: 仅 `packages/brain/src/impact-contract/diff-gate.js` 步骤 3a——常量 `mapper_stale` 出口改为透传 `freshness.reason_code` + 按 `freshness.status` 决定 `retryable`（stale→true、unknown/缺失→false）。步骤 1/2/3b/4/5 与 Mapper、dispatcher 消费端不动。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 步骤 3a 已透传 reason_code（不再字面写死 `reason: 'mapper_stale'` 作为唯一常量出口，改为读 `freshness.reason_code` + 回退）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');const seg=c.slice(c.indexOf('3a'),c.indexOf('3b'));if(!seg.includes('reason_code'))process.exit(1)"
  期望: exit 0（3a 段引用 freshness.reason_code）

- [ ] [ARTIFACT] sprint red 回归测试文件存在且断言 fail-closed 分流
  Test: node -e "const c=require('fs').readFileSync('sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js','utf8');if(!c.includes('retryable')||!c.includes('reason_code'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: unknown 结构性确定结论产出终局 deny（retryable=false + reason 透传真实 reason_code）
  动作: 注入 mapClient 返回 `{freshness:{status:'unknown',reason_code:'capability_not_in_active_projection'}}`（含 5 种结构性 code），db=null 调 evaluateDiffGate
  预期观察: receipt = `{gate:'impact_unknown', reason:<透传的真实 code>, retryable:false}`——dispatcher 依 retryable=false 停止重新点火，不再空转
  等待预算: 0s（同步函数返回）
  留证: vitest 输出末尾（含 PASS 行）
  Test: manual:bash -c 'npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js -t "unknown 结构性确定结论产出终局 deny" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-02: stale 事实快照滞后仍可重试（retryable=true + reason 透传，行为不回退）
  动作: 注入 mapClient 返回 `{freshness:{status:'stale',reason_code:'fact_snapshot_stale'}}`（含 projection_revision_behind），db=null 调 evaluateDiffGate
  预期观察: receipt = `{gate:'impact_unknown', reason:<透传的真实 code>, retryable:true}`——保留自愈重试，不回退
  等待预算: 0s
  留证: vitest 输出末尾
  Test: manual:bash -c 'npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js -t "stale 事实快照滞后仍可重试" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-03: reason_code 缺失/null 回退 mapper_stale，retryable 仍按 status（unknown→false，freshness 整体缺失→false）
  动作: 分别注入 `{status:'unknown'}`、`{status:'unknown',reason_code:null}`、`{status:'stale'}` 及无 freshness 的 Mapper 结果调 evaluateDiffGate
  预期观察: unknown 缺 code → `reason='mapper_stale' && retryable=false`；stale 缺 code → `retryable=true`；无 freshness → `reason='mapper_stale' && retryable=false`（保底不假绿）
  等待预算: 0s
  留证: vitest 输出末尾
  Test: manual:bash -c 'npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js -t "reason_code 缺失时回退 mapper_stale" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-1: [不假绿] 非 fresh 分流恒保持 gate=impact_unknown（透传只改 reason/retryable，绝不落 pass/extend/假绿）
  动作: 注入 unknown 与 stale 两类非 fresh Mapper 结果调 evaluateDiffGate
  预期观察: 两类 receipt 的 `gate` 均为 `impact_unknown`（不变量：本 sprint 不改 gate；不可判定情形绝不假绿）
  等待预算: 0s
  留证: vitest 输出末尾
  Test: manual:bash -c 'npx vitest run sprints/08211041-kernel-638f9ae4/tests/diff-gate-reason-code.test.js -t "非 fresh 分流恒保持 gate=impact_unknown" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-05: 全仓既有 diff-gate 单测无回退（步骤 1/2/3b/4/5 与 pass/extend/drift 行为保持）
  动作: 切进 packages/brain 包根，用其自身 vitest 配置跑既有 diff-gate.test.js 全部 20 断言
  预期观察: 20 tests 全绿（本 sprint 只改 3a，既有出口与裁决行为不回退）
  等待预算: 0s
  留证: vitest 输出（Tests 20 passed）
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js --reporter=dot)'
  期望: exit 0

## 铁律映射（Step 1.3）

- INV-1（[不假绿]）→ 已映射为上方 `[BEHAVIOR] [L2] INV-1`（gate 恒 impact_unknown，非 fresh 绝不假绿）。
- INV-2（[nightly-red原始日志]）→ N/A：本 sprint 为 Brain 内部裁决逻辑改动，不涉及 nightly job / issue 日志贴附路径（PRD Invariant 段自述「本 sprint 不涉及但为 line 铁律」）。
