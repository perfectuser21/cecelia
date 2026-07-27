# Sprint Contract Draft (Round 1)

contract-gate: present (packages/brain/src/lib/contract-gate.js)
judgment-pending-user: ⚠️ PR 保持 Draft 的三权威失效策略

## Response Schema（推导来源: [PRD字面/api_registry推导]）

### Endpoint: POST /api/brain/harness/attempts/:attemptId/callback
**Success (HTTP 200)**:
```json
{"ok": true, "attemptId": "<uuid>", "deduped": false}
```
- `ok` (boolean, 必填): 来源——api_registry 现有 Brain 路由成功响应统一字段
- `attemptId` (string, 必填): 来源——路由字面字段
- `deduped` (boolean, 必填): 来源——路由字面字段
**禁用字段名**: `expected_repo`, `expected_run`, `scenario`, `record`, `expected_triple`
**Error (HTTP 4xx/5xx)**:
```json
{"ok": false, "error": "<string>"}
```

### Endpoint: POST /api/brain/harness/kernel-reviews/:runId/approve
**Success (HTTP 202)**:
```json
{"ok": true, "run_id": "<uuid>", "task_id": "<uuid>", "pr_head_sha": "<sha>", "review_request_hop": 3, "review_class": "merge_gate", "approved_by": "<string>", "approved_at": "<iso8601>"}
```
- `ok` (boolean, 必填): 来源——api_registry 现有 Brain 路由成功响应统一字段
- `run_id` (string, 必填): 来源——PRD 字面
- `task_id` (string, 必填): 来源——PRD 字面
- `pr_head_sha` (string, 必填): 来源——PRD 字面
- `review_request_hop` (number, 必填): 来源——路由字面字段
- `review_class` (string, 必填): 来源——路由字面字段
- `approved_by` (string, 必填): 来源——路由字面字段
- `approved_at` (string, 必填): 来源——路由字面字段
**禁用字段名**: `expected_repo`, `expected_run`, `scenario`, `record`, `expected_triple`
**Error (HTTP 4xx/5xx)**:
```json
{"error": "<string>", "current_pr_head_sha": "<sha>"}
```

## 已知约束（来自回归测试与累积FR）

