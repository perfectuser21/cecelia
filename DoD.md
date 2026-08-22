contract_branch: cp-harness-propose-r1-dd912609-r9be53aff-a10
sprint_dir: sprints/08221753-kernel-dd912609

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: diagnostic 类人审批准后 derive 消费该批准并重试原动作 [r49]

**范围**: `packages/brain/src/orchestrator/` 内 `derive.js`（diagnostic 批准消费 + 回主链重试原动作）、`ground-truth.js`（diagnostic APPROVED verdict 观测 → open_human_review=false + 触发 callback hop 入消费集合）、必要时 `loop.js`（open_human_review 计算纳入 diagnostic 消费）；冻结回归测试。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 冻结回归测试文件存在且覆盖正向消费 + 双负向 + merge_gate 不变量
  Test: node -e "const c=require('fs').readFileSync('sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js','utf8');if(!c.includes('消费该批准并重试原动作')||!c.includes('merge_gate 类批准不触发 diagnostic 消费'))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] derive.js 含 diagnostic 人审批准消费路由（非 merge_gate 批准的消费/重试实现）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!/diagnostic|review_class/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous — 纯函数 vitest 重放）

- [x] [BEHAVIOR] [L2] B-01: diagnostic 人审批准后 derive 消费该批准并重试原动作（本轮 RED 驱动）
  动作: 构造 decisionLog（evaluator runner_failure ×3 exhausted → diagnostic human_review_requested(callback_hop=9) → verdict:human_review approved/review_class=diagnostic/pr_head_sha 匹配），调 derive(observed)
  预期观察: derive 返回 action 非 wait:human_review 且 phase=evaluate（回主链重试原 evaluator 动作），脱离人审死等
  等待预算: 0s
  留证: vitest 命令输出末 5 行（含 1 passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js -t "消费该批准并重试原动作" --reporter=basic'

- [x] [BEHAVIOR] [L2] B-02: 无批准 diagnostic review 仍 wait:human_review（负向 A，不误放行）
  动作: 构造 decisionLog（exhausted diagnostic human_review_requested 但无 verdict:human_review 批准行），调 derive(observed)
  预期观察: derive 返回 action=wait:human_review、reason=callback_runner_failure_exhausted
  等待预算: 0s
  留证: vitest 命令输出末 5 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js -t "无批准 diagnostic review 无对应 APPROVED verdict" --reporter=basic'

- [x] [BEHAVIOR] [L2] B-03: stale 批准 pr_head_sha 与请求不符仍 wait:human_review（负向 B，陈旧批准不消费）
  动作: 构造 decisionLog（diagnostic 批准但 detail.pr_head_sha 与请求 head_sha 不符），调 derive(observed)
  预期观察: derive 返回 action=wait:human_review（陈旧批准不消费）
  等待预算: 0s
  留证: vitest 命令输出末 5 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js -t "stale 批准 pr_head_sha 与请求不符" --reporter=basic'

- [x] [BEHAVIOR] [L2] B-04: INV merge_gate 语义不变——merge_gate 类批准不触发 diagnostic 消费
  动作: 构造 decisionLog（同正向但 verdict:human_review 的 review_class=merge_gate），调 derive(observed)
  预期观察: derive 返回 action=wait:human_review（merge_gate 批准由 mergeGate 路径处理，diagnostic 消费分支不命中）
  等待预算: 0s
  留证: vitest 命令输出末 5 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js -t "merge_gate 类批准不触发 diagnostic 消费" --reporter=basic'

- [x] [BEHAVIOR] [L2] INV-1: 语义守恒——repo 既有 derive 全套零回归（merge_gate/evidence_repair/rejected/runner_failure 有界重派均不受影响）
  动作: 从 packages/brain 包根子 shell 跑既有 derive.test.js 全套
  预期观察: 既有 derive 套件全绿，无因本次改动新增失败
  等待预算: 0s
  留证: vitest 命令输出末 5 行（含 Test Files passed）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain" && npx vitest run --no-cache ./src/orchestrator/__tests__/derive.test.js --reporter=basic'

- [x] [BEHAVIOR] [L2] INV-2: 观测层零回归——ground-truth 投影既有用例全绿（diagnostic 消费观测新增不破坏 reviewApproved/mergeGate 观测）
  动作: 从 packages/brain 包根子 shell 跑既有 ground-truth.test.js 全套
  预期观察: 既有 ground-truth 套件全绿
  等待预算: 0s
  留证: vitest 命令输出末 5 行
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain" && npx vitest run --no-cache ./src/orchestrator/__tests__/ground-truth.test.js --reporter=basic'
