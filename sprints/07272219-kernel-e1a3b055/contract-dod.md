---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: PR4372 current-main recovery

**范围**: 既有 Draft PR #4372 的 current-main merge-base 证据、migration 366 统一口径、evaluator 容器 DB 预检、F1 当前主线等价基线、Draft/SHA 绑定闸门
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/migrations/366_pr4372_recovery_baseline.sql` 存在且文件名只使用 `366`
  Test: node -e "const fs=require('fs');const p='packages/brain/migrations/366_pr4372_recovery_baseline.sql';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!/366/.test(c))process.exit(1)"

- [ ] [ARTIFACT] evaluator 预检脚本存在且源码包含 `host.docker.internal`、`current_database()`、`inet_server_addr()`、`preview_`
  Test: node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/pr4372-db-preflight-smoke.sh';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');for(const s of ['host.docker.internal','current_database()','inet_server_addr()','preview_']){if(!c.includes(s))process.exit(1)}"

## Invariant 映射

- INV-1 N/A：本 sprint 不改 slot 调度器；单槽串行由既有调度链负责，验收仅验证 PR 收口与 DB/PR 接缝
- INV-2 N/A：真环境验证已由下列 GP3/GP4/GP5 行为条目覆盖
- INV-3 N/A：禁写死环境已由 GP3 行为条目覆盖（强制 `host.docker.internal` 且拒绝 `127.0.0.1`）
- INV-4 N/A：测试库隔离已由 GP3 行为条目覆盖（DB 名仅 `_test`/`preview_*`）

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] merge-base 精确锚定 `1dc9d4107cc14f9bc509c1ef285845f1dfb13838`
  动作: 拉取 `origin/main` 与 PR #4372 head，执行 `git merge-base`
  预期观察: merge-base 精确等于 `1dc9d4107cc14f9bc509c1ef285845f1dfb13838`，旧 contract sha `a5daa66a6` 不再被接受
  验证命令: Test: manual:bash -c 'git fetch origin main refs/pull/4372/head:refs/tmp/pr4372 >/dev/null 2>&1 && PR_HEAD=$(git rev-parse refs/tmp/pr4372) && MB=$(git merge-base 1dc9d4107cc14f9bc509c1ef285845f1dfb13838 "$PR_HEAD") && [ "$MB" = "1dc9d4107cc14f9bc509c1ef285845f1dfb13838" ] && ! rg -n "a5daa66a6" sprints/07272219-kernel-e1a3b055 packages/brain tests docs .github >/dev/null'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] migration 366 SQL 文件存在且 schema_version 只写 366
  动作: 在同一隔离 PostgreSQL 数据库中连续两次执行 migration 366
  预期观察: 两次执行都成功，且 `schema_version.version=''366''` 在最近 5 分钟内只落一行
  验证命令: Test: manual:bash -c ': "${DB_URL:?}"; psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f packages/brain/migrations/366_pr4372_recovery_baseline.sql >/dev/null && psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f packages/brain/migrations/366_pr4372_recovery_baseline.sql >/dev/null && C=$(psql "$DB_URL" -X -qAt -c "SELECT count(*) FROM schema_version WHERE version='\''366'\'' AND applied_at > NOW() - interval '\''5 minutes'\''") && [ "$C" = "1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] evaluator DB preflight 只允许 `host.docker.internal` 与 `_test|preview_*`
  动作: 在 evaluator 容器环境传入 `DB_URL` 后执行真实 `psql` 预检
  预期观察: `DB_URL` 含 `host.docker.internal` 且不含 `127.0.0.1`；`current_database()` 与 `inet_server_addr()` 回执满足隔离规则
  验证命令: Test: manual:bash -c ': "${DB_URL:?}"; echo "$DB_URL" | grep -q "host.docker.internal" && ! echo "$DB_URL" | grep -q "127.0.0.1" && ROW=$(psql "$DB_URL" -X -qAt -c "SELECT current_database() || '\''|'\'' || COALESCE(inet_server_addr()::text,'\''NULL'\'')") && DB_NAME=${ROW%%|*} && DB_ADDR=${ROW#*|} && echo "$DB_NAME" | grep -Eq "(_test$|^preview_[A-Za-z0-9_]+$)" && [ "$DB_ADDR" != "127.0.0.1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] PR #4372 保持 Draft 且 `autoMergeRequest=null`
  动作: 调用 `gh pr view 4372 --json isDraft,autoMergeRequest,headRefOid`
  预期观察: 返回 `isDraft=true`、`autoMergeRequest=null`、`headRefOid` 为 40 位字符串
  验证命令: Test: manual:bash -c 'gh pr view 4372 --json isDraft,autoMergeRequest,headRefOid | jq -e ''.isDraft == true and .autoMergeRequest == null and (.headRefOid | type == "string" and length == 40)'''
  期望: exit 0

- [ ] [BEHAVIOR] [L2] current SHA required checks 只认最终 head SHA 的成功记录
  动作: 查询 PR #4372 的 required checks
  预期观察: required checks 非空且全部 `SUCCESS`，不接受历史 green checks 替代
  验证命令: Test: manual:bash -c 'gh pr checks 4372 --required --json name,state,link | jq -e ''length > 0 and all(.[]; .state == "SUCCESS")'''
  期望: exit 0

- [ ] [BEHAVIOR] [L2] approval 请求 shape 与最终 `headRefOid` 一致，旧 SHA 不得复用
  动作: 用真实 approval route shape 构造请求，并以 `gh pr view` 返回的最终 `headRefOid` 作为 `pr_head_sha`
  预期观察: 响应中的 `pr_head_sha` 或 `current_pr_head_sha` 与最终 `headRefOid` 一致；任何旧 SHA 请求都被判为 stale
  验证命令: Test: manual:bash -c ': "${HARNESS_REVIEW_APPROVER_TOKEN:?}"; FINAL_SHA=$(gh pr view 4372 --json headRefOid | jq -r ''.headRefOid'') && RESP=$(curl -sf localhost:5221/api/brain/harness/kernel-reviews/00000000-0000-4000-8000-000000000000/approve -H "Content-Type: application/json" -H "x-approver-token: ${HARNESS_REVIEW_APPROVER_TOKEN}" -d "{\"task_id\":\"00000000-0000-4000-8000-000000000001\",\"pr_head_sha\":\"$FINAL_SHA\",\"review_request_hop\":1,\"approved_by\":\"contract-e2e\"}") && echo "$RESP" | jq -e --arg sha "$FINAL_SHA" ''.pr_head_sha == $sha or .current_pr_head_sha == $sha'''
  期望: exit 0

## E2E 断言补充

- [ ] [BEHAVIOR] [L2] F1 当前主线等价基线清单同时声明 `S0-S12`、`143`、`11`、`8`、`7`
  动作: 运行 F1 基线合同测试或 smoke manifest 校验
  预期观察: 单一清单完整声明 `S0-S12`、`143 cells`、`11 elements`、`8 legacy behavior families`、`7 legacy smokes`
  验证命令: Test: manual:node -e "const fs=require('fs');const p='packages/brain/scripts/smoke/pr4372-current-main-equivalence-smoke.sh';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');for(const s of ['S0-S12','143','11','8','7']){if(!c.includes(s))process.exit(1)}"
  期望: exit 0
