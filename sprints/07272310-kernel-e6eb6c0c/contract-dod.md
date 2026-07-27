---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel Preview CI target-aware authority recovery

**范围**: Kernel target-aware CI authority、Preview/required-context blocker、真实 workflow callback、ground-truth/decision-log 证据链、Draft current-SHA 守卫、legacy adapter 真调用
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/07272310-kernel-e6eb6c0c/tests/kernel-preview-ci-authority.test.ts` 覆盖 server-owned authority、唯一 blocker、current-SHA 失效与 callback route 红测
  Test: node -e "const c=require('fs').readFileSync('sprints/07272310-kernel-e6eb6c0c/tests/kernel-preview-ci-authority.test.ts','utf8'); for (const token of ['preview_authority','preview_required_failure','draft_authority_invalidated','kernel-reviews']) if(!c.includes(token)) process.exit(1)"

- [ ] [ARTIFACT] `contract-draft.md` 含 `## 真实调用方请求 shape`、`## 禁 mock 边清单`、`## E2E 验收`
  Test: node -e "const c=require('fs').readFileSync('sprints/07272310-kernel-e6eb6c0c/contract-draft.md','utf8'); for (const token of ['## 真实调用方请求 shape','## 禁 mock 边清单','## E2E 验收']) if(!c.includes(token)) process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，按 journey_type=autonomous）

- [ ] [BEHAVIOR] [L2] 忽略 caller-fed authority 字段，只从 server-owned task/run/PR/CI/DB 读取 authority
  动作: 用真实 `GET /api/brain/tasks/:id` 与真实 Postgres `initiative_runs` 记录读取当前 task/run，不向请求体注入 `expected_repo` / `expected_run` / `scenario`
  预期观察: 当前 task id 与 run id 都来自服务端真实记录；若 DB 无 run/task 记录则断言失败，不会被 caller 自喂字段补成 PASS
  验证命令: Test: manual:bash
    TASK_ID="${TASK_ID:?}"
    RUN_ID="${RUN_ID:?}"
    RESP=$(curl -sS "http://localhost:5221/api/brain/tasks/$TASK_ID")
    echo "$RESP" | jq -e '.id == "'"$TASK_ID"'"'
    psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "SELECT count(*) FROM initiative_runs WHERE id='${RUN_ID}'::uuid" | awk '{ exit ($1 == 1 ? 0 : 1) }'

- [ ] [BEHAVIOR] [L2] 每个负例返回唯一 blocker，within 60s 不允许 OR 合并掩盖
  动作: 运行 `tests/kernel-preview-ci-authority.test.ts` 中针对 stale SHA、wrong repo、wrong run/task、missing required context、preview-required failure、local required-context failure、missing context mapping、external infrastructure failure 的独立测试
  预期观察: within 60s 每个测试名各自产出唯一 blocker reason，且测试输出中不出现用单条 OR 合并多个 blocker 的断言
  验证命令: Test: manual:bash
    DEADLINE=$((SECONDS + 60))
    until npx vitest run sprints/07272310-kernel-e6eb6c0c/tests/kernel-preview-ci-authority.test.ts --reporter=verbose > /tmp/kernel-preview-ci-red.log 2>&1; do
      grep -q 'preview_required_failure' /tmp/kernel-preview-ci-red.log && break
      [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s did not observe precise blocker red evidence"; cat /tmp/kernel-preview-ci-red.log; exit 1; }
      sleep 2
    done
    grep -q 'preview_required_failure' /tmp/kernel-preview-ci-red.log
    grep -q 'missing_context_mapping' /tmp/kernel-preview-ci-red.log
    grep -q 'external_infrastructure_failure' /tmp/kernel-preview-ci-red.log

- [ ] [BEHAVIOR] [L2] workflow callback 必须记录真实 HTTP status 与 body，禁止 `curl -sf`
  动作: 用真实 HTTP POST 调 `POST /api/brain/harness/attempts/:attemptId/callback`，显式捕获 status code 与 body 文件
  预期观察: 返回 200 时 body 含 `ok/attemptId/deduped`；status 或 body 任一不符都失败；脚本中不存在 `curl -sf`
  验证命令: Test: manual:bash
    ATTEMPT_ID="${ATTEMPT_ID:?}"
    CALLBACK_SECRET="${CALLBACK_SECRET:?}"
    LEASE_OWNER="${LEASE_OWNER:?}"
    BODY_FILE="${TMPDIR:-/tmp}/kernel-preview-callback-body.json"
    STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
      -X POST "http://localhost:5221/api/brain/harness/attempts/$ATTEMPT_ID/callback" \
      -H "Authorization: Bearer $CALLBACK_SECRET" \
      -H "X-Harness-Lease-Owner: $LEASE_OWNER" \
      -H "Content-Type: application/json" \
      --data @- <<JSON
{"contract_version":"1.0","attempt_id":"$ATTEMPT_ID","status":"completed","summary":"callback contract probe","artifacts":[],"checks":[],"decision":{"outcome":"PASS","reason":"callback contract probe"},"error":null,"provider_metadata":{"provider":"codex","session_id":"kernel-preview-ci-callback"}}
JSON
    )
    [ "$STATUS" = "200" ] || { echo "FAIL: callback status=$STATUS body=$(cat "$BODY_FILE")"; exit 1; }
    cat "$BODY_FILE" | jq -e '.ok == true and .attemptId == "'"$ATTEMPT_ID"'" and (.deduped|type=="boolean")'

