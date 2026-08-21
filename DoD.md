contract_branch: cp-harness-propose-r1-c8b57bef-r19759355-a4
sprint_dir: sprints/08220614-kernel-c8b57bef

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: publisher 进 INFRA_RETRY_ACTION_BY_ROLE（runner_failure 有界重派不再 route_unknown）

**范围**: `packages/brain/src/orchestrator/derive.js` 内 `INFRA_RETRY_ACTION_BY_ROLE` 新增一条 `publisher` 条目（唯一实现改动）。不改计数/阈值语义、不改 dispatcher、不改其他角色条目、不改 infra/account 分支判定本体。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 含 publisher 条目且 action=ACTION.PUBLISH_APPROVED_REF（Invariant「调度接线类回归用 source-code inspection」）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');const m=c.match(/const INFRA_RETRY_ACTION_BY_ROLE = Object.freeze\(\{[\s\S]*?\}\);/);if(!m||!/publisher:\s*\{\s*phase:\s*'publish',\s*action:\s*ACTION\.PUBLISH_APPROVED_REF\s*\}/.test(m[0]))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 冻结回归测试文件存在且真 derive（无 stub attemptCallbackRoute/infrastructureRetryForCallback）
  Test: node -e "const c=require('fs').readFileSync('sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js','utf8');if(!/from '..\/..\/..\/packages\/brain\/src\/orchestrator\/derive.js'/.test(c)||/vi\.mock|sinon|stub\(/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令，真 derive）

- [ ] [BEHAVIOR] [L2] B-01: publisher 首次 runner_failure → 返回 publish 重派动作，reason=callback_runner_failure_retry
  动作: 构造 decisionLog 含一条 publisher `status=failed`/`failure_class=runner_failure` 回调，调真 derive()
  预期观察: derive 返回 `{ phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }`，且 reason !== 'callback_runner_failure_route_unknown'
  等待预算: 0s
  留证: vitest 输出末 5 行（含 1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js -t "返回 publish 重派动作，reason=callback_runner_failure_retry" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-02: publisher 第 3 次 runner_failure → 进人审兜底，reason=callback_runner_failure_exhausted（计数语义不变）
  动作: 构造 decisionLog 含 2 条 publisher runner_failure 回调（穿插 spawn 行）+ 第 3 条 runner_failure 回调，调真 derive()
  预期观察: derive 返回 `{ phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }`（priorRunnerFailures>=2 命中，计数逻辑不动）
  等待预算: 0s
  留证: vitest 输出末 5 行（含 1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js -t "进人审兜底，reason=callback_runner_failure_exhausted" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-03: publisher 的 infrastructure_blocked → 返回 publish 重派动作，reason=callback_infrastructure_blocked（同族收益）
  动作: 构造 decisionLog 含一条 publisher `failure_class=infrastructure_blocked` 回调，调真 derive()
  预期观察: derive 返回 `{ phase:'publish', action:'publish:approved_ref', reason:'callback_infrastructure_blocked' }`，reason !== 'callback_infrastructure_route_unknown'
  等待预算: 0s
  留证: vitest 输出末 5 行（含 1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js -t "reason=callback_infrastructure_blocked" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-04: publisher 的 account_exhausted → 返回 publish 重派动作，reason=callback_account_exhausted（同族收益）
  动作: 构造 decisionLog 含一条 publisher `failure_class=account_exhausted` 回调，调真 derive()
  预期观察: derive 返回 `{ phase:'publish', action:'publish:approved_ref', reason:'callback_account_exhausted' }`，reason !== 'callback_account_exhausted_route_unknown'
  等待预算: 0s
  留证: vitest 输出末 5 行（含 1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js -t "reason=callback_account_exhausted" --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-05: 非 publisher 角色零漂移 — evaluator/judge runner_failure 路由逐字不变
  动作: 冻结测试的两条「回归」用例 + 既有 sibling `step3-runner-failure-retry.test.js` 全跑，调真 derive()
  预期观察: evaluator→spawn:evaluator、judge→spawn:judge（均 reason=callback_runner_failure_retry）；既有 sibling 5 条断言全绿，无一变红
  等待预算: 0s
  留证: 两文件 vitest 输出末 5 行（含 passed 计数）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js -t "零漂移" --no-cache && npx vitest run tests/gp/f1/step3-runner-failure-retry.test.js --no-cache'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-06: 负向 — publisher 的 product 类失败（无 failure_class）照旧判终态，不被本次放宽
  动作: 构造 decisionLog 含一条 publisher `status=failed`（无 failure_class）回调，调真 derive()
  预期观察: derive 返回 `{ phase:'failed', action:'mark_failed', reason:'callback_failed' }`（补表不误放宽 product 类失败）
  等待预算: 0s
  留证: vitest 输出末 5 行（含 1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08220614-kernel-c8b57bef/tests/step3-publisher-infra-retry-route.test.js -t "照旧判终态" --no-cache'
  期望: exit 0

## Invariant 覆盖条目（铁律逐条映射 — Step 1.3）

- INV-1 [基础设施重派身份] 已由 ARTIFACT 源码巡检覆盖：publisher 条目 action=ACTION.PUBLISH_APPROVED_REF（派 role=publisher，同角色重派不轮换账号）；本单不改重派身份逻辑
- INV-2 [回归用源码巡检] 已在 B-05 + ARTIFACT 以真 derive + source-inspection 双验（本单即调度接线类回归）
- INV-3 [真环境验证] N/A：本单为 kernel 纯 derive 决策，真环境=真 derive 函数（非真机/生产 env），已由 vitest 真 derive 覆盖，无写死环境假设值
- INV-4 [测试多租户/租户隔离/鉴权/凭据/日志脱敏] N/A：本单不触及租户/端点/凭据/日志路径，纯内存决策函数
