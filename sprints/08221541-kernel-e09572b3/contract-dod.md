---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: diagnostic 类人审批准后 derive 消费并重试原动作

**范围**: 仅 `packages/brain/src/orchestrator/derive.js` + `ground-truth.js` 两纯函数 + 一份冻结测试
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结测试文件存在
  Test: node -e "require('fs').accessSync('sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js')"
  期望: exit 0

- [ ] [ARTIFACT] derive.js 导出共享消费判据 diagnosticApprovalConsumedCallbackHops
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/export (function|const) diagnosticApprovalConsumedCallbackHops/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] ground-truth.js 复用判据并装配 open_human_review
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!c.includes('openHumanReviewFromLog')||!c.includes('open_human_review'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，内嵌单行 manual:bash -c 命令，evaluator 原样执行）

- [ ] [BEHAVIOR] [L2] B-01: diagnostic 批准被消费后 derive 越过 review 门回主链重试原动作
  动作: 构造「blocked evaluator callback(hop10) → 人审请求(hop11) → 同 hop diagnostic APPROVED(hop12)」决策日志，调 derive(observed)
  预期观察: derive 返回 phase=evaluate、action=spawn:evaluator（phase≠review、action≠wait:human_review），死等根除
  等待预算: 0s
  留证: vitest -t B-01 verbose 输出（含 ✓...B-01 行）
  Test: manual:bash -c 'npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-01" --reporter=verbose 2>&1 | grep -qaE "✓.*B-01"'

- [ ] [BEHAVIOR] [L2] B-02: 无对应 diagnostic APPROVED verdict 时 derive 仍 wait:human_review（负向①）
  动作: 构造「callback(hop10) + 人审请求(hop11)、无批准」决策日志，调 derive(observed)
  预期观察: derive 返回 phase=review、action=wait:human_review、reason=callback_semantic_refusal
  等待预算: 0s
  留证: vitest -t B-02 verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-02" --reporter=verbose 2>&1 | grep -qaE "✓.*B-02"'

- [ ] [BEHAVIOR] [L2] B-03: 批准 pr_head_sha 与请求快照不符不消费，仍 wait:human_review（负向② stale）
  动作: 构造「diagnostic APPROVED.pr_head_sha ≠ review request 快照 head_sha」决策日志，调 derive(observed)
  预期观察: derive 返回 phase=review、action=wait:human_review（stale 批准不放行）
  等待预算: 0s
  留证: vitest -t B-03 verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-03" --reporter=verbose 2>&1 | grep -qaE "✓.*B-03"'

- [ ] [BEHAVIOR] [L2] B-04: merge_gate 类批准语义不变，仍 reviewApproved→merge_pr（回归护栏）
  动作: 构造「reviewRequired+reviewApproved+双 PASS verdict」observed，调 derive(observed)
  预期观察: derive 返回 phase=merge、action=merge_pr、reason=all_gates_passed（diagnostic 消费未污染 merge_gate）
  等待预算: 0s
  留证: vitest -t B-04 verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-04" --reporter=verbose 2>&1 | grep -qaE "✓.*B-04"'

- [ ] [BEHAVIOR] [L2] B-05: diagnosticApprovalConsumedCallbackHops 仅对 diagnostic 有效批准收割触发 callback hop
  动作: 对 diagnostic 有效批准 / merge_gate 类 / hop 不匹配 / SHA 不符四种日志分别调 diagnosticApprovalConsumedCallbackHops
  预期观察: 仅 diagnostic 有效批准返回含 hop=10；其余三种均不含 hop=10
  等待预算: 0s
  留证: vitest -t B-05 verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-05" --reporter=verbose 2>&1 | grep -qaE "✓.*B-05"'

- [ ] [BEHAVIOR] [L2] B-06: ground-truth openHumanReviewFromLog 消费后置 false、未消费/stale 仍 true
  动作: 对「有效批准消费 / 无批准 / stale SHA」三种日志分别调 openHumanReviewFromLog
  预期观察: 有效消费→false；无批准→true；stale→true
  等待预算: 0s
  留证: vitest -t B-06 verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/08221541-kernel-e09572b3/tests/step3-diagnostic-review-approval-consumed.test.js -t "B-06" --reporter=verbose 2>&1 | grep -qaE "✓.*B-06"'

## 历史约束三源映射（Step 1.3 — 铁律 / 累积FR / 回归测试）

铁律（PRD Invariant 段）逐条映射：
- INV-1【merge_gate 不变】→ B-04 覆盖（merge_gate 批准仍 merge_pr，diagnostic 分支不改 merge 语义）
- INV-2【批准不可见即死等禁止】→ B-01 覆盖（批准经 decisionLog 被 derive 消费，无需手工 append）
- INV-3【SHA 锚定 stale 不放行】→ B-03 + B-05(SHA 不符分支) 覆盖
- INV-K3【不确定原因默认归人审】→ N/A：本 sprint 不触及 needs_context/unknown 归人审路径，不改其判据
- INV-K4【no-progress 后禁重派 generator-fix】→ N/A：本 sprint 不改 no-progress / generator-fix 路径

累积 FR: （本 line 暂无历史；context-manifest unavailable）
回归测试约束: 见 contract-draft.md `## 已知约束` 段（runner-failure 触发条件不变、verdictForAuthority SHA/identity 锚定、mergeApproval merge_gate 消费语义、reviewClassForReason 分类）
