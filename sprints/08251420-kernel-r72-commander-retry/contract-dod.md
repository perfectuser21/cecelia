---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: commander lease 过期有界重派根除 route_unknown 人审 [r72]

**范围**: 仅改 `packages/brain/src/orchestrator/derive.js`：把 role='commander' 的 infrastructure 类失败
（`effect:expired_attempt_reconciled`/`verdict:attempt_callback` + `failure_class=infrastructure_blocked`）
纳入 `attemptCallbackRoute` 的重试路由 —— 新增有界计数 helper `commanderInfrastructureFailureCount` +
常量 `COMMANDER_INFRA_RETRY_CAP=5`，低于上限降级续跑（返回非阻塞让主链在当前 phase 前进），达上限
fail-closed 回落 `wait:human_review(callback_infrastructure_route_unknown)` 带 callbackHop 锚。不改 lease
时长/reconciler、不动回执传输层、不改 diagnostic 人审批准消费逻辑（#5058 已闭环）、不发 spawn:commander
（dispatcher 需 coordinator context）。冻结测试落 `sprints/<sprint_dir>/tests/` 与 `tests/gp/f1/`（真 import
被改文件，禁 mock 被改的边）。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js 落地 commander infrastructure 有界重试路由（含计数 helper + 上限常量 5 + commander 分支）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/orchestrator/derive.js','utf8');if(!/commanderInfrastructureFailureCount/.test(c)||!/COMMANDER_INFRA_RETRY_CAP\s*=\s*5/.test(c)||!/role === 'commander'/.test(c))process.exit(1)"

- [ ] [ARTIFACT] sprint 冻结合同测试文件存在且真 import 被改文件
  Test: node -e "const c=require('fs').readFileSync('/workspace/sprints/08251420-kernel-r72-commander-retry/tests/commander-infra-retry-bounded.test.ts','utf8');if(!c.includes('orchestrator/derive.js')||!c.includes('import { derive }'))process.exit(1)"

- [ ] [ARTIFACT] F1 gp/f1 冻结测试文件存在且真 import 被改文件
  Test: node -e "const c=require('fs').readFileSync('/workspace/tests/gp/f1/step3-commander-infra-retry-bounded.test.js','utf8');if(!c.includes('orchestrator/derive.js')||!c.includes('import { derive }'))process.exit(1)"

- [ ] [ARTIFACT] #5058 消费锚回归测试迁移为达上限（交替 spawn/expired ×5）形状，保留 route_unknown 批准消费覆盖
  Test: node -e "const c=require('fs').readFileSync('/workspace/tests/gp/f1/step3-route-unknown-review-approve-consume.test.js','utf8');const n=(c.match(/expiredCommanderReconciled\(/g)||[]).length;if(n<5)process.exit(1)"

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: commander infra 单次过期 → 主链续跑不挂人审（根因修复）
  动作: 从仓库根真跑 tests/gp/f1/step3-commander-infra-retry-bounded.test.js 的「commander infra 单次过期」用例（真 import derive.js，传 r70 复刻链 spawn:commander→1×expired_attempt_reconciled(commander,infrastructure_blocked)）
  预期观察: derive 返回 action ≠ wait:human_review 且 reason ≠ callback_infrastructure_route_unknown（现状 RED → 修后 PASS）
  等待预算: 0s
  留证: vitest -t 过滤输出末 5 行（含 1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js -t "commander infra 单次过期" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: 过期对主链透明 → action 等于无回调基线（监理非承重墙）
  动作: 真跑「过期对主链透明」用例（对比 derive(含 commander 过期) 与 derive(同快照去掉 commander 回调) 的 action）
  预期观察: 两者 action 相等且等于本快照主链 spawn:judge（commander 收割对主链完全透明）
  等待预算: 0s
  留证: vitest -t 过滤输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js -t "过期对主链透明" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: 累计达上限5 → fail-closed 回落人审带 hop 锚
  动作: 真跑「累计达上限5」用例（decisionLog 含 5 条 commander infrastructure 收割行）
  预期观察: derive 返回 action=wait:human_review、reason=callback_infrastructure_route_unknown、callbackHop=115（最新收割行 hop）
  等待预算: 0s
  留证: vitest -t 过滤输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js -t "累计达上限5" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: 角色隔离 → planner infra 过期语义不变（重派 spawn:planner）
  动作: 真跑「角色隔离」用例（同链但 role=planner）
  预期观察: derive 返回 {phase:'planning', action:'spawn:planner', reason:'callback_infrastructure_blocked'}（逐字不变）
  等待预算: 0s
  留证: vitest -t 过滤输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js -t "角色隔离" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: 失败类隔离 → commander account_exhausted 语义不变（仍 route_unknown）
  动作: 真跑「失败类隔离」用例（commander + account_exhausted 回调）
  预期观察: derive 返回 action=wait:human_review、reason=callback_account_exhausted_route_unknown（本 sprint 不碰 infrastructure 以外分支）
  等待预算: 0s
  留证: vitest -t 过滤输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js -t "失败类隔离" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-06: 纯函数可重放 → 同输入同输出（禁引入新状态存储 · Invariant）
  动作: 真跑「纯函数可重放」用例（同一构造输入调用 derive 两次比对）
  预期观察: 两次返回对象深度相等（只依赖 decision_log 行时序，无外部状态）
  等待预算: 0s
  留证: vitest -t 过滤输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js -t "纯函数可重放" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-07: 既有 brain derive 单测不回归（generator/planner 隔离未破）
  动作: 子 shell 切进 packages/brain 用包内 vitest 配置真跑 src/orchestrator/__tests__/derive.test.js
  预期观察: 既有 derive 单测（含 generator infrastructure 重派 / runner failure 有界重派 / planner 等）全过，退出码 0，无回归
  等待预算: 0s
  留证: vitest 输出末 5 行（含 Tests N passed）
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/derive.test.js --reporter=dot'

## 历史约束（铁律 → INV 覆盖）

- [ ] [BEHAVIOR] INV-1 fail-closed：达上限（5）必回落 wait:human_review，禁无限重派 —— 由 B-03 守
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js -t "累计达上限5" --no-cache --reporter=dot'
- [ ] [BEHAVIOR] INV-2 纯函数：只依赖 decision_log 行时序，禁引入新状态存储 —— 由 B-06 守
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-commander-infra-retry-bounded.test.js -t "纯函数可重放" --no-cache --reporter=dot'
- [ ] [BEHAVIOR] INV-3 消费锚：route_unknown 请求行带触发 callback hop 锚（#5058 消费闭环在新语义下保留）—— 由 B-03 的 callbackHop 断言 + #5058 迁移回归守
  Test: manual:bash -c 'cd /workspace && npx vitest run tests/gp/f1/step3-route-unknown-review-approve-consume.test.js --no-cache --reporter=dot'
- [ ] [BEHAVIOR] INV-4 角色隔离：非 commander 角色重试语义不被本 sprint 改动 —— 由 B-04 + B-07 守
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/derive.test.js --reporter=dot'