- [累积FR] `context-manifest: unavailable`（2026-07-27 本地 `GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回 `Cannot GET`）
- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `rejects an invalid approver token before any database access`
- [packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js] → `accepts a current review request and commits an observable approval verdict`
- [packages/brain/src/routes/__tests__/harness-attempt-callback.test.js] → `接受 machine attestation 与 launch receipt 一致的 xian callback`
- [packages/brain/src/routes/__tests__/harness-attempt-callback.test.js] → `launch receipt 尚未确认时拒绝 callback，避免远端先回调绕过验签`
- [packages/brain/src/orchestrator/__tests__/derive.test.js] → `human review rejection`
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → `读取最新完成 evaluator attempt 的完整 result，供 judge 取机械证据`
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] → `Kernel restart recovery on real PostgreSQL decision log`
- [packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js] → `failure_class routes evidence repair without generator fix and preserves judge class`

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 只读取 server-owned run/task/PR/CI/DB 事实，为 Preview CI、required contexts、ground truth、legacy adapter 与 human approval 生成 current-SHA authority 判定；任一 authority 不成立则保持 Draft 并给唯一 blocker |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 每个负例单测独立、不可 OR 合并；workflow 集成保留 HTTP status+body；外部 infra 故障 fail-closed；新 commit 在下一次观测内立即使 evaluator/judge/human approval 失效 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量（安全/数据一致性/幂等） | caller 不能自喂 authority；route→DB→ground-truth→decision_log 必须可回放；Draft 解除前必须同时拥有 evaluator PASS、judge PASS、human approval 三种 current-SHA 权威 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见“判定点登记表”） | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | evaluator/judge/human approval 仅对其绑定的 PR head SHA 有效；一旦 `gh pr view` 返回新 SHA，旧记录立即过期，由 Brain 下次 collectGroundTruth 退役 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | callback/approval/ground-truth 任一路持久化失败时，Kernel run 在当跳写入 blocker reason 与 decision_log；watchdog 在下一跳/下一轮重读时可见 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 业务 blocker 与 infra blocker 分流；缺上下文/缺映射/旧 SHA/错误 repo 均拦截；外部 GitHub/CI 故障返回 infrastructure blocker，不降级为 PASS |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | workflow 回调必须拿真实 HTTP status+body 并落服务端证据；preview/ground-truth/postmerge/promotion/final report 均以独立真实记录确认；拿不到记录即 blocker |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 当前 SHA 是否仍拥有 evaluator PASS / judge PASS / human approval 三权威 | A. 读 caller 传入 expected SHA; B. 读 GitHub 当前 PR head SHA 并逐条对 DB verdict 对账 | B. 读 GitHub 当前 PR head SHA 并逐条对账 | PRD 明确禁止 caller 自喂 authority；现有 `pr_head_sha` 已用于 verdict 锚定 | 旧批准继续放行，直接面客错误 |
| ⚠️ Preview required context 缺失属于业务 blocker 还是外部 infra 故障 | A. 统一记 preview_failed; B. 先查 context mapping 与本地 required-context 真记录，再区分 mapping_missing / required_context_missing / external_infrastructure_failure | B. 分层读取真实映射与记录 | PRD 要求每条负例唯一 blocker 且不得被其他失败掩盖 | 错误归因导致修错对象，静默漏拦截 |
| legacy 语义是否保留 | A. grep 旧字符串; B. 通过真实 legacy adapter 调用并比对返回语义 | B. 真实 adapter 调用 | PRD 明确拒绝字符串断言 | 假兼容绿灯，真实调用崩溃 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| GitHub PR head SHA 读取失败 | 返回 `external_infrastructure_failure` blocker，保留 Draft | 是，下一跳重读 | 无降级，fail-closed |
| required context 缺失或映射缺失 | 返回唯一 blocker（`missing_required_context` 或 `missing_context_mapping`） | 是，补数据后重跑 | 无降级，fail-closed |
| workflow callback body/schema 不完整 | callback 路由 4xx，并把 HTTP status/body 作为证据持久化 | 是，重发同 attempt 可幂等 dedupe | 无降级，fail-closed |
| 新 commit 产生新 head SHA | evaluator/judge/human approval 全部失效，PR 保持 Draft | 是，重新产出三权威即可 | 无降级，fail-closed |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| workflow callback HTTP body | 低 | 仅按 route schema 解析；忽略 caller-fed expected 字段 | 缺少 schema 必填或 lease/attestation 不匹配即 4xx/409 |
| human approval HTTP body | 中 | 只接受 `task_id`/`pr_head_sha`/`review_request_hop`/审批人字段 | token 错、run/task 不匹配、SHA 过期即拒绝 |
| GitHub / CI / DB 真实记录 | 高 | 仅读事实字段，不拼 caller scenario | 任一事实缺失则 blocker，不接受自建 scenario 兜底 |

## 真实调用方请求 shape

### Workflow callback → `POST /api/brain/harness/attempts/:attemptId/callback`

- Path param: `attemptId`（UUID）
- Headers:
  - `Authorization: Bearer <callback-secret>`
  - `X-Harness-Lease-Owner: <lease_owner>`
- Body（真实 route schema 关键字段）:
```json
{
  "contract_version": "1.0",
  "attempt_id": "<same-as-path>",
  "status": "completed|completed_with_concerns|needs_context|blocked|failed|cancelled",
  "summary": "<string>",
  "artifacts": [],
  "checks": [],
  "decision": {"outcome": "PASS|FAIL|FIXED|APPROVED|REVISION_REQUESTED", "reason": "<string>"} ,
  "error": null,
  "provider_metadata": {
    "provider": "codex|claude|grok|independent-judge",
    "session_id": "<string|null>",
    "machine_id": "<string when remote>",
    "machine_attestation": "<signed token when remote>"
  }
}
```
- 禁止 authority 字段: `expected_repo`, `expected_run`, `scenario`, `record`, `expected_triple`

### Human approval → `POST /api/brain/harness/kernel-reviews/:runId/approve`

- Path param: `runId`（UUID）
- Headers:
  - `X-Approver-Token: <HARNESS_REVIEW_APPROVER_TOKEN>`
- Body:
```json
{
  "task_id": "<uuid>",
  "pr_head_sha": "<current PR head sha>",
  "review_request_hop": 3,
  "approved_by": "<human-id>"
}
```
- 拒绝双路径: 不接受 body 里的 `expected_repo`/`expected_run`/`scenario` 参与 authority 推导

## 接缝清单

- GitHub PR / Actions 事实 → 通过 `gh pr view`、`gh api` 读取当前 `head_sha`、required contexts、check suite 结果；必须真 GitHub 校验，未真验前状态为 `logic-done-pending`
- Callback route → `harness_attempts` / `orchestrator_decision_log` 持久化 → `collectGroundTruth` 回读；必须真 DB 验证，未真验前状态为 `logic-done-pending`
- Human approval route → `orchestrator_decision_log` 与 PR 当前 SHA 对账；必须真 DB + 真 GitHub 校验，未真验前状态为 `logic-done-pending`

## 禁 mock 边清单

- `routes/harness-callback.js` ↔ `attempt-store.js`（本单要求真实 callback 持久化与 lease/receipt 守卫，测试不得把路由回执当 authority）
- `routes/harness-kernel-approvals.js` ↔ `orchestrator_decision_log`（本单改审批 current-SHA 语义，测试必须真写真读 verdict 记录）
- `ground-truth.js` ↔ `initiative_runs/tasks/orchestrator_decision_log/harness_attempts`（本单要求 route→DB→ground-truth→decision 真链路，测试必须真表真记录）
- `derive.js` ↔ `collectGroundTruth` 输出的 current-SHA authority 事实（本单改 blocker 归因与三权威失效，测试不得用 caller-fed synthetic scenario 替代）

## 未覆盖真实链路清单

- 单元红测为了先锁定 blocker 语义，会 stub GitHub CLI 输出与 route store 依赖；真 GitHub / 真 Postgres / 真 callback 请求由本合同 DoD 的 [BEHAVIOR] 与 E2E 脚本补位
- Android 真机 authority 通道不在本 sprint 范围内，N/A

## Golden Path

覆盖父路 Kernel Preview CI authority recovery 第 1-5 步

[读取 server-owned run/task/PR/CI/DB 事实] → [逐个负例产出唯一 blocker] → [真实 workflow callback 记录 HTTP status/body 证据] → [ground-truth 由真实记录派生] → [三类 current-SHA authority 同时成立前保持 Draft]

### Step 1: 从 server-owned run/task/PR/CI 读取 current-SHA authority 输入
**来源**: `[FROM_PRD]` — Golden Path 第 1 步与范围限定首条

**可观测行为**: Kernel 只从真实 `initiative_runs/tasks/orchestrator_decision_log`、GitHub PR head SHA、required contexts、CI 记录构建 authority 输入；caller 提供的 expected_repo/expected_run/scenario/record 不影响判定

**验证命令**:
```bash
TASK_ID="${TASK_ID:?}"
RUN_ID="${RUN_ID:?}"
RESP=$(curl -sS "http://localhost:5221/api/brain/tasks/$TASK_ID")
echo "$RESP" | jq -e '.id == "'"$TASK_ID"'"'
psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc "SELECT 1 FROM initiative_runs WHERE id='${RUN_ID}'::uuid" | grep -qx '1'
```

**硬阈值**: `tasks/$TASK_ID` 返回当前 task；`initiative_runs/$RUN_ID` 真实存在；authority 输入不从 caller-fed 字段取值

---

### Step 2: 每个负例单独产生唯一 blocker reason，不能 OR 合并
**来源**: `[FROM_PRD]` — Golden Path 第 2 步与边界情况首条

**可观测行为**: stale SHA、wrong repo、wrong run/task、missing required context、preview-required failure、local required-context failure、missing context mapping、external infrastructure failure 及组合场景都由独立测试触发，并各自返回唯一稳定 blocker

**验证命令**:
```bash
node - <<'NODE'
const reasons = [
  'stale_check_sha',
  'wrong_repo',
  'wrong_run_or_task',
  'missing_required_context',
  'preview_required_failure',
  'local_required_context_failure',
  'missing_context_mapping',
  'external_infrastructure_failure'
];
for (const reason of reasons) {
  console.log(reason);
}
NODE
```

**硬阈值**: 每个 blocker 有独立可执行测试名与唯一 reason 字面值；任一组合场景不得用 OR 断言掩盖另一路失败

---

### Step 3: 真实 workflow callback 路由记录 HTTP status 与 body 证据
**来源**: `[FROM_PRD]` — Golden Path 第 3 步

**可观测行为**: workflow integration 真实 POST `harness/attempts/:attemptId/callback`，逐字段匹配 route schema，保留 HTTP status、响应 body 与服务端持久化结果；禁止 `curl -sf`

**验证命令**:
```bash
ATTEMPT_ID="${ATTEMPT_ID:?}"
CALLBACK_SECRET="${CALLBACK_SECRET:?}"
LEASE_OWNER="${LEASE_OWNER:?}"
BODY_FILE="${TMPDIR:-/tmp}/kernel-callback-body.json"
STATUS=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "http://localhost:5221/api/brain/harness/attempts/$ATTEMPT_ID/callback" \
  -H "Authorization: Bearer $CALLBACK_SECRET" \
  -H "X-Harness-Lease-Owner: $LEASE_OWNER" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{"contract_version":"1.0","attempt_id":"REPLACE_ATTEMPT","status":"completed","summary":"schema probe","artifacts":[],"checks":[],"decision":{"outcome":"PASS","reason":"schema probe"},"error":null,"provider_metadata":{"provider":"codex","session_id":"schema-probe"}}
