---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: commander lease 过期自动重派（有界），根除每轮 route_unknown 人审 [r73]

**范围**: 仅改 `packages/brain/src/orchestrator/derive.js` 的 `attemptCallbackRoute` infrastructure_blocked 分支——commander 角色纳入有界自动重派（累计 < 5 次重派 `spawn:commander` / reason=callback_infrastructure_blocked；达上限第 6 次回落 wait:human_review + callbackHop 锚）。只依赖 orchestrator_decision_log 行时序计数，不引入新状态存储。不动 account_exhausted / runner_failure / semantic_refusal 既有分支，不改 lease 时长 / 收割器 / diagnostic 人审消费。冻结测试双落 `sprints/<sprint_dir>/tests/` 与 `tests/gp/f1/`（真 import derive.js，禁 mock 被改的边）。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js 落地 commander infrastructure 有界重派（含 spawn:commander 重派 + 上限常量 5）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/orchestrator/derive.js','utf8');if(!(c.includes('spawn:commander')||/SPAWN_COMMANDER/.test(c))||!/\b5\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] sprint 冻结合同测试文件存在且真 import 被改文件
  Test: node -e "const c=require('fs').readFileSync('/workspace/sprints/08251720-kernel-r73-commander-retry/tests/commander-infra-retry-r73.test.ts','utf8');if(!c.includes('derive.js')||!c.includes('spawn:commander'))process.exit(1)"

- [ ] [ARTIFACT] F1 gp/f1 冻结测试文件存在且真 import 被改文件
  Test: node -e "const c=require('fs').readFileSync('/workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js','utf8');if(!c.includes('derive.js')||!c.includes('expired_attempt_reconciled'))process.exit(1)"

## Invariant 覆盖（铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 纯函数可重放：derive 只读 decisionLog 行时序统计 commander 失败数，未引入新状态存储
  动作: 从仓库根真跑 F1 seal 冻结测试（真 import derive.js，传真实 decisionLog 数组，无 DB/无外部状态）
  预期观察: 7 条全过；测试文件无任何 stub/mock derive 内部（禁 mock 被改边）
  等待预算: 0s
  留证: vitest 输出末 5 行（含 7 passed）+ grep 反证无 vi.mock
  Test: manual:bash -c 'grep -q "vi.mock\|sinon\|stub(" /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js && { echo FAIL:禁mock被改边被违反; exit 1; }; npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js 2>&1 | grep -qE "7 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] INV-2 fail-closed：上限触顶（第 6 次）必回落人审，禁无限重派
  动作: 传 5 次历史 commander 过期 infra + 当前第 6 次的 decisionLog 给 derive
  预期观察: derive 返回 wait:human_review / callback_infrastructure_route_unknown / callbackHop=111
  等待预算: 0s
  留证: vitest -t 'fail-closed' 输出（1 passed）
  Test: manual:bash -c 'npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js -t "fail-closed" 2>&1 | grep -qE "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] INV-3 凭据隔离 N/A：纯函数 kernel 改动无授权凭据触点（不读写他人账号资源）
  动作: 静态确认 derive.js 改动段无凭据/账号资源写入调用
  预期观察: 本 sprint 不触及凭据边界，铁律以 N/A 显式登记
  等待预算: 0s
  留证: 命令输出 OK
  Test: manual:bash -c 'echo "OK: INV-3 凭据隔离 N/A — 纯函数无凭据触点"'

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: 单次 commander 过期 infra → 重派 commander 续主链（RED→GREEN 核心）
  动作: 从仓库根真跑 F1 seal 测试，传单条 spawn:commander→expired_attempt_reconciled(commander,infrastructure_blocked) 重放链给 derive
  预期观察: derive 返回 action='spawn:commander' / reason='callback_infrastructure_blocked'，不再 wait:human_review（改前此条 FAIL=route_unknown，改后 PASS）
  等待预算: 0s
  留证: vitest -t '续主链' 输出末 5 行（含 1 passed）
  Test: manual:bash -c 'npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js -t "续主链" 2>&1 | grep -qE "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-02: 未达上限（累计第 5 次失败）→ 仍有界重派 commander
  动作: 传 4 次历史过期 infra + 当前第 5 次（prior=4<5）的 decisionLog 给 derive
  预期观察: derive 返回 action='spawn:commander' / reason='callback_infrastructure_blocked'（改前 FAIL，改后 PASS）
  等待预算: 0s
  留证: vitest -t '未达上限' 输出（1 passed）
  Test: manual:bash -c 'npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js -t "未达上限" 2>&1 | grep -qE "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-03: 达上限（累计第 6 次失败）→ wait:human_review + callbackHop 锚（fail-closed）
  动作: 传 5 次历史过期 infra + 当前第 6 次（prior=5≥5，末尾 hop=111）的 decisionLog 给 derive
  预期观察: derive 返回 action='wait:human_review' / reason='callback_infrastructure_route_unknown' / callbackHop=111
  等待预算: 0s
  留证: vitest -t '达上限' 输出（1 passed）
  Test: manual:bash -c 'npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js -t "达上限" 2>&1 | grep -qE "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-04: 负向 planner 过期 infra 重试路由不变（spawn:planner，零回归）
  动作: 传 planner spawn + planner 过期 infra 重放链给 derive
  预期观察: derive 返回 phase='planning' / action='spawn:planner' / reason='callback_infrastructure_blocked'（既有语义不变）
  等待预算: 0s
  留证: vitest -t 'spawn:planner' 输出（1 passed）
  Test: manual:bash -c 'npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js -t "spawn:planner" 2>&1 | grep -qE "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-05: 负向 commander semantic_refusal 仍走 callback_semantic_refusal（不动既有分支）
  动作: 传 commander spawn + commander failed/semantic_refusal 回调给 derive
  预期观察: derive 返回 action='wait:human_review' / reason='callback_semantic_refusal'（不被本次放宽）
  等待预算: 0s
  留证: vitest -t 'callback_semantic_refusal' 输出（1 passed）
  Test: manual:bash -c 'npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js -t "callback_semantic_refusal" 2>&1 | grep -qE "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-06: 负向 commander account_exhausted 仍走 route_unknown（防共享 map 污染）
  动作: 传 commander spawn + commander failed/account_exhausted 回调给 derive
  预期观察: derive 返回 action='wait:human_review' / reason='callback_account_exhausted_route_unknown' / callbackHop=101（若实现把 commander 塞进共享 INFRA_RETRY_ACTION_BY_ROLE 会误翻转，此条必挂）
  等待预算: 0s
  留证: vitest -t 'callback_account_exhausted_route_unknown' 输出（1 passed）
  Test: manual:bash -c 'npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js -t "callback_account_exhausted_route_unknown" 2>&1 | grep -qE "1 passed" || exit 1'

- [ ] [BEHAVIOR] [L2] B-07: 负向 commander runner_failure（首次）仍走 route_unknown（防共享 map 污染）
  动作: 传 commander spawn + commander failed/runner_failure 回调给 derive
  预期观察: derive 返回 action='wait:human_review' / reason='callback_runner_failure_route_unknown' / callbackHop=101（共享 map 污染会让首次误翻转重派，此条必挂）
  等待预算: 0s
  留证: vitest -t 'callback_runner_failure_route_unknown' 输出（1 passed）
  Test: manual:bash -c 'npx vitest run /workspace/tests/gp/f1/step3-commander-infra-retry-r73.test.js -t "callback_runner_failure_route_unknown" 2>&1 | grep -qE "1 passed" || exit 1'
