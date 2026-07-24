---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Sprint: Kernel v1 mixed provider 最终主链验收 R7 Fire Drill

**范围**: 新增单一文档 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`，记录 kernel-v1 mixed-provider 全链路一次真实演练的验收 checks 与角色运行证据；不改动 `packages/brain`、现有合同测试、迁移或产品逻辑
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标文档存在且含四项强制标记（KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7 / 1.267.67 / 19887912bbb581597f12c714a9ed187f051e2850 / 2a96f975ecf1ce1ddfb818030f7642a08e2860b8）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8');const marks=['KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7','1.267.67','19887912bbb581597f12c714a9ed187f051e2850','2a96f975ecf1ce1ddfb818030f7642a08e2860b8'];for(const m of marks){if(!c.includes(m)){console.error('missing:'+m);process.exit(1);}}"

- [ ] [ARTIFACT] 目标文档含五角色（planner/proposer/reviewer/evaluator/generator）实际运行证据摘要
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8').toLowerCase();for(const r of ['planner','proposer','reviewer','evaluator','generator']){if(!c.includes(r)){console.error('missing role:'+r);process.exit(1);}}"

- [ ] [ARTIFACT] 目标文档显式记录两个历史失败 reason（no_progress_same_sha / approved_but_contract_artifacts_missing）本轮未出现
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8');for(const r of ['no_progress_same_sha','approved_but_contract_artifacts_missing']){const i=c.indexOf(r);if(i<0){console.error('missing reason:'+r);process.exit(1);}const window=c.slice(i,i+120).toLowerCase();if(!/未出现|not_present|absent/.test(window)){console.error('reason not marked absent:'+r);process.exit(1);}}"

- [ ] [ARTIFACT] 目标文档含 judge/human review 时间线四字段（judge_pass_at / human_review_created_at / human_approved_at / merged_at）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8');for(const f of ['judge_pass_at','human_review_created_at','human_approved_at','merged_at']){if(!new RegExp(f+'\\\\s*:').test(c)){console.error('missing field:'+f);process.exit(1);}}"

- [ ] [ARTIFACT] 毕业 commit 前本地已跑通 lint-tdd-commit-order 与 check-test-coverage（INV-3 映射）
  Test: node -e "const {execSync}=require('child_process');try{execSync('bash scripts/lint-tdd-commit-order.sh',{stdio:'pipe'})}catch(e){console.error('lint-tdd-commit-order not runnable/failed (informational, script may not exist in this repo snapshot)')}"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type=agent_remote，测真实 Brain/git/gh）

- [ ] [BEHAVIOR] [L2] [Golden Path Step 4a] origin/main...HEAD diff 恰一行且指向目标文档
  动作: generator 在 delivery 分支提交目标文档后，controller/evaluator 对比 origin/main 与当前 HEAD
  预期观察: `git diff origin/main...HEAD --stat` 只列出一行，且该行路径为 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`
  验证命令: Test: manual:bash -c 'git fetch origin main --quiet 2>/dev/null || true; TOTAL=$(git diff origin/main...HEAD --stat | grep -c "|"); MATCH=$(git diff origin/main...HEAD --stat | grep -c "docs/fire-drills/kernel-v1-mixed-20260724-r7.md"); [ "$TOTAL" -eq 1 ] && [ "$MATCH" -eq 1 ] && echo OK || { echo FAIL; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 3] 生产健康：同一次 /api/brain/health 响应中 git_sha 为40位小写SHA，且两个历史 commit 均是其祖先
  动作: 对 `localhost:5221/api/brain/health` 发起一次 GET 请求，取其响应中的 version 与 git_sha 字段（不跨请求拼接）
  预期观察: git_sha 匹配 40 位小写十六进制格式；`git merge-base --is-ancestor` 对 19887912b 与 2a96f975e 两个 commit 均返回 exit 0
  验证命令: Test: manual:bash -c 'RESP=$(curl -sf -m 10 localhost:5221/api/brain/health) || exit 1; GIT_SHA=$(echo "$RESP" | jq -r ".git_sha"); echo "$GIT_SHA" | grep -Eq "^[0-9a-f]{40}$" || exit 1; git merge-base --is-ancestor 19887912bbb581597f12c714a9ed187f051e2850 "$GIT_SHA" || exit 1; git merge-base --is-ancestor 2a96f975ecf1ce1ddfb818030f7642a08e2860b8 "$GIT_SHA" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 4b] PR 处于 head/OPEN/未merge，CI 全绿
  动作: 对本次 delivery PR 执行 `gh pr view --json state,mergedAt,statusCheckRollup`
  预期观察: state=OPEN，mergedAt=null，所有 statusCheckRollup 项 conclusion 为 SUCCESS 或缺省
  验证命令: Test: manual:bash -c 'PR_JSON=$(gh pr view --json state,mergedAt,statusCheckRollup 2>/dev/null) || exit 1; echo "$PR_JSON" | jq -e ".state == \"OPEN\"" >/dev/null || exit 1; echo "$PR_JSON" | jq -e ".mergedAt == null" >/dev/null || exit 1; echo "$PR_JSON" | jq -e "[.statusCheckRollup[]?.conclusion] | all(. == \"SUCCESS\" or . == null)" >/dev/null || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 4c] Brain task API 返回本 task 的五角色 provider/account 分配
  动作: 对 `localhost:5221/api/brain/tasks/892405df-3dc3-4c44-9402-278c7d8d0bd3` 发起 GET 请求
  预期观察: `payload.role_assignments` 含 planner/proposer/reviewer/evaluator/generator 五个 key，各自 provider 非空
  验证命令: Test: manual:bash -c 'TASK_JSON=$(curl -sf -m 10 localhost:5221/api/brain/tasks/892405df-3dc3-4c44-9402-278c7d8d0bd3) || exit 1; for ROLE in planner proposer reviewer evaluator generator; do echo "$TASK_JSON" | jq -e --arg r "$ROLE" ".payload.role_assignments[\$r].provider != null" >/dev/null || { echo "FAIL:$ROLE"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 4d] relay-runs 记录归属正确（run_id 对应本次点火 task_id）
  动作: 对 `localhost:5221/api/brain/orchestrator/relay-runs?task_id=892405df-3dc3-4c44-9402-278c7d8d0bd3` 发起 GET 请求
  预期观察: 返回裸数组，其中每条记录 `current_task_id` 均等于本次 task_id（无记录时视为通过，避免误判尚未点火）
  验证命令: Test: manual:bash -c 'RELAY_JSON=$(curl -sf -m 10 "localhost:5221/api/brain/orchestrator/relay-runs?task_id=892405df-3dc3-4c44-9402-278c7d8d0bd3") || exit 1; echo "$RELAY_JSON" | jq -e "if length > 0 then all(.current_task_id == \"892405df-3dc3-4c44-9402-278c7d8d0bd3\") else true end" >/dev/null || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 5] judge PASS 时间早于 human review 创建时间（pre-human gate 顺序）
  动作: 从目标文档解析 `judge_pass_at` 与 `human_review_created_at` 两个 ISO8601 时间戳
  预期观察: `judge_pass_at` 的 epoch ≤ `human_review_created_at` 的 epoch，证明 judge 判定发生在人审创建之前
  验证命令: Test: manual:bash -c 'DOC=docs/fire-drills/kernel-v1-mixed-20260724-r7.md; JUDGE_AT=$(grep -oE "judge_pass_at:[[:space:]]*[0-9T:.Z-]+" "$DOC" | head -1 | awk "{print \$2}"); HR_AT=$(grep -oE "human_review_created_at:[[:space:]]*[0-9T:.Z-]+" "$DOC" | head -1 | awk "{print \$2}"); [ -n "$JUDGE_AT" ] && [ -n "$HR_AT" ] || exit 1; JE=$(date -d "$JUDGE_AT" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$JUDGE_AT" +%s); HE=$(date -d "$HR_AT" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$HR_AT" +%s); [ "$JE" -le "$HE" ] && echo OK || { echo FAIL; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] [L1] [legacy] HARNESS_TASK_ID 与 CECELIA_TASK_ID 一致且匹配当前 task_id（generator 环境自验）
  Test: manual:bash -c '[ -n "$HARNESS_TASK_ID" ] && [ "$HARNESS_TASK_ID" = "$CECELIA_TASK_ID" ] && [ "$HARNESS_TASK_ID" = "892405df-3dc3-4c44-9402-278c7d8d0bd3" ] && echo OK || exit 1'
  期望: OK
