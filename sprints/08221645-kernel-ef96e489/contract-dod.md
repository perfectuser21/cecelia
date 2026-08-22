---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: diagnostic 类人审批准后 derive 消费该批准并重试原动作

**范围**: `packages/brain/src/orchestrator/derive.js`（`latestUnconsumedAttemptResult` 消费集合纳入 diagnostic 人审批准，回主链重试）+ `packages/brain/src/orchestrator/loop.js`（`loadRunDeadlineState` NOT EXISTS 与 derive 消费谓词对齐，DB 观测层，brain-integration CI 真 PG 覆盖）。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结测试文件存在且含 B-01..B-04 + INV 断言
  Test: node -e "const c=require('fs').readFileSync('sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js','utf8');if(!(c.includes('B-01')&&c.includes('B-02')&&c.includes('B-03')&&c.includes('B-04')&&c.includes('import { derive }')))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] derive.js latestUnconsumedAttemptResult 纳入 diagnostic 人审批准消费（review_class 判定 + SHA 锚定）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');const f=c.slice(c.indexOf('function latestUnconsumedAttemptResult'),c.indexOf('function latestUnconsumedAttemptResult')+2000);if(!(f.includes('VERDICT_HUMAN_REVIEW')&&f.includes('review_class')&&f.includes('review_request_hop')&&f.includes('pr_head_sha')))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（真 derive 纯函数，manual:bash 内嵌可执行命令；因 postgres=false 全部走 vitest，不打 DB/Brain）

- [ ] [BEHAVIOR] [L2] B-01: diagnostic 人审 APPROVED（hop 匹配 + SHA 相符）→ derive 消费触发 callback，回主链重试原动作，不再 wait:human_review
  动作: 构造 3 连 runner_failure（exhausted）后的 diagnostic 请求 + APPROVED（review_class=diagnostic, SHA 相符）decisionLog，调真 derive(observed)
  预期观察: derive 返回 action=spawn:evaluator（回主链重派原动作），action !== wait:human_review 且 phase !== review
  等待预算: 0s
  留证: vitest 命令输出末 5 行（B-01 PASS）
  Test: manual:bash -c 'O=$(npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-01 " 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -q " failed"'

- [ ] [BEHAVIOR] [L2] B-02: 无对应 diagnostic APPROVED verdict（仅 open review request）→ 触发 callback 未消费，derive 仍 wait:human_review
  动作: 构造仅含 exhausted 日志 + effect:human_review_requested（无 verdict:human_review）的 decisionLog，调真 derive
  预期观察: derive 返回 phase=review, action=wait:human_review, reason=callback_runner_failure_exhausted（保守不放行）
  等待预算: 0s
  留证: vitest 命令输出末 5 行（B-02 PASS）
  Test: manual:bash -c 'O=$(npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-02 " 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -q " failed"'

- [ ] [BEHAVIOR] [L2] B-03: diagnostic APPROVED 但 pr_head_sha 与请求快照 head_sha 不符 → 视为未消费，derive 仍 wait:human_review
  动作: 构造 APPROVED（review_class=diagnostic，但 pr_head_sha=SHA2 ≠ 请求 SHA1）decisionLog，调真 derive
  预期观察: derive 返回 phase=review, action=wait:human_review, reason=callback_runner_failure_exhausted（SHA 漂移的旧批准不放行）
  等待预算: 0s
  留证: vitest 命令输出末 5 行（B-03 PASS）
  Test: manual:bash -c 'O=$(npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-03 " 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -q " failed"'

- [ ] [BEHAVIOR] [L2] INV-[merge_gate 语义不变] B-04: merge_gate 类批准（review_class=merge_gate）不得被 diagnostic 消费路径吞掉 → 触发 callback 仍未消费，derive 仍 wait:human_review
  动作: 构造 APPROVED（review_class=merge_gate, SHA 相符）decisionLog（其余同 B-01），调真 derive
  预期观察: derive 返回 phase=review, action=wait:human_review, reason=callback_runner_failure_exhausted（merge_gate 类不被 diagnostic 路径消费，语义不变）
  等待预算: 0s
  留证: vitest 命令输出末 5 行（B-04 PASS）
  Test: manual:bash -c 'O=$(npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "B-04 " 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -q " failed"'

- [ ] [BEHAVIOR] [L2] INV-[merge_gate 语义不变] merge_gate 正路零回归：双 PASS + review_required + reviewApproved → merge_pr
  动作: 构造 evaluate/judge 双 PASS（contract_identity 相符）+ reviewApproved=true 的 observed，调真 derive
  预期观察: derive 返回 phase=merge, action=merge_pr, reason=all_gates_passed（merge_gate 放行路径逐字节不变）
  等待预算: 0s
  留证: vitest 命令输出末 5 行（INV PASS）
  Test: manual:bash -c 'O=$(npx vitest run sprints/08221645-kernel-ef96e489/tests/diagnostic-human-review-consume.test.js -t "INV " 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -q " failed"'

## Invariant 覆盖（铁律逐条映射 — 引用上方可执行 BEHAVIOR 或显式 N/A）

- INV-1 [merge_gate 语义不变]：由上方 B-04 + INV merge_pr 两条可执行守卫覆盖（diagnostic 路径按 review_class 隔离 + merge 放行正路恒绿）
- INV-2 [负向不放行]：由上方 B-02（无批准仍等）+ B-03（SHA 不符仍等）两条可执行守卫覆盖，无对应 APPROVED 或 SHA 不符禁止误判已消费
- INV-3 [冻结纪律]：N/A —— run 在途 Commander 不合任何 PR 属流程纪律，非本 sprint 交付物上的可执行断言；本 sprint 仅产出合同+测试+实现，不触碰其它 open PR
- INV-4 [planner_role_branch]：N/A —— 本 sprint 不触及 planner checkout/switch 逻辑
- INV-5 [kernel_pr_validation_clock]：N/A —— 本 sprint 不触及既有 PR 的 evaluator validation clock
- INV-6 [generator_retry_identity]：N/A —— 本 sprint 不触及 generator 基础设施重试身份
- INV-7 [fleet_brain_url_authority]：N/A —— 本 sprint 不触及 Fleet Generator 的 Brain URL 权威
