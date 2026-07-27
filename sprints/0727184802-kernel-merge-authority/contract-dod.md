---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel 唯一 Merge Authority 收归

**范围**: Harness merge authority、authenticated approve/reject、`human_review` 决策落账、stale SHA 失效、merge head 原子锁定、标题型 CI/legacy merge caller fail-closed、红绿回归测试。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] approve/reject、merge gate、CI fail-closed 的合同测试文件存在
  Test: node -e "const fs=require('fs');const p='sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts';if(!fs.existsSync(p))throw new Error('missing '+p);const c=fs.readFileSync(p,'utf8');for(const s of ['--match-head-commit','should-auto-merge.sh','repo','pr_number']){if(!c.includes(s))throw new Error('missing '+s)}"

- [ ] [ARTIFACT] 合同草案含 `## 真实调用方请求 shape`、`## 禁 mock 边清单`、`## 未覆盖真实链路清单`
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/0727184802-kernel-merge-authority/contract-draft.md','utf8');for(const s of ['## 真实调用方请求 shape','## 禁 mock 边清单','## 未覆盖真实链路清单']){if(!c.includes(s))throw new Error('missing '+s)}"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] approve route 缺少 repo 或 pr_number 时拒绝且不写 human_review verdict
  动作: 对 approve route 发送缺 `repo/pr_number` 的 authenticated 请求。
  预期观察: 返回 400，且决策日志没有新增 `verdict:human_review`。
  Test: manual:bash -c 'npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "approve route 缺少 repo 或 pr_number 时拒绝且不写 human_review verdict"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail
  动作: 发送完整 ownership tuple 的 approve 请求。
  预期观察: 202 成功后写入 `verdict:human_review`，detail 含 `approved_by/pr_head_sha/source/timestamp/repo/pr_number/run_id`。
  Test: manual:bash -c 'npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] mergeGate 对 stale human approval fail-closed 并要求重跑证据链
  动作: 构造 `reviewRequired=true` 且 approval SHA 落后于当前 PR head 的 gate 输入。
  预期观察: merge gate 拒绝并返回 stale/review 未批准语义。
  Test: manual:bash -c 'npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "mergeGate 对 stale human approval fail-closed 并要求重跑证据链"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] merge_pr 调用 gh 时必须传 --match-head-commit 当前 head_sha
  动作: 调用真实 `merge_pr` handler，输入当前 `ctx.observed.pr.head_sha`。
  预期观察: 生成的 gh merge 命令显式带 `--match-head-commit <head_sha>`。
  Test: manual:bash -c 'npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "merge_pr 调用 gh 时必须传 --match-head-commit 当前 head_sha"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 标题 feat(harness) 或 cp- branch 本身不能决定 Harness merge authority
  动作: 真执行 `.github/workflows/scripts/should-auto-merge.sh`，仅提供 `cp-` branch 与 `feat(harness)` 标题。
  预期观察: 脚本不会因为标题/branch 自行授予 Harness merge authority，而是 fail-closed/交给 server-owned 证据。
  Test: manual:bash -c 'npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "标题 feat\\(harness\\) 或 cp- branch 本身不能决定 Harness merge authority"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] resolveKernelMergeAuthority 只接受 repo pr_number run_id head_sha 四元组
  动作: 调用 server-owned ownership resolver，对缺字段、普通 PR、完整 Kernel tuple 分别判定。
  预期观察: 缺字段/普通 PR 返回 fail-closed；完整 tuple 才返回 Kernel-owned。
  Test: manual:bash -c 'npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "resolveKernelMergeAuthority 只接受 repo pr_number run_id head_sha 四元组"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-1 SHA 锚定：旧 approval 不能放行新 head merge
  动作: 让 approval `pr_head_sha=sha-old`，当前 PR head=`sha-new`。
  预期观察: merge gate 拒绝，不能写出 allow merge。
  Test: manual:bash -c 'npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "mergeGate 对 stale human approval fail-closed 并要求重跑证据链"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-2 任务锚定 N/A：本 sprint 不修改 relay task payload 写入逻辑
  动作: N/A
  预期观察: N/A
  Test: manual:bash -c "echo 'N/A: 本 sprint 不触及 base_repo/pr_url 写入逻辑'"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-3 鉴权：无 approver token 的 approve 请求 fail-closed
  动作: 对 approve route 发起不带 `x-approver-token` 的请求。
  预期观察: 返回 401 或 503，且 body 含 `error` 字段。
  验证命令: Test: manual:bash
    RESP_CODE=$(curl -s -o /tmp/kernel-approve-auth.json -w "%{http_code}" \
      -X POST "http://localhost:5221/api/brain/harness/kernel-reviews/11111111-1111-4111-8111-111111111111/approve" \
      -H "Content-Type: application/json" \
      -d '{"task_id":"22222222-2222-4222-8222-222222222222","repo":"perfectuser21/cecelia","pr_number":4379,"pr_head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","review_request_hop":3,"approved_by":"codex"}')
    [ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "503" ] || { echo "FAIL: expected 401/503 got $RESP_CODE"; cat /tmp/kernel-approve-auth.json; exit 1; }
    cat /tmp/kernel-approve-auth.json | jq -e '.error | type == "string"' >/dev/null
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-4 凭据安全 N/A：本 sprint 不新增 secret 存储，仅复用 env token
  动作: N/A
  预期观察: N/A
  Test: manual:bash -c "echo 'N/A: 本 sprint 只复用 HARNESS_REVIEW_APPROVER_TOKEN，不新增 secret 落盘'"
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-5 成功判定：批准成功看 detail 语义字段，不只看 ok:true
  动作: 发送完整 approve 请求并检查落账 detail。
  预期观察: `approved_by/pr_head_sha/source/timestamp` 全部存在；缺任一字段即失败。
  Test: manual:bash -c 'npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts -t "approve route 记录含 approved_by pr_head_sha source timestamp repo pr_number run_id 的 human_review detail"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-6 环境路由 N/A：本 sprint target_environment 固定 local_api，不从本地文件取路由
  动作: N/A
  预期观察: N/A
  Test: manual:bash -c "echo 'N/A: 本 sprint 验收固定 local_api'"
  期望: exit 0

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

