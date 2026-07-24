TEST RUN: npx vitest run sprints/07250100-kernel-2255a63a/tests/ --reporter=verbose

FAIL: 目标文档 pr-state check 段已替换为显式 PR 号命令且 exit_code 不再是占位符
  reason: current docs/fire-drills/kernel-v1-mixed-20260724-r7.md (on origin/cp-07250025-892405df)
  still has command "gh pr view --json state,mergedAt,statusCheckRollup,headRefName" (no explicit PR
  number) and exit_code: pending_until_pr_created placeholder.

FAIL: 目标文档新增 R9 续跑证据段含当前与 prior 的 task_id/run_id 四值
  reason: delivery doc has no R9 evidence section yet (task_id 2255a63a-2152-47c3-aa89-301cae2445ad,
  run_id e9ef9dde-fab9-47ff-b5b3-61d519af2ac6, prior_task_id 50bd54d0-b160-4d5d-97cb-98adeaeb8990,
  prior_run_id 61d67ca8-22f5-4ca6-afa7-7b4030d148b8 all absent).

FAIL: 目标文档记录 CI 结构化判据的三态枚举集合
  reason: delivery doc does not yet enumerate the FAILURE/CANCELLED/TIMED_OUT/ACTION_REQUIRED/
  STALE/STARTUP_FAILURE failure set or the SKIPPED/NEUTRAL success-set additions required by R9 PRD.

FAIL: 批准合同真实物化且本轮 relay-runs 未命中两个历史失败 reason
  reason: GET /api/brain/harness/initiative/2255a63a-2152-47c3-aa89-301cae2445ad/detail currently
  returns contract_content=null / prd_content=null — this R9 contract has not yet been GAN-approved
  and materialized (expected: goes green once GAN converges and the approved contract is frozen).

PASS: 目标文档历史标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7 与两个祖先 SHA 仍完整保留
PASS: gh pr view 4317 真实返回 OPEN 未合并且分支与CI结论集合匹配
PASS: 生产 health 响应 git_sha 满足两个历史 SHA 祖先判据
PASS: Red 与 Green 两个历史 SHA 在提交历史中保留可查

Test Files  1 failed (1)
     Tests  4 failed | 4 passed (8)
RED_EXIT=1
