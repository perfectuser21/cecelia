contract_branch: cp-harness-propose-r1-3354cd28-r0ec96030-a10
sprint_dir: sprints/08221235-kernel-3354cd28

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: publisher 纳入 INFRA_RETRY_ACTION_BY_ROLE（runner_failure 有界重派）

**范围**: `packages/brain/src/orchestrator/derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 增加一行 `publisher: { phase: 'publish', action: ACTION.PUBLISH_APPROVED_REF }`；新增冻结回归测试守卫 publisher runner_failure 有界重派路由。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] derive.js 的 INFRA_RETRY_ACTION_BY_ROLE 含 publisher 表项（phase=publish, action=ACTION.PUBLISH_APPROVED_REF）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');const m=c.match(/INFRA_RETRY_ACTION_BY_ROLE\s*=\s*Object\.freeze\(\{[\s\S]*?\}\)/);if(!m||!/publisher:\s*\{\s*phase:\s*'publish',\s*action:\s*ACTION\.PUBLISH_APPROVED_REF\s*\}/.test(m[0]))process.exit(1)"

- [x] [ARTIFACT] 冻结测试文件存在且真调 real derive（不 mock 被改的边）
  Test: node -e "const c=require('fs').readFileSync('sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js','utf8');if(!c.includes(\"from '../../../packages/brain/src/orchestrator/derive.js'\")||/vi\.mock|sinon|stub/.test(c))process.exit(1)"

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 命令，evaluator 直接跑）

- [x] [BEHAVIOR] [L2] B-01: publisher runner_failure 首次 → derive 返回 publish 重派动作（不再 route_unknown）
  动作: 构造 decisionLog 含一条 publisher attempt_callback（status=failed, failure_class=runner_failure, role=publisher, priorRunnerFailures<2），调用真 derive(observed)
  预期观察: derive 返回 { phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }；reason 不含 route_unknown
  等待预算: 0s
  留证: vitest -t "publish 重派动作" 输出末 20 行（含 passed 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "publish 重派动作" 2>&1); printf '%s\n' "$O"; echo "$O" | grep -qE "[1-9][0-9]* passed" && ! echo "$O" | grep -q "No test files found" && ! echo "$O" | grep -q "callback_runner_failure_route_unknown" || { echo "$O" | tail -20; echo FAIL; exit 1; }; echo OK'

- [x] [BEHAVIOR] [L2] B-02: publisher runner_failure 首次不判 run 终态
  动作: 同 B-01 输入，调用真 derive(observed)
  预期观察: derive 返回 phase != 'failed' 且 action != 'mark_failed'（基础设施故障不烧 run）
  等待预算: 0s
  留证: vitest -t "不判 run 终态" 输出 passed 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "不判 run 终态" 2>&1); printf '%s\n' "$O"; echo "$O" | grep -qE "[1-9][0-9]* passed" && ! echo "$O" | grep -q "No test files found" || { echo "$O" | tail -20; echo FAIL; exit 1; }; echo OK'

- [x] [BEHAVIOR] [L2] B-03: 超限守恒 — 第 3 次 publisher runner_failure 仍进人审 exhausted
  动作: 构造 decisionLog 含 3 条 publisher runner_failure callback（priorRunnerFailures≥2），调用真 derive(observed)
  预期观察: derive 返回 { phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }（补表不改超限兜底）
  等待预算: 0s
  留证: vitest -t "超限守恒" 输出 passed 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "超限守恒" 2>&1); printf '%s\n' "$O"; echo "$O" | grep -qE "[1-9][0-9]* passed" && ! echo "$O" | grep -q "No test files found" || { echo "$O" | tail -20; echo FAIL; exit 1; }; echo OK'

- [x] [BEHAVIOR] [L2] B-04: 负向 — publisher 普通 failed（无 failure_class）照旧判终态
  动作: 构造 decisionLog 含一条 publisher failed callback（无 failure_class），调用真 derive(observed)
  预期观察: derive 返回 { phase:'failed', action:'mark_failed', reason:'callback_failed' }（不被本次放宽触碰）
  等待预算: 0s
  留证: vitest -t "负向" 输出 passed 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "负向" 2>&1); printf '%s\n' "$O"; echo "$O" | grep -qE "[1-9][0-9]* passed" && ! echo "$O" | grep -q "No test files found" || { echo "$O" | tail -20; echo FAIL; exit 1; }; echo OK'

- [x] [BEHAVIOR] [L2] B-05: 回归守恒 — evaluator runner_failure 首次仍重派 evaluator（累积 FR 不回退）
  动作: 构造 decisionLog 含一条 evaluator runner_failure callback，调用真 derive(observed)
  预期观察: derive 返回 { phase:'evaluate', action:'spawn:evaluator', reason:'callback_runner_failure_retry' }（既有角色行为不受本次改动回退）
  等待预算: 0s
  留证: vitest -t "回归守恒" 输出 passed 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "回归守恒" 2>&1); printf '%s\n' "$O"; echo "$O" | grep -qE "[1-9][0-9]* passed" && ! echo "$O" | grep -q "No test files found" || { echo "$O" | tail -20; echo FAIL; exit 1; }; echo OK'

## Invariant 覆盖（铁律逐条映射）

- [x] [BEHAVIOR] [L2] INV-1 [重派同族] runner_failure 有界重派同角色 ≤2 次、超限进人审：由 B-01（首次重派）+ B-03（第 3 次 exhausted）联合守卫
  动作: 见 B-01 与 B-03
  预期观察: 首次 retry / 超限 exhausted 两态并存，重派额度不突破 2 次
  等待预算: 0s
  留证: B-01 + B-03 vitest 输出
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}"; O=$(npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "publish 重派动作" 2>&1); P=$(npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "超限守恒" 2>&1); printf '%s\n' "$O" "$P"; echo "$O" | grep -qE "[1-9][0-9]* passed" && echo "$P" | grep -qE "[1-9][0-9]* passed" || { echo FAIL; exit 1; }; echo OK'

- INV-2 [基础设施重试身份] 基础设施重派复用同角色相位/动作、不变更执行身份：由 B-01 守卫（publisher 重派返回 publisher 既有 action=publish:approved_ref，相位=publish，非 spawn:* 换身份）
- INV-3 [冻结在途] run 在途 Commander 不合任何 PR：N/A — 属 Commander 合并纪律，非 derive 单测可执行断言；本 sprint 不触碰 merge fence 逻辑
- INV-4 [封印强制登记] 合同 Test Contract 表必须登记全部冻结测试：N/A（可执行断言）— 由 contract-draft.md 的 `## Test Contract` 表结构满足，封印闸 assertTestContractResolvable 批准时校验
