---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: publisher runner_failure 走 INFRA_RETRY_ACTION_BY_ROLE 有界重派

**范围**: `packages/brain/src/orchestrator/derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE` 补 `publisher` 键（phase=publish, action=PUBLISH_APPROVED_REF）；冻结守卫覆盖 publisher runner_failure → 有界重派 / 超限进人审 / 不越权他族三条边。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js 的 INFRA_RETRY_ACTION_BY_ROLE（Object.freeze 块内）已登记 publisher → PUBLISH_APPROVED_REF
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');const m=c.match(/INFRA_RETRY_ACTION_BY_ROLE\s*=\s*Object\.freeze\(\{[\s\S]*?\}\)/);if(!m||!/publisher\s*:\s*\{[^}]*PUBLISH_APPROVED_REF/.test(m[0]))process.exit(1)"

- [ ] [ARTIFACT] 冻结守卫测试存在且断言 publisher 有界重派（真 derive，不 stub）
  Test: node -e "const c=require('fs').readFileSync('sprints/08220927-kernel-5b3f73e5/tests/publisher-runner-failure-retry.test.js','utf8');if(!c.includes('callback_runner_failure_retry')||!c.includes(\"role: 'publisher'\")||/vi\.mock|stub/.test(c))process.exit(1)"

## BEHAVIOR 条目（真 derive，产物闸，L2 服务端真验）

- [ ] [BEHAVIOR] [L2] B-01: publisher runner_failure（首次，prior<2）→ 同角色有界重派 publish:approved_ref
  动作: 构造 observed.decisionLog 含一条 role=publisher/status=failed/failure_class=runner_failure 的 attempt callback（此前 runner_failure 计数=0），调用真 derive
  预期观察: derive 返回 { phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }，reason 不含 route_unknown、action 不是 wait:human_review
  等待预算: 0s
  留证: /tmp/pub_b01.log（vitest 该用例 passed 行）
  Test: manual:bash -c 'node ./node_modules/.bin/vitest run sprints/08220927-kernel-5b3f73e5/tests/publisher-runner-failure-retry.test.js -t publish:approved_ref >/tmp/pub_b01.log 2>&1; grep -Eq "[1-9][0-9]* passed" /tmp/pub_b01.log || { echo FAIL_NO_PASS; exit 1; }; grep -Eq "[1-9][0-9]* failed" /tmp/pub_b01.log && { echo FAIL_HAS_FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: publisher runner_failure 超限（prior>=2）→ 进人审 exhausted，不再重派
  动作: 构造 decisionLog 含 3 次 publisher runner_failure（中间穿插 spawn:publisher），调用真 derive
  预期观察: derive 返回 { phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }（有界，不无限重试）
  等待预算: 0s
  留证: /tmp/pub_b02.log（vitest 该用例 passed 行）
  Test: manual:bash -c 'node ./node_modules/.bin/vitest run sprints/08220927-kernel-5b3f73e5/tests/publisher-runner-failure-retry.test.js -t exhausted >/tmp/pub_b02.log 2>&1; grep -Eq "[1-9][0-9]* passed" /tmp/pub_b02.log || { echo FAIL_NO_PASS; exit 1; }; grep -Eq "[1-9][0-9]* failed" /tmp/pub_b02.log && { echo FAIL_HAS_FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 负向 — publisher product 类失败（无 failure_class）照旧判终态 mark_failed，不被本次放宽误命中
  动作: 构造 decisionLog 含一条 role=publisher/status=failed（无 failure_class）的 callback，调用真 derive
  预期观察: derive 返回 { phase:'failed', action:'mark_failed', reason:'callback_failed' }
  等待预算: 0s
  留证: /tmp/pub_b03.log（vitest 该用例 passed 行）
  Test: manual:bash -c 'node ./node_modules/.bin/vitest run sprints/08220927-kernel-5b3f73e5/tests/publisher-runner-failure-retry.test.js -t mark_failed >/tmp/pub_b03.log 2>&1; grep -Eq "[1-9][0-9]* passed" /tmp/pub_b03.log || { echo FAIL_NO_PASS; exit 1; }; grep -Eq "[1-9][0-9]* failed" /tmp/pub_b03.log && { echo FAIL_HAS_FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 回归 — evaluator 的 runner_failure（首次）仍重派 evaluator，publisher 补丁不越权他族
  动作: 构造 decisionLog 含一条 role=evaluator/status=failed/failure_class=runner_failure 的 callback，调用真 derive
  预期观察: derive 返回 { phase:'evaluate', action:'spawn:evaluator', reason:'callback_runner_failure_retry' }（他族路由不受本单影响）
  等待预算: 0s
  留证: /tmp/pub_b04.log（vitest 该用例 passed 行）
  Test: manual:bash -c 'node ./node_modules/.bin/vitest run sprints/08220927-kernel-5b3f73e5/tests/publisher-runner-failure-retry.test.js -t 不越权他族 >/tmp/pub_b04.log 2>&1; grep -Eq "[1-9][0-9]* passed" /tmp/pub_b04.log || { echo FAIL_NO_PASS; exit 1; }; grep -Eq "[1-9][0-9]* failed" /tmp/pub_b04.log && { echo FAIL_HAS_FAIL; exit 1; }; echo OK'

## Invariant 覆盖映射（铁律三源 — 决策批次 109dd8eb）

- INV-1 [有界重派 ≤2 次，超限进人审] → 由 B-01（首次重派）+ B-02（超限 exhausted）联合覆盖，非 N/A。
- INV-2 [不轮换账号（账号轮换是 account_exhausted 语义）] → publisher 条目 action=PUBLISH_APPROVED_REF（原动作重派），非账号轮换动作；由 ARTIFACT 源码闸 + B-01 断言 action 值覆盖。
- INV-3 [基础设施抖动不落通用 mark_failed 烧产物] → B-01/B-02 断言 phase 分别为 publish/review（非 failed），B-03 反向确认只有 product 失败才 mark_failed；三条联合覆盖。

## 累积 FR

（本 line e6f803f2 golden-paths 空集，无历史累积 FR，无回退项）
