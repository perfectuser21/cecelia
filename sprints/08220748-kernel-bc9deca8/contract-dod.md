---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: publisher 进 INFRA_RETRY_ACTION_BY_ROLE（runner_failure 有界重派不再 route_unknown）

**范围**: 仅在 `packages/brain/src/orchestrator/derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 增加一行 `publisher: { phase: 'publish', action: ACTION.PUBLISH_APPROVED_REF }` + 配套 RED→GREEN 冻结回归测试。不改额度语义、不改其它角色映射、不改 publisher 派发/执行、不改 dispatcher/attempt-store。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js 的 INFRA_RETRY_ACTION_BY_ROLE 含 publisher 条目，映射到原始派发动作 publish:approved_ref
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/publisher:\s*\{\s*phase:\s*'publish',\s*action:\s*ACTION\.PUBLISH_APPROVED_REF\s*\}/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 冻结回归测试文件存在且真调 derive（零 mock 被改边）
  Test: node -e "const c=require('fs').readFileSync('sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js','utf8');if(!c.includes('import { derive }')||/vi\.mock|sinon|stub/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，manual:bash 内嵌单行命令，evaluator 原样跑）

- [ ] [BEHAVIOR] [L2] B-01: publisher runner_failure 首次触发 derive 返回 publish 重派而非 route_unknown
  动作: 构造含一条 publisher runner_failure attempt_callback 的 decisionLog，调用真实 derive（不 stub）
  预期观察: derive 返回 { phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }，reason 不再是 callback_runner_failure_route_unknown
  等待预算: 0s
  留证: vitest --reporter=verbose 输出（含 B-01 ✓ 与 Tests 1 passed）
  Test: manual:bash -c 'OUT=$(npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t "B-01" --reporter=verbose 2>&1); echo "$OUT" | grep -qE "Tests[[:space:]]+1 passed" || { echo "$OUT" | tail -30; echo "FAIL: B-01 未通过（可能仍返回 route_unknown）"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: publisher runner_failure 累计 ≥2 次 → 人审兜底 exhausted（有界，不无限重派）
  动作: 构造含 3 条 publisher runner_failure（前 2 条已重派）的 decisionLog，调用真实 derive
  预期观察: derive 返回 { phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }
  等待预算: 0s
  留证: vitest --reporter=verbose 输出（含 B-02 ✓）
  Test: manual:bash -c 'OUT=$(npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t "B-02" --reporter=verbose 2>&1); echo "$OUT" | grep -qE "Tests[[:space:]]+1 passed" || { echo "$OUT" | tail -30; echo "FAIL: B-02 exhausted 兜底未通过"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 回归——非 publisher（evaluator）runner_failure 路由完全不变
  动作: 构造 evaluator runner_failure 首次回调 decisionLog，调用真实 derive
  预期观察: derive 返回 { phase:'evaluate', action:'spawn:evaluator', reason:'callback_runner_failure_retry' }（与本次改动前一致）
  等待预算: 0s
  留证: vitest --reporter=verbose 输出（含 B-03 ✓）
  Test: manual:bash -c 'OUT=$(npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t "B-03" --reporter=verbose 2>&1); echo "$OUT" | grep -qE "Tests[[:space:]]+1 passed" || { echo "$OUT" | tail -30; echo "FAIL: B-03 evaluator 回归被破坏"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 边界——publisher 普通 failed（无 failure_class）不受本次改动影响，仍判终态
  动作: 构造 publisher status=failed 但无 failure_class 的回调 decisionLog，调用真实 derive
  预期观察: derive 返回 { phase:'failed', action:'mark_failed' }，reason 不为 callback_runner_failure_retry、action 不为 publish:approved_ref
  等待预算: 0s
  留证: vitest --reporter=verbose 输出（含 B-04 ✓）
  Test: manual:bash -c 'OUT=$(npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t "B-04" --reporter=verbose 2>&1); echo "$OUT" | grep -qE "Tests[[:space:]]+1 passed" || { echo "$OUT" | tail -30; echo "FAIL: B-04 边界终态被误放宽"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-1 [重试身份]: publisher runner_failure 重派动作字面 == 原始服务端派发动作 publish:approved_ref（不静态误映射，避免候选不存在 WORKSPACE_RESOLUTION_FAILED）
  动作: 复用 B-01 冻结测试，断言 derive 返回 action 字面等于 dispatcher.js:118 的 publisher 派发动作 'publish:approved_ref'
  预期观察: derive 返回 action==='publish:approved_ref'（B-01 已逐字断言）
  等待预算: 0s
  留证: B-01 vitest 输出
  Test: manual:bash -c 'OUT=$(npx vitest run sprints/08220748-kernel-bc9deca8/tests/publisher-runner-failure-retry.test.js -t "B-01" --reporter=verbose 2>&1); echo "$OUT" | grep -qE "Tests[[:space:]]+1 passed" || { echo "$OUT" | tail -30; echo "FAIL: INV-1 重试身份未满足"; exit 1; }; grep -q "publish:approved_ref" packages/brain/src/orchestrator/dispatcher.js || { echo "FAIL: dispatcher publisher 派发动作校验失败"; exit 1; }; echo OK'

### 铁律映射（历史约束三源 · 铁律清单）

- INV-1 [重试身份]：见上方 [BEHAVIOR] INV-1（publisher 重派动作 == 原始派发动作 publish:approved_ref）。
- INV-2 [Planner分支]：N/A —— 本 sprint 仅改 derive 路由表，不触及 planner workspace/branch checkout。