CURRENT_SHA=$(echo "$TASK_JSON" | jq -r '.payload.pull_request.head_sha // .task.payload.pull_request.head_sha // empty')
if [ -z "$CURRENT_SHA" ]; then
  PR_URL=$(echo "$TASK_JSON" | jq -r '.pr_url // .payload.pr_url // .task.pr_url // .task.payload.pr_url // empty')
  [ -n "$PR_URL" ] || { echo "FAIL: task 未提供 pr_url"; exit 1; }
  CURRENT_SHA=$(gh pr view "$PR_URL" --json headRefOid --jq '.headRefOid')
fi
[ -n "$CURRENT_SHA" ] || { echo "FAIL: current sha empty"; exit 1; }

DEADLINE=$((SECONDS + 60))
until npx vitest run sprints/0727184802-kernel-merge-authority/tests/kernel-merge-authority.contract.test.ts >/tmp/kernel-merge-authority-e2e.log 2>&1; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: contract tests timeout"; cat /tmp/kernel-merge-authority-e2e.log; exit 1; }
  sleep 2
done

RESP_CODE=$(curl -s -o /tmp/kernel-approve-e2e.json -w "%{http_code}" \
  -X POST "http://localhost:5221/api/brain/harness/kernel-reviews/11111111-1111-4111-8111-111111111111/approve" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"22222222-2222-4222-8222-222222222222\",\"repo\":\"perfectuser21/cecelia\",\"pr_number\":4379,\"pr_head_sha\":\"$CURRENT_SHA\",\"review_request_hop\":3,\"approved_by\":\"codex-e2e\"}")
[ "$RESP_CODE" = "401" ] || [ "$RESP_CODE" = "503" ] || { echo "FAIL: unauthenticated approve must fail-closed"; cat /tmp/kernel-approve-e2e.json; exit 1; }
cat /tmp/kernel-approve-e2e.json | jq -e '.error | type == "string"' >/dev/null
```
