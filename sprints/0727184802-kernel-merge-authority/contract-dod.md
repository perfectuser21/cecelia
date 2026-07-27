---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel 唯一 Merge Authority 收归

**范围**: 可信 ownership tuple、authenticated approve/reject、`human_review` 落账、`review_required=true` merge gate、stale SHA 失效、`gh pr merge --match-head-commit` 原子锁头、CI/legacy caller fail-closed。  
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同红测文件覆盖真实 PostgreSQL approve/reject 接缝、merge gate、lock-head、CI fail-closed
  Test: node -e "const fs=require('fs');const p='sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts';const c=fs.readFileSync(p,'utf8');for(const s of ['createIsolatedDatabase','approve route 缺少 repo 或 pr_number','reject route stale SHA','review_required=true 且无有效 human_review 批准时所有 merge caller 都不能合并','--match-head-commit','resolveKernelMergeAuthority']){if(!c.includes(s))throw new Error('missing '+s)}"

- [ ] [ARTIFACT] 合同草案声明真实调用方 shape、禁 mock 边、未覆盖真实链路清单
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/0727184802-kernel-merge-authority/contract-draft.md','utf8');for(const s of ['## 真实调用方请求 shape','## 禁 mock 边清单','## 未覆盖真实链路清单']){if(!c.includes(s))throw new Error('missing '+s)}"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] approve route 缺少 repo 或 pr_number 时拒绝且不写 human_review verdict
  动作: 对 `POST /api/brain/harness/kernel-reviews/:runId/approve` 发送缺少 `repo/pr_number` 的 authenticated 请求。
  预期观察: 返回 400，`orchestrator_decision_log` 不新增 `verdict:human_review`。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "approve route 缺少 repo 或 pr_number 时拒绝且不写 human_review verdict"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail
  动作: 对 approve route 发送完整 `task_id/repo/pr_number/pr_head_sha/review_request_hop` 请求。
  预期观察: 返回 202，并写入 `approved_by/pr_head_sha/source/timestamp/repo/pr_number/run_id` 完整 detail。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] approve route 成功响应只返回 ok run_id task_id repo pr_number pr_head_sha review_request_hop review_class approved_by timestamp source
  动作: 对 approve route 发送完整 `task_id/repo/pr_number/pr_head_sha/review_request_hop` 请求。
  预期观察: 返回 202，响应顶层 keys 完全等于 `["approved_by","ok","pr_head_sha","pr_number","repo","review_class","review_request_hop","run_id","source","task_id","timestamp"]`，且不存在 `approved_at/runId/taskId/head_sha`。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "approve route 成功响应只返回 ok run_id task_id repo pr_number pr_head_sha review_request_hop review_class approved_by timestamp source"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] reject route 记录含 rejected_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail
  动作: 对 reject route 发送完整 `task_id/repo/pr_number/pr_head_sha/review_request_hop` 请求。
  预期观察: 返回 202，并写入 `rejected_by/pr_head_sha/source/timestamp/repo/pr_number/run_id` 完整 detail。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "reject route 记录含 rejected_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] reject route 成功响应只返回 ok run_id task_id repo pr_number pr_head_sha review_request_hop review_class rejected_by timestamp source
  动作: 对 reject route 发送完整 `task_id/repo/pr_number/pr_head_sha/review_request_hop` 请求。
  预期观察: 返回 202，响应顶层 keys 完全等于 `["ok","pr_head_sha","pr_number","rejected_by","repo","review_class","review_request_hop","run_id","source","task_id","timestamp"]`，且不存在 `rejected_at/runId/taskId/head_sha`。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "reject route 成功响应只返回 ok run_id task_id repo pr_number pr_head_sha review_request_hop review_class rejected_by timestamp source"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] reject route stale SHA 或 run/PR 不匹配时拒绝且不写 human_review verdict
  动作: 对 `POST /api/brain/harness/kernel-reviews/:runId/reject` 先发送过期 `pr_head_sha`，再发送 `repo/pr_number` 不匹配的 authenticated 请求。
  预期观察: 两次请求都返回 409，`orchestrator_decision_log` 不新增 reject verdict。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "reject route stale SHA 或 run/PR 不匹配时拒绝且不写 human_review verdict"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] review_required=true 且无有效 human_review 批准时所有 merge caller 都不能合并
  动作: 构造 `reviewRequired=true` 且 `reviewApproved=false` 的 merge gate 输入。
  预期观察: gate fail-closed，任何 caller 都拿不到 allow merge。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "review_required=true 且无有效 human_review 批准时所有 merge caller 都不能合并"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] mergeGate 对 stale human approval fail-closed 并要求重跑证据链
  动作: 构造 evaluator/judge 命中 `sha-new`、human approval 仍锚定 `sha-old` 的 gate 输入。
  预期观察: gate 返回 `allow=false`，旧 approval 不能放行新 head。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "mergeGate 对 stale human approval fail-closed 并要求重跑证据链"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] merge_pr 调用 gh 时必须传 --match-head-commit 当前 head_sha
  动作: 调用真实 `merge_pr` handler，并传入 `ctx.observed.pr.head_sha`。
  预期观察: 组装出的 gh merge 命令显式带 `--match-head-commit <current_head_sha>`。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "merge_pr 调用 gh 时必须传 --match-head-commit 当前 head_sha"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 标题 feat(harness) 或 cp- branch 本身不能决定 Harness merge authority
  动作: 真执行 `.github/workflows/scripts/should-auto-merge.sh`，只提供 `cp-*` branch 与 `feat(harness)` 标题。
  预期观察: 脚本输出 fail-closed 语义，不再把标题/branch 当授权证据。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "标题 feat(harness) 或 cp- branch 本身不能决定 Harness merge authority"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] resolveKernelMergeAuthority 只接受 repo pr_number run_id head_sha 四元组
  动作: 调用 server-owned ownership resolver，对缺字段与完整 tuple 分别判定。
  预期观察: 缺字段/普通 PR fail-closed，只有完整 tuple 才返回 `{ kernelOwned: true }`。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "resolveKernelMergeAuthority 只接受 repo pr_number run_id head_sha 四元组"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] finalizeHarnessTask 在 review_required=true 且缺当前 SHA human_review 时 fail-closed
  动作: 调用 legacy finalize caller，构造 `PR MERGED + evaluator gate 已过` 但 `review_required=true` 且缺当前 SHA `human_review/judge` 的输入。
  预期观察: finalize 返回 `allow=false`，并记录必须回到当前 head 证据链。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "finalizeHarnessTask 在 review_required=true 且缺当前 SHA human_review 时 fail-closed"'
  期望: exit 0

