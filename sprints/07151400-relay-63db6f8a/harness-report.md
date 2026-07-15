━━━ Sprint: Sprint PRD — headed relay 派发链路自测（claude-headed, task 63db6f8a）  PR #3975  2026-07-15 ━━━

PIPELINE  A+B+C phases · 1 eval rounds · - · $0(unsettled)

Phase          Time    Cost    Result
Proposer       -       -       ✅ (R2 修订)
Planner        -       -       ✅
Generator      -       -       ✅
Evaluator×1    -       -       ✅（PASS，追溯审计）
Judge          -       -       ✅（PASS，Brain judge API 追溯确认）
Reporter       -       -       ✅

DOD 8/8(BEHAVIOR) ✅  FAIL: 无

## 未覆盖真实链路清单（原样转呈，见 contract-draft.md）
- Brain 自动 headed spawn 落 initiative_runs（host=skill-relay-claude-headed）本次未覆盖。
  task 63db6f8a 自动派发本身未跑通（一直停 queued），转走前台点火补建档端点（host=foreground）。

## 流程异常
PR #3975 在 controller 派发 evaluator/judge 之前就被 should-auto-merge.sh 兜底机制自动合并，
违反硬约束2（judge 是 merge 唯一权威）。controller 已对已合并代码做追溯性 evaluator+judge 审计，
双 PASS（evaluator verdict 见 .harness/verdicts/evaluate-b714a1c.json，judge 经 Brain judge API 确认 PASS）。
已建 Notion Issue 3810480d-259b-49ff-ac4c-0c087c33fc36（P1，追查 should-auto-merge.sh 触发条件）。

## 其他已建 Issue
- Notion Issue 097886ee-6488-4b22-ba5c-124627d2876e（P2）：GAN reviewer 声明 judgments_written=2 但 decisions 表实查为 0（写库链路断裂）。
- Notion Issue 71c80d11-14f8-4216-a70c-8338210cc862（P3）：planner 阶段发现 harness worktree provisioning 缺 .dev-mode 标记（附带发现，非本次核心）。

## Brain API 侧发现（本次报告阶段新发现）
task-tasks.js 的 PATCH /:id 本可写 tasks.pr_url 列，但被 routes/tasks.js 同路径 PATCH（挂载顺序更早）遮蔽，实际不可达；
harness-finalize 的 pr_url 自动发现（DB 列/payload/分支名匹配 shortId）均未命中，task.status 完成回写被 pr_not_found 门禁拒绝，
result 字段已成功补写但 status 停留 in_progress。建议后续开 Issue 追查。

cost: 0（unsettled，无法获得真实 subagent 成本数据，按诚实边界填 0）

E2E 截图: （无截图）
Learning: （从本次 Sprint 提炼的洞察见 learning.md）
DB sync: journey_features · api_registry · Notion pushed（见 Phase B）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
