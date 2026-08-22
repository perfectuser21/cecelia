contract_branch: cp-harness-propose-r2-bae539c8-r8b580072-a12
sprint_dir: sprints/08230711-kernel-bae539c8

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: runner_failure 有界重派计数按角色窗口化（跨角色不误耗额度）[r52]

**范围**: `packages/brain/src/orchestrator/derive.js` 中 `priorRunnerFailures` 统计逻辑，加同角色过滤条件 `&& callbackDetail(r).role === role`。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 本 sprint 冻结守卫存在且真 import real derive.js，断言跨角色窗口化
  Test: node -e "const c=require('fs').readFileSync('sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js','utf8');if(!c.includes(\"from '../../../packages/brain/src/orchestrator/derive.js'\")||!c.includes('仍走 publish 重派'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] derive.js priorRunnerFailures filter 含同角色过滤条件
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/callbackDetail\(r\)\.role === role/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令，vitest 冻结守卫；带 -t 过滤统一用 grep -qE "[1-9][0-9]* passed" 宽松式）

- [ ] [BEHAVIOR] [L2] B-01: 跨角色不误耗：evaluator 已 2 次 runner_failure 后 publisher 首次 runner_failure 仍走 publish 重派
  动作: 构造 decisionLog（evaluator 2 次 runner_failure + spawn 行 + publisher 首次 runner_failure），调 real derive()
  预期观察: derive 返回 phase=publish, action=publish:approved_ref, reason=callback_runner_failure_retry（publisher 同角色历史=0 < 2，不被 evaluator 拖累进人审）
  等待预算: 0s
  留证: vitest 输出末行（含 passed 计数）进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js -t "仍走 publish 重派" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-02: 同角色有界语义不变：evaluator 同角色第 3 次 runner_failure 仍进人审 exhausted
  动作: 构造 decisionLog（evaluator 同角色 3 次 runner_failure），调 real derive()
  预期观察: derive 返回 phase=review, action=wait:human_review, reason=callback_runner_failure_exhausted（同角色有界语义不变）
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js -t "仍进人审 exhausted" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-03: 同角色计数只数自己：publisher 前有 1 次 evaluator + 1 次 publisher 失败，publisher 本次仍重派
  动作: 构造 decisionLog（evaluator 1 次 + publisher 1 次 runner_failure），publisher 本次第 2 次失败，调 real derive()
  预期观察: derive 返回 phase=publish, action=publish:approved_ref, reason=callback_runner_failure_retry（publisher 同角色历史=1 < 2，evaluator 那次不计入）
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js -t "同角色计数只数自己" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-04: 回归守恒：evaluator runner_failure 首次仍重派 evaluator（既有角色行为不回退）
  动作: 跑 repo 既有 publisher 守卫的回归守恒 it()，调 real derive()
  预期观察: evaluator 首次 runner_failure 仍返回 phase=evaluate, action=spawn:evaluator, reason=callback_runner_failure_retry（既有角色行为零回退）
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run tests/gp/f1/step3-publisher-runner-failure-retry.test.js -t "回归守恒" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-05: 同一 run 第 3 次 runner_failure → 进人审（有界，不无限重试）
  动作: 跑 repo 既有守卫的有界重派 it()，调 real derive()
  预期观察: 同角色第 3 次 runner_failure 返回 phase=review, action=wait:human_review, reason=callback_runner_failure_exhausted（有界不无限重试）
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run tests/gp/f1/step3-runner-failure-retry.test.js -t "同一 run 第 3 次 runner_failure" 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L2] B-06: 负向：product 类失败（无 failure_class）照旧判终态，不被本次放宽
  动作: 跑 repo 既有守卫的负向守恒 it()，调 real derive()
  预期观察: product 类失败（无 failure_class）返回 phase=failed, action=mark_failed, reason=callback_failed（负向守恒不被有界重派放宽）
  等待预算: 0s
  留证: vitest 输出末行进 behavior_tests.log_tail
  Test: manual:bash -c 'npx vitest run tests/gp/f1/step3-runner-failure-retry.test.js -t "照旧判终态，不被本次放宽" 2>&1 | grep -qE "[1-9][0-9]* passed"'

## Invariant 覆盖（铁律逐条映射）

- INV-1 [有界重派] 同角色 ≤2 次超限进人审，不轮换账号不无限重试 → 覆盖于 B-02 + B-05
- INV-2 [基础设施重试身份] generator_infrastructure_retry_identity（重派保持角色身份一致）→ 覆盖于 B-04（evaluator 首次仍重派 evaluator）+ B-01/B-03（publisher 重派 publish 动作，角色身份一致）
- INV-3 [负向守恒] product（无 failure_class）与 cancelled 照旧判终态 → 覆盖于 B-06
- INV-4 [租户隔离] N/A — 本 sprint 为纯 derive 计数逻辑，不触及记忆/资源/授权凭据，与租户隔离无关。