## 铁律映射（Step 1.3）

- [ ] [BEHAVIOR] [L2] INV-1 SHA 锚定：旧 approval 不能放行新 head merge
  动作: approval 锚定 `sha-old`，当前 PR head 为 `sha-new`。
  预期观察: merge gate fail-closed。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "mergeGate 对 stale human approval fail-closed 并要求重跑证据链"'
  期望: exit 0

- INV-2 任务锚定: N/A，本 sprint 不修改 relay payload 写入 `base_repo/pr_url` 逻辑。
- [ ] [BEHAVIOR] [L2] INV-3 鉴权：无 approver token 的 approve 请求 fail-closed
  动作: 不带 `x-approver-token` 调用 approve route。
  预期观察: 返回 401 或 503，且 body 含 `error` 字段。
  验证命令: Test: manual:bash
    RESP_CODE=$(curl -s -o /tmp/kernel-approve-auth.json -w "%{http_code}" \
      -X POST "http://localhost:5221/api/brain/harness/kernel-reviews/11111111-1111-4111-8111-111111111111/approve" \
      -H "Content-Type: application/json" \
      -d '{"task_id":"22222222-2222-4222-8222-222222222222","repo":"perfectuser21/cecelia","pr_number":4379,"pr_head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","review_request_hop":3,"approved_by":"codex"}')
    [ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "503" ] || { echo "FAIL: expected 401/503 got $RESP_CODE"; cat /tmp/kernel-approve-auth.json; exit 1; }
    cat /tmp/kernel-approve-auth.json | jq -e '.error | type == "string"' >/dev/null
  期望: exit 0

- INV-4 凭据安全: N/A，本 sprint 只复用 `HARNESS_REVIEW_APPROVER_TOKEN`，不新增 secret 落盘。
- [ ] [BEHAVIOR] [L2] INV-5 成功判定：批准成功必须看 detail 语义字段，不只看 ok:true
  动作: 发送完整 approve 请求。
  预期观察: `approved_by/pr_head_sha/source/timestamp/repo/pr_number/run_id` 缺任一字段即视为失败。
  验证命令: Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail"'
  期望: exit 0

- INV-6 环境路由: N/A，本 sprint 验收固定 `local_api`，不从本地文件取 `target_environment`。

## E2E 验收

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

TASK_ID="${HARNESS_TASK_ID:-ea7f6b59-b2fd-48a4-940f-e267c9898889}"
TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/$TASK_ID")
echo "$TASK_JSON" | jq -e --arg id "$TASK_ID" '
  (.id // .task.id) == $id
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/0727184802-kernel-merge-authority")
' >/dev/null

DEADLINE=$((SECONDS + 60))
until node ./node_modules/vitest/vitest.mjs run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts >/tmp/kernel-merge-authority-e2e.log 2>&1; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s contract tests still red"; cat /tmp/kernel-merge-authority-e2e.log; exit 1; }
  sleep 2
done

RESP_CODE=$(curl -s -o /tmp/kernel-approve-e2e.json -w "%{http_code}" \
  -X POST "http://localhost:5221/api/brain/harness/kernel-reviews/11111111-1111-4111-8111-111111111111/approve" \
  -H "Content-Type: application/json" \
  -d '{"task_id":"22222222-2222-4222-8222-222222222222","repo":"perfectuser21/cecelia","pr_number":4379,"pr_head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","review_request_hop":3,"approved_by":"codex-e2e"}')
[ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "503" ] || { echo "FAIL: unauthenticated approve must fail-closed"; cat /tmp/kernel-approve-e2e.json; exit 1; }
cat /tmp/kernel-approve-e2e.json | jq -e '.error | type == "string"' >/dev/null

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='11111111-1111-4111-8111-111111111111' AND action='verdict:human_review' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" = "0" ] || { echo "FAIL: unauthenticated approve inserted verdict"; exit 1; }
```
