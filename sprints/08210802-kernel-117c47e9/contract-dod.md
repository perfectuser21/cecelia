---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性 fail-closed 出口（r34）

**范围**: `packages/brain/src/impact-contract/diff-gate.js` step 3a 非 fresh 分支——透传 `freshness.reason_code`、按是否带 reason_code 给 retryable；`__tests__/diff-gate.test.js` 新增永久回归断言。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 复现空转的永久回归测试存在于 CI 收录路径（sprints/** 由根 vitest include，合并后永久跑）
  Test: node -e "const c=require('fs').readFileSync('sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js','utf8');if(!/projection_revision_mismatch/.test(c)||!/retryable.*false/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 确定性 stale 透传 Mapper reason_code（不再写死 mapper_stale）
  动作: 注入 mapClient 返回 freshness.status=stale 且 reason_code='projection_revision_mismatch'，db=null，调用真实 evaluateDiffGate
  预期观察: 返回体 reason_code === 'projection_revision_mismatch'，gate === 'impact_unknown'
  等待预算: 0s
  留证: sprint 契约测试用例输出（Step 1 用例名「透传 reason_code」）进 log_tail
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js -t "透传 reason_code" 2>&1 | grep -Eq "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-02: 确定性结论 fail-closed 终态出口（retryable:false）
  动作: 同 B-01 的确定性输入，读取返回体 retryable
  预期观察: retryable === false（任务终态收敛，派发层不再无限重试）
  等待预算: 0s
  留证: sprint 契约测试两条确定性用例输出进 log_tail
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js -t "retryable:false" 2>&1 | grep -Eq "2 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-03: 无 reason_code 的暂时性 stale 保护（retryable:true 不误杀）
  动作: 注入 mapClient 返回 freshness.status=stale 且无 reason_code，db=null，调用 evaluateDiffGate
  预期观察: retryable === true 且 (reason_code ?? null) === null（保留暂时抖动可恢复，且不虚构来源）
  等待预算: 0s
  留证: sprint 契约测试「未被误杀」用例输出进 log_tail
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js -t "未被误杀" 2>&1 | grep -Eq "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-04: 整份 sprint 契约测试全绿（三场景确定性收敛）
  动作: 从仓库根跑整个 sprint 契约测试文件
  预期观察: 3 passed（透传 + 确定性 fail-closed + 暂时性保护），0 failed
  等待预算: 0s
  留证: /tmp 完整 vitest 输出末 10 行
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08210802-kernel-117c47e9/tests/diff-gate-mapper-stale-reason-code.test.js 2>&1 | grep -Eq "Tests[[:space:]]+3 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] INV-1: fail-closed 铁律不破 + 无回归 —— Mapper 不可判定绝不假绿放行
  动作: 从包根跑仓库既有 diff-gate.test.js（fail-closed 套件 + revision/digest 分支语义）
  预期观察: 全部 passed、0 failed；非 fresh 分支 gate 恒 impact_unknown，绝不出现 pass/extend 假绿；本 fix 未波及 revision/digest 分支 retryable 语义
  等待预算: 0s
  留证: packages/brain 子 shell vitest 输出进 log_tail
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js) 2>&1 | tee /tmp/inv1.log | grep -Eq "passed" && ! grep -Eq "[1-9][0-9]* failed" /tmp/inv1.log || exit 1'

## 铁律映射（非 BEHAVIOR — 逐条 N/A 显式登记）

- INV-2 [nightly-red 文案]（连续 ≥3 晚同 job 红时贴失败 step 最后 20 行原始 stdout）→ N/A：本 sprint 改动面仅 `diff-gate.js` step 3a，不触及 nightly CI issue 贴文逻辑，该铁律覆盖模块未被本 sprint 变更。