- [ ] [BEHAVIOR] [L2] ground truth 必须从真实 DB 与 `orchestrator_decision_log` 派生，within 60s 可回放 route→DB→ground-truth→decision
  动作: 触发 callback/approval 后轮询真实 Postgres 中 `orchestrator_decision_log` 的新记录
  预期观察: within 60s 至少出现一条当前 run 的 fresh log；若没有 fresh 记录则 fail-closed，而不是拿历史记录冒充
  验证命令: Test: manual:bash
    RUN_ID="${RUN_ID:?}"
    DEADLINE=$((SECONDS + 60))
    until psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='${RUN_ID}'::uuid AND created_at > NOW() - interval '5 minutes'" | awk '{ exit ($1 >= 1 ? 0 : 1) }'; do
      [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s no fresh orchestrator_decision_log evidence"; exit 1; }
      sleep 2
    done
    echo "OK: within 60s fresh decision log observed"

- [ ] [BEHAVIOR] [L2] [legacy] human approval 必须锚定当前 PR head SHA；旧 SHA approval 不能继续生效
  动作: 用真实 `gh pr view` 读取当前 `headRefOid`，再调用 `POST /api/brain/harness/kernel-reviews/:runId/approve`
  预期观察: 当前 SHA 返回 202 + `pr_head_sha` 匹配；若 body 提供旧 SHA，应得到 `stale_sha` 或 equivalent fail-closed 响应
  验证命令: Test: manual:bash -c 'CURRENT_SHA=$(gh pr view "${PR_URL:?}" --json headRefOid --jq ".headRefOid"); BODY=$(mktemp); STATUS=$(curl -sS -o "$BODY" -w "%{http_code}" -X POST "http://localhost:5221/api/brain/harness/kernel-reviews/${RUN_ID:?}/approve" -H "X-Approver-Token: ${APPROVER_TOKEN:?}" -H "Content-Type: application/json" --data "{\"task_id\":\"${TASK_ID:?}\",\"pr_head_sha\":\"$CURRENT_SHA\",\"review_request_hop\":${REVIEW_REQUEST_HOP:?},\"approved_by\":\"kernel-dod-human\"}"); [ "$STATUS" = "202" ] || { echo "FAIL: approval status=$STATUS body=$(cat "$BODY")"; exit 1; }; cat "$BODY" | jq -e ".pr_head_sha == \"$CURRENT_SHA\" and .task_id == \"${TASK_ID}\""'
