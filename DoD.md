contract_branch: cp-harness-propose-r1-37bf8673-r6de78554-a30
sprint_dir: sprints/08220937-kernel-37bf8673

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: publisher 进 INFRA_RETRY_ACTION_BY_ROLE，runner_failure 有界重派

**范围**: `packages/brain/src/orchestrator/derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 增加 `publisher` 条目 + 冻结回归测试
**大小**: S

## 历史约束（铁律映射）

- INV-1 N/A：PRD Invariant 段为空（本 line 暂无挂载到本 step/feature 的 invariant 决策）；本 sprint 仅补路由表条目，不改计数口径与其它角色行为。
- INV-2（回归保护）：priorRunnerFailures 计数口径不变 + evaluator/judge/generator 既有重派/终态行为不回退 — 由 B-04/B-05 覆盖。

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js 的 INFRA_RETRY_ACTION_BY_ROLE 含 publisher 路由条目
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/publisher:\s*\{\s*phase:\s*'publish',\s*action:\s*ACTION\.PUBLISH_APPROVED_REF\s*\}/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: publisher 首次 runner_failure → 重派 publish，返回 callback_runner_failure_retry
  动作: 构造 decisionLog 末条为 publisher runner_failure 回调（priorRunnerFailures=0），真调 derive()
  预期观察: derive 返回 {phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry'}，phase 不为 failed，reason 不为 callback_runner_failure_route_unknown
  等待预算: 0s
  留证: vitest 用例 exit code + 命令输出末 5 行
  Test: manual:bash -c 'npx vitest run sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js -t "重派 publish" --no-cache --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-02: publisher 同 run 第 3 次 runner_failure → 人审兜底 callback_runner_failure_exhausted（有界不变）
  动作: 构造 decisionLog 含 2 次更早 publisher runner_failure（priorRunnerFailures>=2），真调 derive()
  预期观察: derive 返回 {phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted'}
  等待预算: 0s
  留证: vitest 用例 exit code + 命令输出末 5 行
  Test: manual:bash -c 'npx vitest run sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js -t "人审兜底 callback_runner_failure_exhausted" --no-cache --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-03: 负向 — publisher product 类失败（无 failure_class）照旧判终态，不被本次放宽
  动作: 构造 publisher status=failed 但无 failure_class 的回调，真调 derive()
  预期观察: derive 返回 {phase:'failed', action:'mark_failed', reason:'callback_failed'}
  等待预算: 0s
  留证: vitest 用例 exit code + 命令输出末 5 行
  Test: manual:bash -c 'npx vitest run sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js -t "publisher product 类失败" --no-cache --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-04: 回归不退 — evaluator runner_failure（首次）仍重派 evaluator，既有行为不回退
  动作: 构造 evaluator runner_failure 首次回调，真调 derive()
  预期观察: derive 返回 {phase:'evaluate', action:'spawn:evaluator', reason:'callback_runner_failure_retry'}
  等待预算: 0s
  留证: vitest 用例 exit code + 命令输出末 5 行
  Test: manual:bash -c 'npx vitest run sprints/08220937-kernel-37bf8673/tests/publisher-runner-failure-retry.test.js -t "evaluator runner_failure（首次）仍重派 evaluator" --no-cache --reporter=basic'

- [ ] [BEHAVIOR] [L2] B-05: 回归保护 — repo 既有 step3 runner_failure 回归全绿（evaluator/generator/超限/两负向不退）
  动作: 从仓库根跑既有回归测试文件 tests/gp/f1/step3-runner-failure-retry.test.js（真 derive）
  预期观察: 5 用例全绿，既有 runner_failure 有界重派与终态语义无回退
  等待预算: 0s
  留证: vitest 汇总（5 passed）+ exit code
  Test: manual:bash -c 'npx vitest run tests/gp/f1/step3-runner-failure-retry.test.js --no-cache --reporter=basic'
