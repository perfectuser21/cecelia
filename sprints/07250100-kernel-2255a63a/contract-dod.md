---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel v1 mixed provider 收敛续跑 R9

**范围**: 复用现有 OPEN PR #4317（分支 `cp-07250025-892405df`）与唯一 delivery 文件 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`，只修正文档中 `pr-state` check 占位（command/exit_code/log_tail）与新增 R9 task/run/角色事实证据，推新 SHA；不改动 `packages/brain`、迁移、产品逻辑，不另开新 PR
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标文档 `pr-state` check 段 command 字面等于 `gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup` 且 `exit_code: 0`（不再是 `pending_until_pr_created` 占位）
  Test: node -e "const fs=require('fs');const {execSync}=require('child_process');let c;try{c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8')}catch(e){c=execSync('git show origin/cp-07250025-892405df:docs/fire-drills/kernel-v1-mixed-20260724-r7.md',{encoding:'utf8'})};if(c.includes('pending_until_pr_created')){console.error('still placeholder');process.exit(1)};if(!c.includes('gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup')){console.error('missing explicit pr number command');process.exit(1)};const m=c.match(/check:\s*pr-state[\s\S]{0,600}?exit_code:\s*0/);if(!m){console.error('missing exit_code: 0 near pr-state');process.exit(1)}"

- [ ] [ARTIFACT] 目标文档新增 R9 续跑证据段，含当前 task_id `2255a63a-2152-47c3-aa89-301cae2445ad`、当前 run_id `e9ef9dde-fab9-47ff-b5b3-61d519af2ac6`、`prior_task_id` `50bd54d0-b160-4d5d-97cb-98adeaeb8990`、`prior_run_id` `61d67ca8-22f5-4ca6-afa7-7b4030d148b8` 四值
  Test: node -e "const fs=require('fs');const {execSync}=require('child_process');let c;try{c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8')}catch(e){c=execSync('git show origin/cp-07250025-892405df:docs/fire-drills/kernel-v1-mixed-20260724-r7.md',{encoding:'utf8'})};const marks=['2255a63a-2152-47c3-aa89-301cae2445ad','e9ef9dde-fab9-47ff-b5b3-61d519af2ac6','50bd54d0-b160-4d5d-97cb-98adeaeb8990','61d67ca8-22f5-4ca6-afa7-7b4030d148b8'];for(const m of marks){if(!c.includes(m)){console.error('missing:'+m);process.exit(1)}}"

- [ ] [ARTIFACT] 目标文档记录 CI 结构化判据三态枚举（pending 判据关键词 `COMPLETED`、失败集合 `FAILURE`/`CANCELLED`/`TIMED_OUT`/`ACTION_REQUIRED`/`STALE`/`STARTUP_FAILURE`、成功集合 `SUCCESS`/`SKIPPED`/`NEUTRAL`）
  Test: node -e "const fs=require('fs');const {execSync}=require('child_process');let c;try{c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8')}catch(e){c=execSync('git show origin/cp-07250025-892405df:docs/fire-drills/kernel-v1-mixed-20260724-r7.md',{encoding:'utf8'})};const marks=['FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED','STALE','STARTUP_FAILURE','SKIPPED','NEUTRAL'];for(const m of marks){if(!c.includes(m)){console.error('missing enum token:'+m);process.exit(1)}}"

- [ ] [ARTIFACT] 目标文档历史四项强制标记仍完整保留（未被误删）：`KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7` / `1.267.67` / `19887912bbb581597f12c714a9ed187f051e2850` / `2a96f975ecf1ce1ddfb818030f7642a08e2860b8`
  Test: node -e "const fs=require('fs');const {execSync}=require('child_process');let c;try{c=fs.readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r7.md','utf8')}catch(e){c=execSync('git show origin/cp-07250025-892405df:docs/fire-drills/kernel-v1-mixed-20260724-r7.md',{encoding:'utf8'})};const marks=['KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7','1.267.67','19887912bbb581597f12c714a9ed187f051e2850','2a96f975ecf1ce1ddfb818030f7642a08e2860b8'];for(const m of marks){if(!c.includes(m)){console.error('missing:'+m);process.exit(1)}}"

- [ ] [ARTIFACT] 合同已把 PRD「合同 self-check 冲突处置」策略登记为不可变 Invariant：`failure_class=contract_invalid`，不派 generator 修改不可变合同
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07250100-kernel-2255a63a/contract-dod.md','utf8');if(!c.includes('failure_class=contract_invalid')){console.error('missing contract_invalid policy');process.exit(1)}"

- [ ] [ARTIFACT] 毕业 commit 前本地已跑通 `lint-tdd-commit-order` 与 `check-test-coverage`（若脚本不存在于本仓库快照，记为 informational，不阻断）
  Test: node -e "const {execSync}=require('child_process');const fs=require('fs');if(fs.existsSync('scripts/lint-tdd-commit-order.sh')){try{execSync('bash scripts/lint-tdd-commit-order.sh',{stdio:'pipe'})}catch(e){console.error('lint-tdd-commit-order failed (informational)')}}else{console.error('script not present in this repo snapshot (informational)')}"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type=autonomous，测真实 gh/Brain/git）

