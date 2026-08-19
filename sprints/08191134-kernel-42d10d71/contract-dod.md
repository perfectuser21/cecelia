---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 确定性 reason_code 透传 + fail-closed 出口

**范围**: diff-gate.js / structure-gate.js 确定性 reason_code 的 retryable 分桶（不折叠成 mapper_stale）+ orchestrator 确定性→fail-closed 出口验证；保留瞬态有限重试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] diff-gate.js 确定性 reason_code 标记 retryable=false（revision/digest mismatch 分支不再落 retryable:true）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');const m=c.match(/manifest_digest_mismatch[\s\S]{0,80}?retryable:\s*true/);if(m)process.exit(1)"

- [ ] [ARTIFACT] structure-gate.js revision_mismatch 确定性（不再 httpStatus===409 恒 retryable=true）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/structure-gate.js','utf8');if(!/revision_mismatch/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 合同确定性→fail-closed 测试文件存在且断言 retryable=false
  Test: node -e "const c=require('fs').readFileSync('sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts','utf8');if(!c.includes('retryable')||!c.includes('revision_mismatch'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous / vitest oracle）

- [ ] [BEHAVIOR] [L2] B-01: 确定性 revision/digest mismatch → 具体 reason_code + retryable=false（本次核心修复，红转绿）
  动作: 从仓库根跑合同确定性测试（真跑 evaluateDiffGate/evaluateStructureGate，仅注入 mapClient 外部边界与只读 stub db）
  预期观察: 三个确定性 reason（revision_mismatch/manifest_digest_mismatch/projection_digest_mismatch）返回该具体码且 retryable===false，全部用例 passed
  等待预算: 120s（超时=FAIL）
  留证: /tmp/b01-deterministic.log 末 20 行（含 passed 行）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts > /tmp/b01-deterministic.log 2>&1; tail -20 /tmp/b01-deterministic.log; grep -Eq "[0-9]+ passed" /tmp/b01-deterministic.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b01-deterministic.log || { echo "FAIL: 确定性 retryable=false 用例未全过"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-02: 瞬态 mapper_stale/unavailable/revision_evidence_missing 保留 retryable=true（回归守卫，防"确定性刷一片"误伤瞬态）
  动作: 从仓库根跑合同测试中 -t "瞬态" 子集（真跑 diff-gate 瞬态分支）
  预期观察: mapper_stale / mapper_unavailable / revision_evidence_missing 返回 retryable===true，用例 passed
  等待预算: 120s
  留证: /tmp/b02-transient.log 末 20 行
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts -t "瞬态" > /tmp/b02-transient.log 2>&1; tail -20 /tmp/b02-transient.log; grep -Eq "[0-9]+ passed" /tmp/b02-transient.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b02-transient.log || { echo "FAIL: 瞬态 retryable=true 回归破坏"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-03: orchestrator 确定性 receipt → 立即 failRun('impact_gate_deterministic:<reason>')，0 退避（fail-closed 出口）
  动作: 在 packages/brain 包内子 shell 跑 loop.test.js 确定性精确终止用例（真跑 runLoop 路由逻辑）
  预期观察: exitReason=impact_gate_deterministic，dispatch 未被调用，sleeps 为空，finalizeRun reason 前缀 impact_gate_deterministic:
  等待预算: 120s
  留证: /tmp/b03-loop-det.log 末 25 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js -t "impact_gate_deterministic" > /tmp/b03-loop-det.log 2>&1; tail -25 /tmp/b03-loop-det.log; grep -Eq "[0-9]+ passed" /tmp/b03-loop-det.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b03-loop-det.log || { echo "FAIL: 确定性 fail-closed 出口未过"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-04: 瞬态 infrastructure_blocked 有限退避回归（sleep(POLL_INTERVAL_MS)，blocked_same_state 兜底不回退）
  动作: 在 packages/brain 包内子 shell 跑 loop.test.js 瞬态退避用例
  预期观察: 瞬态 BLOCKED 走 sleep(POLL_INTERVAL_MS) 退避复探，not terminalize；同态 2 次上限兜底保留，用例 passed
  等待预算: 120s
  留证: /tmp/b04-loop-transient.log 末 25 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/loop.test.js -t "infrastructure BLOCKED backs off" > /tmp/b04-loop-transient.log 2>&1; tail -25 /tmp/b04-loop-transient.log; grep -Eq "[0-9]+ passed" /tmp/b04-loop-transient.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b04-loop-transient.log || { echo "FAIL: 瞬态退避回归破坏"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-05: harness-gates receipt 原样透传 reason_code + retryable（不在接力层被折叠）
  动作: 在 packages/brain 包内子 shell 跑 harness-gates.test.js（真跑 beforeEvaluate→diffGate→gateReceipt 接力）
  预期观察: receipt.reason 为具体确定性码、receipt.retryable 与 diff-gate 返回一致，用例 passed
  等待预算: 120s
  留证: /tmp/b05-hgates.log 末 20 行
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/harness-gates.test.js > /tmp/b05-hgates.log 2>&1; tail -20 /tmp/b05-hgates.log; grep -Eq "[0-9]+ passed" /tmp/b05-hgates.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b05-hgates.log || { echo "FAIL: receipt 透传套件未过"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-[语义一致] B-06: 同一 reason_code 在 diff-gate 与 structure-gate 同一 retryable 分桶（禁两端语义分叉开假绿面）
  动作: 跑合同测试中 -t "语义一致" 子集（真跑两个 gate 对 revision_mismatch 的 retryable，断言相等且均 false）
  预期观察: diff-gate 与 structure-gate 对 revision_mismatch 均返回 retryable===false（同桶），用例 passed
  等待预算: 120s
  留证: /tmp/b06-invariant.log 末 20 行
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08191134-kernel-42d10d71/tests/deterministic-fail-closed.test.ts -t "语义一致" > /tmp/b06-invariant.log 2>&1; tail -20 /tmp/b06-invariant.log; grep -Eq "[0-9]+ passed" /tmp/b06-invariant.log && ! grep -Eq "[1-9][0-9]* failed" /tmp/b06-invariant.log || { echo "FAIL: 两端语义分叉"; exit 1; }; echo OK'
  期望: OK

## INV 铁律映射（历史约束三源 — 铁律清单逐条）

- INV-语义一致: 由 B-06 可执行断言覆盖（reason_code 在判变端 diff-gate/structure-gate 与终验端 loop 同一处理策略）
- INV-失败不降级: 由 B-03 覆盖（确定性 deny 显式 failRun 非零终态，无 warning 降级）
- INV-显式else: N/A：本 sprint 改的是早返回分支的 retryable 字面值，非"成功/失败契约函数"新增分支
- INV-status枚举排查: 见探索提示「边界值」——新增/变更 reason 须全仓库排查 retryable 分桶（不硬编码遗漏）
- INV-禁写死环境: N/A：无环境假设值（分桶依据 reason_code 类别，非坐标/阈值/env）
- INV-真环境验证: 逻辑断言类，vitest 真跑真实模块决策代码即 done（见接缝清单）
- INV-多租户默认 / 租户隔离 / 凭据安全 / 日志脱敏 / 端点鉴权: N/A：本 sprint 纯内核控制流，不触及租户/凭据/日志/端点面