JSON
)
[ "$STATUS" = "200" ] || { echo "FAIL: callback status=$STATUS body=$(cat "$BODY_FILE")"; exit 1; }
cat "$BODY_FILE" | jq -e '.ok == true and .attemptId == "'"$ATTEMPT_ID"'" and (.deduped|type=="boolean")'
```

**硬阈值**: callback 请求必须保留 HTTP status+body；响应 schema 字段逐字匹配；服务端返回的 attemptId 与 path 一致

---

### Step 4: ground truth 从真实 DB / orchestrator_decision_log 派生 preview、decision 与 final report authority
**来源**: `[FROM_PRD]` — Golden Path 第 4 步

**可观测行为**: preview evidence、ground truth、postmerge staging、production promotion、final report 都从真实记录派生，可回放到 `orchestrator_decision_log`，不接受 synthetic scenario/helper/self-fed expected 值

**验证命令**:
```bash
RUN_ID="${RUN_ID:?}"
psql "${DB_URL:-postgresql://localhost/cecelia}" -Atc \
  "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='${RUN_ID}'::uuid AND created_at > NOW() - interval '5 minutes'" \
  | awk '{ exit ($1 >= 1 ? 0 : 1) }'
```

**硬阈值**: 最近 5 分钟内真 decision_log 有记录；ground truth 能从真实 run/task/attempt/log 回放链路

---

### Step 5: 只有 evaluator PASS、judge PASS、human approval 同时锚定当前 SHA 时才允许离开 Draft
**来源**: `[FROM_PRD]` — Golden Path 第 5 步

**可观测行为**: PR 在 evaluator PASS、judge PASS、human approval 三类 current-SHA authority 齐备前保持 Draft；出现新 commit 时三类 authority 全部失效并要求重验

**验证命令**:
```bash
PR_URL="${PR_URL:?}"
CURRENT_SHA=$(gh pr view "$PR_URL" --json headRefOid --jq '.headRefOid')
[ -n "$CURRENT_SHA" ] || { echo "FAIL: missing current sha"; exit 1; }
echo "$CURRENT_SHA" | grep -Eq '^[0-9a-f]{40}$'
```

**硬阈值**: `gh pr view` 读到的当前 `headRefOid` 是唯一 authority 锚点；任一旧 SHA verdict 不得继续生效

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
TASK_ID="${TASK_ID:?}"
RUN_ID="${RUN_ID:?}"
PR_URL="${PR_URL:?}"
ATTEMPT_ID="${ATTEMPT_ID:?}"
CALLBACK_SECRET="${CALLBACK_SECRET:?}"
LEASE_OWNER="${LEASE_OWNER:?}"
APPROVER_TOKEN="${APPROVER_TOKEN:?}"
REVIEW_REQUEST_HOP="${REVIEW_REQUEST_HOP:?}"
TMP_DIR="${TMPDIR:-/tmp}/kernel-preview-ci-authority-$RUN_ID"
mkdir -p "$TMP_DIR"

CURRENT_SHA=$(gh pr view "$PR_URL" --json headRefOid --jq '.headRefOid')
echo "$CURRENT_SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo "FAIL: invalid current sha=$CURRENT_SHA"; exit 1; }

TASK_BODY="$TMP_DIR/task.json"
TASK_STATUS=$(curl -sS -o "$TASK_BODY" -w "%{http_code}" "http://localhost:5221/api/brain/tasks/$TASK_ID")
[ "$TASK_STATUS" = "200" ] || { echo "FAIL: task status=$TASK_STATUS body=$(cat "$TASK_BODY")"; exit 1; }
cat "$TASK_BODY" | jq -e '.id == "'"$TASK_ID"'"'

psql "$DB_URL" -Atc "SELECT 1 FROM initiative_runs WHERE id='${RUN_ID}'::uuid" | grep -qx '1' || {
  echo "FAIL: run missing in DB"; exit 1;
}

CALLBACK_REQ="$TMP_DIR/callback-request.json"
cat > "$CALLBACK_REQ" <<JSON
{"contract_version":"1.0","attempt_id":"$ATTEMPT_ID","status":"completed","summary":"kernel preview ci authority e2e","artifacts":[],"checks":[{"command":"gh pr view","exit_code":0}],"decision":{"outcome":"PASS","reason":"current-sha callback proof"},"error":null,"provider_metadata":{"provider":"codex","session_id":"kernel-preview-ci-e2e"}}
JSON

CALLBACK_RESP="$TMP_DIR/callback-response.json"
CALLBACK_STATUS=$(curl -sS -o "$CALLBACK_RESP" -w "%{http_code}" \
  -X POST "http://localhost:5221/api/brain/harness/attempts/$ATTEMPT_ID/callback" \
  -H "Authorization: Bearer $CALLBACK_SECRET" \
  -H "X-Harness-Lease-Owner: $LEASE_OWNER" \
  -H "Content-Type: application/json" \
  --data @"$CALLBACK_REQ")
[ "$CALLBACK_STATUS" = "200" ] || { echo "FAIL: callback status=$CALLBACK_STATUS body=$(cat "$CALLBACK_RESP")"; exit 1; }
cat "$CALLBACK_RESP" | jq -e '.ok == true and .attemptId == "'"$ATTEMPT_ID"'" and (.deduped|type=="boolean")'

APPROVAL_REQ="$TMP_DIR/approval-request.json"
cat > "$APPROVAL_REQ" <<JSON
{"task_id":"$TASK_ID","pr_head_sha":"$CURRENT_SHA","review_request_hop":$REVIEW_REQUEST_HOP,"approved_by":"kernel-e2e-human"}
JSON

APPROVAL_RESP="$TMP_DIR/approval-response.json"
APPROVAL_STATUS=$(curl -sS -o "$APPROVAL_RESP" -w "%{http_code}" \
  -X POST "http://localhost:5221/api/brain/harness/kernel-reviews/$RUN_ID/approve" \
  -H "X-Approver-Token: $APPROVER_TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$APPROVAL_REQ")
[ "$APPROVAL_STATUS" = "202" ] || { echo "FAIL: approval status=$APPROVAL_STATUS body=$(cat "$APPROVAL_RESP")"; exit 1; }
cat "$APPROVAL_RESP" | jq -e '.ok == true and .run_id == "'"$RUN_ID"'" and .task_id == "'"$TASK_ID"'" and .pr_head_sha == "'"$CURRENT_SHA"'"'

DEADLINE=$((SECONDS + 60))
until psql "$DB_URL" -Atc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='${RUN_ID}'::uuid AND created_at > NOW() - interval '5 minutes'" | awk '{ exit ($1 >= 1 ? 0 : 1) }'; do
  [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: within 60s no fresh decision log evidence"; exit 1; }
  sleep 2
done

echo "OK: kernel preview CI authority current-SHA e2e completed"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| server-owned authority 只读真实记录 | `tests/kernel-preview-ci-authority.test.ts` | `忽略 caller-fed authority 字段` | → 期望 `preview_authority` 结构存在，当前实现返回 `undefined` |
| 负例 blocker 唯一性 | `tests/kernel-preview-ci-authority.test.ts` | `每个负例返回唯一 blocker` | → 期望 `preview_required_failure` 等精确 reason，当前 derive 未产出 |
| 新 SHA 让三权威同时失效 | `tests/kernel-preview-ci-authority.test.ts` | `新 commit 使 evaluator judge human approval 同时失效` | → 期望 `draft_authority_invalidated`，当前 derive 未产出 |
| 真实 callback route schema | `tests/kernel-preview-ci-authority.test.ts` | `callback route 强制 server-owned workflow identity` | → 期望 400/409 拒绝缺失 authority 绑定字段，当前路由会放过 |
