# Kernel v1 Mixed Provider Fire Drill R7

KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7

## Scope

- 历史上线版本：`1.267.67`
- #4294 merge commit：`19887912bbb581597f12c714a9ed187f051e2850`
- 远端批准 SHA 读取热修 merge commit：`2a96f975ecf1ce1ddfb818030f7642a08e2860b8`
- 本次 delivery 分支：`cp-07250025-892405df`
- 本次 relay run：`a4c8305a-758b-4cb7-839f-c04561b7b4c0`

## Provider / Account Evidence

- planner：provider=`claude`，account=`account1`；`/api/brain/tasks/892405df-3dc3-4c44-9402-278c7d8d0bd3` 返回 `payload.role_assignments.planner={provider:"claude",account:"account1"}`。
- proposer：provider=`claude`，account=`account1`；同一 task API 返回 `payload.role_assignments.proposer={provider:"claude",account:"account1"}`。
- reviewer：provider=`grok`，account=`grok`；同一 task API 返回独立 reviewer 分配 `payload.role_assignments.reviewer={provider:"grok",account:"grok"}`。
- evaluator：provider=`claude`，account=`account1`；同一 task API 返回 `payload.role_assignments.evaluator={provider:"claude",account:"account1"}`。
- generator：provider=`codex`，account=`team3`；同一 task API 返回 `payload.role_assignments.generator={provider:"codex",account:"team3"}`。

## Health Oracle

- 单次 `GET /api/brain/health` 响应记录：`version=1.267.71`，`git_sha=2a96f975ecf1ce1ddfb818030f7642a08e2860b8`。
- 判据采用 SHA 谱系而非硬编码版本相等：`19887912bbb581597f12c714a9ed187f051e2850` 与 `2a96f975ecf1ce1ddfb818030f7642a08e2860b8` 均是该 `git_sha` 的祖先。

## Historical Failure Reasons

- `no_progress_same_sha`：本轮在 relay-runs `failure_reason` 中未出现。
- `approved_but_contract_artifacts_missing`：本轮在 relay-runs `failure_reason` 中未出现，且 initiative detail 的 `contract_content` / `prd_content` 已真实物化。

## Timeline

judge_pass_at: 2026-07-24T16:26:30Z
human_review_created_at: 2026-07-24T16:26:31Z
human_approved_at: pending_after_authenticated_review
merged_at: pending_after_authenticated_review

## Checks

check: doc-marks
command: `node -e "const fs=require('fs');const c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8');['KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7','1.267.67','19887912bbb581597f12c714a9ed187f051e2850','2a96f975ecf1ce1ddfb818030f7642a08e2860b8'].forEach(m=>{if(!c.includes(m))process.exit(1)})"`
exit_code: 0
log_tail: `all required marks present in docs/fire-drills/kernel-v1-mixed-20260724-r7.md`

check: diff-one-line
command: `git fetch origin main --quiet 2>/dev/null || true; git diff origin/main...HEAD --stat`
exit_code: 0
log_tail: `1 file changed ... docs/fire-drills/kernel-v1-mixed-20260724-r7.md`

check: pr-state
command: `gh pr view --json state,mergedAt,statusCheckRollup,headRefName`
exit_code: pending_until_pr_created
log_tail: `generator will update this entry after PR creation and CI settles to OPEN/unmerged/all-success`

check: task-roles
command: `curl -sf http://host.docker.internal:5221/api/brain/tasks/892405df-3dc3-4c44-9402-278c7d8d0bd3 | jq '.payload.role_assignments'`
exit_code: 0
log_tail: `planner/proposer/evaluator=claude/account1, reviewer=grok/grok, generator=codex/team3`

check: relay-attribution
command: `curl -sf 'http://host.docker.internal:5221/api/brain/orchestrator/relay-runs?task_id=892405df-3dc3-4c44-9402-278c7d8d0bd3&limit=100' | jq '.'`
exit_code: 0
log_tail: `run a4c8305a-758b-4cb7-839f-c04561b7b4c0 current_task_id=892405df-3dc3-4c44-9402-278c7d8d0bd3 phase=planning failure_reason=null`

check: contract-materialized
command: `curl -sf http://host.docker.internal:5221/api/brain/harness/initiative/892405df-3dc3-4c44-9402-278c7d8d0bd3/detail | jq '{contract_content,prd_content}'`
exit_code: 0
log_tail: `contract_content and prd_content are non-null; approved_but_contract_artifacts_missing absent`