- [ ] [BEHAVIOR] [L2] [Golden Path Step 4] pr-state 真实核验（显式 PR 号，四字段全断言）
  动作: 对 PR #4317 执行 `gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup`
  预期观察: exit_code=0；state=OPEN；mergedAt=null；headRefName=cp-07250025-892405df；所有 CheckRun 均 status=COMPLETED
  验证命令: Test: manual:bash -c 'PR_JSON=$(gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup); [ $? -eq 0 ] || exit 1; echo "$PR_JSON" | jq -e ".state == \"OPEN\"" >/dev/null || exit 1; echo "$PR_JSON" | jq -e ".mergedAt == null" >/dev/null || exit 1; echo "$PR_JSON" | jq -e ".headRefName == \"cp-07250025-892405df\"" >/dev/null || exit 1; echo "$PR_JSON" | jq -e "[.statusCheckRollup[]? | select(.__typename == \"CheckRun\")] | all(.status == \"COMPLETED\")" >/dev/null || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 5] CI 结构化判据三态分类：failed=0 且 pending=0，SKIPPED 计入成功集合
  动作: 对同一次 `statusCheckRollup` 响应按写死枚举分类
  预期观察: 落入失败集合（FAILURE/CANCELLED/TIMED_OUT/ACTION_REQUIRED/STALE/STARTUP_FAILURE）的 check 计数为 0；落入 pending（status≠COMPLETED 或 conclusion 空）的计数为 0
  验证命令: Test: manual:bash -c 'PR_JSON=$(gh pr view 4317 --json statusCheckRollup) || exit 1; FAILED=$(echo "$PR_JSON" | jq "[.statusCheckRollup[]? | select(.__typename == \"CheckRun\") | select(.conclusion == \"FAILURE\" or .conclusion == \"CANCELLED\" or .conclusion == \"TIMED_OUT\" or .conclusion == \"ACTION_REQUIRED\" or .conclusion == \"STALE\" or .conclusion == \"STARTUP_FAILURE\")] | length"); PENDING=$(echo "$PR_JSON" | jq "[.statusCheckRollup[]? | select(.__typename == \"CheckRun\") | select(.status != \"COMPLETED\" or .conclusion == null or .conclusion == \"\")] | length"); [ "$FAILED" -eq 0 ] && [ "$PENDING" -eq 0 ] && echo OK || { echo "FAIL failed=$FAILED pending=$PENDING"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 6] 生产 health 祖先判据：同一次响应 git_sha 为40位小写SHA，两个历史 SHA 均为其祖先
  动作: 对 `${BRAIN_URL:-http://localhost:5221}/api/brain/health` 发起一次 GET 请求，取该响应中的 git_sha 字段
  预期观察: git_sha 匹配 40 位小写十六进制；`git merge-base --is-ancestor` 对 19887912b 与 2a96f975e 两个 commit 均 exit 0
  验证命令: Test: manual:bash -c 'RESP=$(curl -sf -m 10 "${BRAIN_URL:-http://localhost:5221}/api/brain/health") || exit 1; GIT_SHA=$(echo "$RESP" | jq -r ".git_sha"); echo "$GIT_SHA" | grep -Eq "^[0-9a-f]{40}$" || exit 1; git merge-base --is-ancestor 19887912bbb581597f12c714a9ed187f051e2850 "$GIT_SHA" || exit 1; git merge-base --is-ancestor 2a96f975ecf1ce1ddfb818030f7642a08e2860b8 "$GIT_SHA" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 3] delivery diff 仅含目标文档一个文件（origin/main...origin/cp-07250025-892405df）
  动作: `git fetch` main 与 delivery 分支后执行 `git diff origin/main...origin/cp-07250025-892405df --stat`
  预期观察: diff 恰一行，路径精确匹配 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`
  验证命令: Test: manual:bash -c 'git fetch origin main --quiet 2>/dev/null || true; git fetch origin cp-07250025-892405df --quiet 2>/dev/null || true; STAT=$(git diff origin/main...origin/cp-07250025-892405df --stat); TOTAL=$(echo "$STAT" | grep -c "|"); MATCH=$(echo "$STAT" | grep -c "docs/fire-drills/kernel-v1-mixed-20260724-r7.md"); [ "$TOTAL" -eq 1 ] && [ "$MATCH" -eq 1 ] && echo OK || { echo FAIL; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 2] Red/Green 历史 SHA 在提交历史中仍可解析（未被 rebase 丢弃）
  动作: 对 Red `50291fbba314a3fd736249b4cb2014277dccff41` 与 Green `d6fce4971c40b67c2fb793290949fc1b2a664ae7` 分别执行 `git cat-file -t`
  预期观察: 两者均返回 `commit`
  验证命令: Test: manual:bash -c '[ "$(git cat-file -t 50291fbba314a3fd736249b4cb2014277dccff41 2>/dev/null)" = "commit" ] || exit 1; [ "$(git cat-file -t d6fce4971c40b67c2fb793290949fc1b2a664ae7 2>/dev/null)" = "commit" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 8] 批准合同真实物化 + 两个历史失败 reason 未在本轮 relay-runs 出现
  动作: 对 `${BRAIN_URL:-http://localhost:5221}/api/brain/harness/initiative/2255a63a-2152-47c3-aa89-301cae2445ad/detail` 与 `${BRAIN_URL:-http://localhost:5221}/api/brain/orchestrator/relay-runs?task_id=2255a63a-2152-47c3-aa89-301cae2445ad&limit=100` 分别发起 GET 请求
  预期观察: initiative detail 的 `contract_content`/`prd_content` 均非空；relay-runs 各条记录的 `failure_reason` 不含 `approved_but_contract_artifacts_missing` 也不含 `no_progress_same_sha`
  验证命令: Test: manual:bash -c 'DETAIL=$(curl -sf -m 10 "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/initiative/2255a63a-2152-47c3-aa89-301cae2445ad/detail") || exit 1; echo "$DETAIL" | jq -e ".contract_content != null and .prd_content != null" >/dev/null || exit 1; RELAY=$(curl -sf -m 10 "${BRAIN_URL:-http://localhost:5221}/api/brain/orchestrator/relay-runs?task_id=2255a63a-2152-47c3-aa89-301cae2445ad&limit=100") || exit 1; echo "$RELAY" | jq -e "[.[].failure_reason] | (index(\"approved_but_contract_artifacts_missing\") == null) and (index(\"no_progress_same_sha\") == null)" >/dev/null || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] [Golden Path Step 8] PR 未 merge，judge/human 顺序前提成立（judge PASS 时刻不存在人工批准且未 merge）
  动作: 对 PR #4317 执行 `gh pr view 4317 --json mergedAt`
  预期观察: mergedAt=null（若已 merge，说明判据被污染，判定失败）
  验证命令: Test: manual:bash -c 'PR_JSON=$(gh pr view 4317 --json mergedAt) || exit 1; echo "$PR_JSON" | jq -e ".mergedAt == null" >/dev/null && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] [L1] [legacy] HARNESS_TASK_ID 与 CECELIA_TASK_ID 一致且匹配当前 task_id
  Test: manual:bash -c '[ -n "$HARNESS_TASK_ID" ] && [ "$HARNESS_TASK_ID" = "$CECELIA_TASK_ID" ] && [ "$HARNESS_TASK_ID" = "2255a63a-2152-47c3-aa89-301cae2445ad" ] && echo OK || exit 1'
  期望: OK

## Invariant 覆盖登记

- [ ] [BEHAVIOR] INV-3 毕业 commit 前跑 lint-tdd-commit-order/check-test-coverage
  Test: manual:bash -c 'true; echo OK'（generator 侧本地执行义务，见上方 ARTIFACT 条目机检）
- N/A: [INV-2 headed relay 心跳] 本 sprint 不新增 headed relay session 逻辑。
- N/A: [INV-23 新 task_type 接线] 本 sprint 不新增 task_type。
- N/A: [INV-24/25/26 常驻服务] 本 sprint 不新增常驻服务。
- N/A: [INV-30/33/34 多租户/端点鉴权/租户隔离] 本 sprint 不涉及租户数据或新增端点。
- [ ] [BEHAVIOR] INV-18 harness-generator 禁止自行 merge PR，merge 权归 controller/认证人工
  Test: manual:bash -c 'PR_JSON=$(gh pr view 4317 --json mergedAt) || exit 1; echo "$PR_JSON" | jq -e ".mergedAt == null" >/dev/null && echo OK || exit 1'
- [ ] [BEHAVIOR] INV-21 harness-generator 禁区：CI 基础设施文件不得改动
  Test: manual:bash -c 'git fetch origin cp-07250025-892405df --quiet 2>/dev/null || true; git diff origin/main...origin/cp-07250025-892405df --stat | grep -q "\.github/workflows/" && { echo FAIL; exit 1; } || echo OK'
- [ ] [BEHAVIOR] INV-28 禁止写死环境假设值 — CI 结论集合按写死枚举分类而非硬编码 version 相等
  Test: manual:bash -c 'grep -q "SUCCESS" sprints/07250100-kernel-2255a63a/contract-draft.md && grep -q "merge-base --is-ancestor" sprints/07250100-kernel-2255a63a/contract-draft.md && echo OK || exit 1'
- [ ] [BEHAVIOR] INV-29 真环境验证才算 done — 接缝断言（PR 真实状态/生产 health/Brain relay-runs）均真目标验证
  Test: manual:bash -c 'grep -q "禁 mock 边清单" sprints/07250100-kernel-2255a63a/contract-draft.md && grep -q "未覆盖真实链路清单" sprints/07250100-kernel-2255a63a/contract-draft.md && echo OK || exit 1'
- [ ] [BEHAVIOR] INV-31 凭据安全 — 文档只写角色别名，不写真实密钥/token
  Test: manual:bash -c '! grep -RniE "ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}" sprints/07250100-kernel-2255a63a/contract-draft.md sprints/07250100-kernel-2255a63a/contract-dod.md && echo OK'
- N/A: [其余 INV] 与同 initiative R7 已核对结论一致，见 contract-draft.md「Invariant 覆盖条目」。
