# Sprint Contract Draft (Round 3)

## Round 3 修订摘要

- 统一 DoD 中所有 BEHAVIOR 为 `Test: manual:bash` 可执行形态，删除非 bash 执行缩写，避免 evaluator 执行器解析分叉。
- 补齐 customer line 的正向签名 attestation oracle：只有签名 deployment/verification attestation verified 且 SHA 精确匹配后才允许 `promoted`。
- 保留 Round 2 已补强项：真实 Postgres/真实相邻模块边界、`initiative_runs.phase` CHECK 约束、replay 幂等 oracle、Promote API 认证后 DB 未突变断言。

## Response Schema（推导来源: PRD字面 + api_registry推导）

### Endpoint: GET /api/brain/harness/delivery/:delivery_id/status
**Success (HTTP 200)**:
```json
{
  "delivery_id": "uuid",
  "status": "staging_pending|staging_blocked|staging_failed|promote_pending|rollback_required|external_ack_pending|promoted|report_pending|report_failed|completed|failed",
  "run_id": "uuid",
  "task_id": "uuid",
  "pr_url": "string",
  "merged_sha": "string",
  "head_sha": "string",
  "contract_manifest_digest": "sha256:string",
  "tested_sha": "string|null",
  "promote_status": "string|null",
  "target_environment": "local_api",
  "parent": {
    "run_phase": "string",
    "task_status": "string"
  },
  "staging_child_payload": {
    "delivery_id": "uuid",
    "run_id": "uuid",
    "task_id": "uuid",
    "pr_url": "string",
    "merged_sha": "string",
    "head_sha": "string",
    "contract_manifest_digest": "sha256:string",
    "target_environment": "local_api"
  },
  "external_attestation": {
    "attestation_status": "verified|rejected|null",
    "verified_sha": "string|null"
  },
  "report": {
    "persisted": "boolean"
  }
}
```
- `delivery_id` (string, 必填): 来源--PRD 的同一 delivery id 绑定 S10-S12。
- `status` (string, 必填): 来源--PRD 的 delivery/staging/promote/report 终态权。
- `run_id` (string, 必填): 来源--PRD 要求 staging child 绑定 run_id。
- `task_id` (string, 必填): 来源--PRD 要求 staging child 绑定 task_id。
- `pr_url` (string, 必填): 来源--PRD 要求 staging child 绑定 PR URL。
- `merged_sha` (string, 必填): 来源--PRD 要求 exact tested SHA 对账 merged artifact。
- `head_sha` (string, 必填): 来源--PRD 要求 staging child 绑定 head SHA。
- `contract_manifest_digest` (string, 必填): 来源--PRD 要求 staging child 绑定 contract manifest digest。
- `tested_sha` (string|null, 必填): 来源--既有 staging_e2e_results.tested_sha + PRD fail-closed。
- `promote_status` (string|null, 必填): 来源--既有 staging_e2e_results.promote_status + PRD production terminal gate。
- `target_environment` (string, 必填): 来源--PRD target_environment=local_api。
- `parent.run_phase` / `parent.task_status` (string, 必填): 来源--PRD parent completion gate。
- `staging_child_payload` (object, 必填): 来源--真实调用方 `spawnStaging` payload shape。
- `external_attestation` (object, 必填): 来源--PRD customer line signed attestation。
- `report.persisted` (boolean, 必填): 来源--PRD final report persisted 后才 complete。
**禁用字段名**: ["ok_only", "promoted_by_only", "executor_success", "child_completed_success"]

**Error (HTTP 4xx)**:
```json
{"error": "string"}
```

### Endpoint: POST /api/brain/harness/promote/:resultId
**Request Shape**:
- Header `x-approver-token`: 必填，必须等于 Brain env `HARNESS_REVIEW_APPROVER_TOKEN`。
- Body `base_repo` (string), `promoted_by` (string), `tested_sha` (string), `production.health_ok` (boolean), `production.fingerprint_sha` (string), `production.e2e_ok` (boolean), `production.rollback_anchor` (string)。

**Success (HTTP 200)**:
```json
{"delivery_id": "uuid", "promote_status": "promoted|promote_failed|rollback_required", "rollback_anchor": "string|null"}
```
**禁用字段名**: ["promoted_by_only", "ok_only"]

### Endpoint: POST /api/brain/harness/delivery/:delivery_id/external-attestation
**Request Shape**:
- Header `x-approver-token`: 必填。
- Body `repo` (string), `deployment_id` (string), `deployed_sha` (string), `verified_sha` (string), `verification_url` (string), `attestation_signature` (string)。
- `attestation_signature` 必须覆盖 canonical JSON: `repo/deployment_id/deployed_sha/verified_sha/verification_url`，验签公钥来自 Brain env `HARNESS_CUSTOMER_ATTESTATION_PUBLIC_KEY` 或同等客户 repo 配置源；body 字段不得自带 public key 冒充信任根。

**Success (HTTP 202)**:
```json
{"delivery_id": "uuid", "attestation_status": "verified|rejected", "promote_status": "promoted|pending_external_attestation"}
```
**禁用字段名**: ["manual_confirm_promoted", "body.promoted_by_only"]

## 已知约束

- [回归测试] packages/brain/src/orchestrator/__tests__/kernel-handlers.test.js -> report 执行完整收尾链，最后才写 run/task done（本 sprint 必须反转为 delivery gate 后才 done）。
- [回归测试] packages/brain/src/__tests__/staging-e2e-runner.test.js -> 无合同当前是 SKIP no_contract，不触发 deploy；本 sprint 中 SKIP(no_contract) 不得映射 parent success。
- [回归测试] packages/brain/src/__tests__/staging-e2e-runner.test.js -> PASS 落库含 tested_sha；本 sprint 必须把 tested_sha 与 merged_sha 精确匹配改为 fail-closed。
- [回归测试] packages/brain/src/__tests__/staging-e2e-runner-promote.test.js -> customer PASS 当前 pending_promote；本 sprint 必须把人工 confirm 降级为 external_ack_pending，直到客户 repo 签名 attestation verified。
- [回归测试] packages/brain/src/routes/__tests__/harness-promote.test.js -> 现有 /promote/:resultId 未要求 x-approver-token；本 sprint 必须补认证并更新测试。
- [回归测试] packages/brain/migrations/238_harness_v2_initiative_runs.sql -> initiative_runs.phase CHECK 当前只允许 A_contract/B_task_loop/C_final_e2e/done/failed；本 sprint 必须迁移允许 delivery/staging_pending 等非终态，否则 parent 无法真实进入 delivery。
- [回归测试] packages/brain/src/staging-promote.js -> spawnHarnessReport 当前 best-effort 永不 throw；本 sprint 的 parent completion gate 必须以 report persisted 为准，不能以 dispatch 尝试成功为准。
- [累积FR] context-manifest: unavailable (HTTP returned non-JSON 404 page for journey bb8cc561-b3ee-4fec-b74d-2255694bd963).

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | Merge 后创建同一 delivery 状态机，S10 staging、S11 promote/attestation、S12 final report 全过后唯一 gate 原子完成 parent run/task。 |
| **NFR（做得多好）** | 性能/可靠性/并发阈值 | callback/promotion/report 重试幂等、append-only；全链重放不得重复 staging/promote/report；timeout_seconds=43200 内可恢复。 |
| **Invariant（永不违反）** | 安全/数据一致性/幂等 | parent run/task 在 staging/promote/report 任一环节未证实前不得 done/completed；tested_sha 缺失或不等于 merged_sha fail-closed；Promote API 必须认证 approver。 |
| **判定点（怎么知道）** | 模糊现实判断假设 | 见判定点登记表。 |
| **保质期（何时过期）** | 能力/数据/token 失效 | contract manifest digest 与 merged_sha 绑定本 delivery；approver token 由 Brain env 管理，轮换后旧请求失效；external attestation 只对同一 delivery_id/sha 有效。 |
| **死亡告警（停了谁知道）** | 停止工作后的告警 | staging/promote/report 失败写 delivery_events + parent 非成功状态，Internal rollback_required 发 Bark/Feishu；customer attestation 缺失保持 pending_external_attestation 可查询。 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试/降级 | fail-closed：FAIL/SKIP/no_contract/tested_sha mismatch/report dispatch failed 均不 complete parent；重试按 delivery_event idempotency key 去重。 |
| **效果确认（已发不等于已生效）** | 对外动作真实生效验证 | Internal production 以 health + fingerprint_sha == tested_sha + E2E PASS 确认；customer line 以签名 deployment/verification attestation 确认；final report 以 harness_report persisted 确认。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ staging tested_sha 是否代表 merged artifact | A. child executor success; B. staging_e2e_results.tested_sha 与 delivery.merged_sha 字面相等 | B | PRD 明确 exact tested SHA 匹配；executor success 不代表 artifact 被测 | 未经测试的 SHA 被 promote 到生产 |
| ⚠️ internal production 是否已生效 | A. promote 脚本 exit 0; B. health ok + production fingerprint_sha 等于 tested_sha + E2E PASS | B | PRD 要求 health/fingerprint/E2E 任一失败不得 promoted | 假上线，parent completed 后无人发现 |
| ⚠️ customer line 是否 promoted | A. Cecelia 人工 confirm; B. 客户 repo 签名 deployment/verification attestation verified | B | PRD 明确 confirm 只能记 pending external deployment acknowledgement | 本库 body.promoted_by 冒充客户生产 |
| final report 是否完成 | A. dispatch harness_report task; B. report persisted 且绑定同一 delivery_id | B | PRD 要求 final report persisted 后唯一 gate complete | report 丢失但 parent completed |

notes:
- judgment-pending-user: external attestation signature authority/public key 需由客户 repo owner 确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| staging SKIP(no_contract) | delivery.status=staging_failed 或 staging_blocked；parent task 非成功 | 是，idempotency_key=delivery_id + staging result id | 要求补合同后重跑 staging，不 complete |
| staging FAIL | delivery.status=staging_failed；parent run/task 回传 failed/blocked | 是，重复 callback 不追加重复结果 | 保留 failed_scenarios |
| tested_sha 缺失/不匹配 | fail-closed，禁止 promote | 是，按 delivery_id + tested_sha 去重 | 重新部署并重跑 staging |
| internal health/fingerprint/E2E fail | delivery.status=rollback_required/failed，记录 rollback_anchor | 是，rollback anchor append-only | 可执行 rollback，不 promoted |
| customer confirm 无 attestation | delivery.status=external_ack_pending，不 promoted | 是，同 confirm 重放不重复 | 等客户 repo 签名 attestation |
| report dispatch/persist fail | delivery.status=report_failed 或 report_pending，parent 不 complete | 是，按 delivery_id 去重 | 重试 report |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| Promote API body | 低 | 只读结构化字段，不拼 prompt | 缺/错 x-approver-token 401/503；body.promoted_by 不可代替认证 |
| Customer external attestation | 中 | 校验签名、repo、deployment_id、verified_sha | 签名不合法或 sha 不等于 delivery.merged_sha/tested_sha -> 409 rejected |
| staging callback/result | 中 | 只接受 schema 字段和 exit code，不信 executor_success | verdict 非 PASS 或 tested_sha 缺失/不匹配 -> fail-closed |

## 真实调用方请求 shape

### Kernel merge -> staging child payload
生产调用方为 `packages/brain/src/orchestrator/kernel-handlers.js` 的 `report(ctx)` 阶段调用 `deps.spawnStaging(...)`。当前已有字段为 `pr_url`, `pr_branch`, `sub_task_id`, `initiative_id`, `journey_id`, `base_repo`, `project_id`。本 sprint 必须扩展且保持字段字面一致：
```json
{
  "delivery_id": "uuid",
  "run_id": "uuid",
  "task_id": "uuid",
  "pr_url": "https://github.com/.../pull/4327",
  "pr_branch": "string",
  "merged_sha": "40-char sha",
  "head_sha": "40-char sha",
  "contract_manifest_digest": "sha256:...",
  "target_environment": "local_api",
  "base_repo": "perfectuser21/cecelia|customer repo",
  "journey_id": "uuid",
  "project_id": "uuid|null"
}
```
DoD 构造 staging child 时必须使用这些 payload 字段，不允许测试用 body `tenant_id` 或 `executor_success` 旁路。

### Promote / attestation API
真实人工/外部调用必须走 header 认证：
- `x-approver-token: $HARNESS_REVIEW_APPROVER_TOKEN`
- `Content-Type: application/json`
禁止仅通过 body `promoted_by`、`base_repo`、`confirm:true` 判定生产成功。

## Golden Path

覆盖父路 Kernel Delivery 第 1-5 步

### Step 1: Merge 后创建 delivery 并派 staging child
**来源**: `[FROM_PRD]` -- PRD Golden Path 第 1 步。

**可观测行为**: parent initiative_run.phase 进入 `delivery/staging_pending`，parent task 不为 `completed`；staging child payload 绑定 run_id、task_id、PR URL、merged/head SHA、contract_manifest_digest、target_environment。

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
DELIVERY_ID="${DELIVERY_ID:?set DELIVERY_ID from E2E setup}"
STATUS_JSON="$(curl -sf "$BRAIN_URL/api/brain/harness/delivery/$DELIVERY_ID/status")"
echo "$STATUS_JSON" | jq -e '.parent.run_phase=="delivery/staging_pending" and .parent.task_status!="completed" and (.merged_sha|test("^[0-9a-f]{40}$")) and (.head_sha|test("^[0-9a-f]{40}$")) and (.contract_manifest_digest|startswith("sha256:")) and .target_environment=="local_api"'
CHILD_COUNT="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
SELECT count(*) FROM tasks
WHERE task_type = 'staging_e2e'
  AND payload->>'delivery_id' = '$DELIVERY_ID'
  AND payload->>'run_id' = (SELECT run_id::text FROM harness_deliveries WHERE id = '$DELIVERY_ID')
  AND payload->>'task_id' = (SELECT task_id::text FROM harness_deliveries WHERE id = '$DELIVERY_ID')
  AND payload->>'merged_sha' = (SELECT merged_sha FROM harness_deliveries WHERE id = '$DELIVERY_ID')
  AND payload->>'contract_manifest_digest' = (SELECT contract_manifest_digest FROM harness_deliveries WHERE id = '$DELIVERY_ID')
  AND payload->>'target_environment' = 'local_api'
  AND created_at > NOW() - interval '5 minutes';" | tr -d ' ')"
[ "$CHILD_COUNT" -eq 1 ]
```

**硬阈值**: parent 不 completed；staging child payload 关键字段全部非空；target_environment 字面等于 `local_api`。

---

### Step 2: Staging PASS 才能 promote，所有 SKIP/FAIL/sha 异常 fail-closed
**来源**: `[FROM_PRD]` -- PRD Golden Path 第 2 步 + Proven-to-fire。

**可观测行为**: staging_e2e_results.verdict=PASS 且 tested_sha == merged_sha 时 delivery 才进入 `promote_pending`；SKIP(no_contract)、FAIL、tested_sha 缺失或不匹配均把 parent 回传到非成功状态。

**验证命令**:
```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
DELIVERY_ID="${DELIVERY_ID:?set DELIVERY_ID from E2E setup}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
SELECT count(*) FROM harness_deliveries d
JOIN staging_e2e_results s ON s.id = d.staging_result_id
WHERE d.id = '$DELIVERY_ID'
  AND d.status = 'promote_pending'
  AND s.verdict = 'PASS'
  AND s.tested_sha = d.merged_sha
  AND s.created_at > NOW() - interval '5 minutes';" \
  | tr -d ' ' | grep -qx '1'
```

**硬阈值**: promoted/pending promote 的前置行数必须正好 1 且带 5 分钟时间窗；任一 fail-closed fixture 的 parent task status 不能是 completed。

---

### Step 3: Internal production promote 必须 exact tested SHA + health/fingerprint/E2E
**来源**: `[FROM_PRD]` -- PRD Golden Path 第 3 步。

**可观测行为**: internal line 部署后，health ok、fingerprint_sha == tested_sha、production E2E PASS 才能 `promoted`；任一失败进入 `rollback_required` 或 `failed`，且保留 rollback_anchor。

**验证命令**:
```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
DELIVERY_ID="${DELIVERY_ID:?set DELIVERY_ID from E2E setup}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
SELECT count(*) FROM harness_delivery_events
WHERE delivery_id = '$DELIVERY_ID'
  AND event_type = 'production_verify_failed'
  AND detail ? 'rollback_anchor'
  AND created_at > NOW() - interval '5 minutes';" \
  | tr -d ' ' | grep -Eq '^[1-9][0-9]*$'
```

**硬阈值**: production failure path 必须有 rollback_anchor；失败 path 中 delivery.status 不得是 `promoted`。

---

### Step 4: Customer confirm 只记 pending，签名 attestation verified 后才 promoted
**来源**: `[FROM_PRD]` -- PRD Golden Path 第 4 步。

**可观测行为**: Cecelia 人工 confirm 后 delivery.status=`external_ack_pending`；只有客户 repo 签名 deployment/verification attestation 的 `verified_sha` 与 tested/merged SHA 一致后才 `promoted`。

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
CUSTOMER_DELIVERY_ID="${CUSTOMER_DELIVERY_ID:?set CUSTOMER_DELIVERY_ID}"
HARNESS_REVIEW_APPROVER_TOKEN="${HARNESS_REVIEW_APPROVER_TOKEN:?set HARNESS_REVIEW_APPROVER_TOKEN}"
CUSTOMER_ATTESTATION_SIGNATURE="${CUSTOMER_ATTESTATION_SIGNATURE:?set CUSTOMER_ATTESTATION_SIGNATURE}"
MERGED_SHA="${MERGED_SHA:?set MERGED_SHA}"
BODY="/tmp/customer-attestation-${CUSTOMER_DELIVERY_ID}.json"
CODE=$(curl -s -o "$BODY" -w "%{http_code}" -X POST "$BRAIN_URL/api/brain/harness/delivery/$CUSTOMER_DELIVERY_ID/external-attestation" \
  -H "Content-Type: application/json" \
  -H "x-approver-token: $HARNESS_REVIEW_APPROVER_TOKEN" \
  -d "{\"repo\":\"${CUSTOMER_REPO:-perfectuser21/zenithjoy-workspace}\",\"deployment_id\":\"deploy-$CUSTOMER_DELIVERY_ID\",\"deployed_sha\":\"$MERGED_SHA\",\"verified_sha\":\"$MERGED_SHA\",\"verification_url\":\"${CUSTOMER_VERIFICATION_URL:-https://github.com/perfectuser21/zenithjoy-workspace/actions/runs/e2e}\",\"attestation_signature\":\"$CUSTOMER_ATTESTATION_SIGNATURE\"}")
[ "$CODE" = "202" ]
jq -e '.attestation_status=="verified" and .promote_status=="promoted"' "$BODY" >/dev/null
curl -sf "$BRAIN_URL/api/brain/harness/delivery/$CUSTOMER_DELIVERY_ID/status" \
  | jq -e '.status=="promoted" and .external_attestation.attestation_status=="verified" and .external_attestation.verified_sha==.merged_sha' >/dev/null
COUNT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
SELECT count(*) FROM harness_delivery_events
WHERE delivery_id = '$CUSTOMER_DELIVERY_ID'
  AND event_type = 'external_attestation_verified'
  AND detail->>'verified_sha' = (SELECT merged_sha FROM harness_deliveries WHERE id = '$CUSTOMER_DELIVERY_ID')
  AND created_at > NOW() - interval '5 minutes';" | tr -d ' ')
[ "$COUNT" -eq 1 ]
```

**硬阈值**: body.promoted_by 或 confirm:true 不足以 promoted；签名/sha 任一不合法返回 409 或保持 pending。

---

### Step 5: Final report persisted 后唯一 gate 原子 complete parent
**来源**: `[FROM_PRD]` -- PRD Golden Path 第 5 步。

**可观测行为**: success/failure report、handoff、learning、OKR/commitment map 均绑定同一 delivery_id；只有 internal production verified 或 external attestation verified 且 final report persisted 后，parent run/task 在同一事务内 complete。

**验证命令**:
```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
DELIVERY_ID="${DELIVERY_ID:?set DELIVERY_ID from E2E setup}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
SELECT count(*) FROM harness_deliveries d
JOIN initiative_runs r ON r.id = d.run_id
JOIN tasks t ON t.id = d.task_id
WHERE d.id = '$DELIVERY_ID'
  AND d.status = 'completed'
  AND d.final_report_id IS NOT NULL
  AND r.phase = 'done'
  AND t.status = 'completed'
  AND d.completed_at > NOW() - interval '5 minutes';" \
  | tr -d ' ' | grep -qx '1'
```

**硬阈值**: report dispatch/persist 失败时 count 必须为 0；成功时 count 正好 1。

---

### Step 6: Replay 幂等与 PR#4327/#4317 快照回归
**来源**: `[FROM_PRD]` -- Proven-to-fire 边界情况。

**可观测行为**: PR#4327/#4317 parent completed + staging queued 快照在新审计函数下 FAIL；重复 staging/promote/report callback 不新增重复记录。

**验证命令**:
```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
DELIVERY_ID="${DELIVERY_ID:?set DELIVERY_ID from E2E setup}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
SELECT count(*) FROM (
  SELECT idempotency_key
  FROM harness_delivery_events
  WHERE delivery_id = '$DELIVERY_ID'
    AND idempotency_key IN ('staging-pass', 'promote-pass', 'report-pass')
  GROUP BY idempotency_key
  HAVING count(*) > 1
) dup;" \
  | tr -d ' ' | grep -qx '0'
node --input-type=module -e "import('./packages/brain/src/delivery-terminal-authority.js').then(async m=>{for(const pr_number of [4327,4317]){const r=await m.auditLegacyCompletionFixture({pr_number,parent_task_status:'completed',run_phase:'done',staging_task_status:'queued',staging_result:null});if(r.verdict!=='FAIL'||!/parent_completed_before_staging|staging queued/i.test(r.reason||'')||r.may_rewrite_history!==false)process.exit(1)}})"
```

**硬阈值**: 每个 idempotency_key 最多一行；legacy bad fixture audit verdict 必须 FAIL。

## 接缝清单

- Merge handler -> staging child payload：真实世界点是 PR merge 后的 Kernel 状态机派发；验证方式为真实 DB 中 parent run/task 不 complete 且 staging task payload 含 sha/digest/environment。
- Staging result -> promote gate：真实世界点是 staging_e2e_results 写入后触发 promotion；验证方式为真 Postgres 比较 tested_sha 与 merged_sha，SKIP/FAIL/no_contract 均 fail-closed。
- Promote/attestation/report -> parent completion：真实世界点是生产健康/客户签名/报告持久化；验证方式为 API auth + DB 事务 + delivery_events append-only。

## 禁 mock 边清单

- `packages/brain/src/orchestrator/kernel-handlers.js` report handler -> `deps.spawnStaging` / tasks / initiative_runs（本单改 Merge 后 parent completion authority，测试不得 mock 掉 parent 状态写入边）。
- `packages/brain/src/staging-e2e-runner.js` -> `staging_e2e_results` / new `harness_deliveries`（本单改 staging result 到 delivery 状态传递，测试必须真 Postgres 验行）。
- `packages/brain/src/routes/harness.js` promote/attestation route -> `authenticateApprover` -> DB transaction（本单改认证与生产终态，测试不得用 body.promoted_by 代替 header auth）。
- `packages/brain/src/staging-promote.js` report spawning -> tasks(harness_report) -> parent completion gate（本单改 report persisted 前 parent 不 complete，测试不得 mock report 成功）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；internal production 的 HK/health/fingerprint 使用 local_api 可执行 oracle 与 rollback anchor 验证，customer production 使用签名 attestation oracle。）

## 失败语义声明

- `SKIP(no_contract)`、`FAIL`、`tested_sha_missing`、`tested_sha_mismatch`: parent run/task 非成功，delivery.status in (`staging_failed`, `staging_blocked`, `failed`)。
- `internal_promote_health_failed`、`fingerprint_mismatch`、`production_e2e_failed`: delivery.status=`rollback_required` 或 `failed`，必须有 rollback_anchor。
- `customer_confirm_without_attestation`: delivery.status=`external_ack_pending`，promote_status 不得 `promoted`。
- `report_dispatch_failed` 或 `report_persist_failed`: delivery.status=`report_pending` 或 `report_failed`，parent 不 complete。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RUN_ID="$(node -e "console.log(require('crypto').randomUUID())")"
TASK_ID="$(node -e "console.log(require('crypto').randomUUID())")"
MERGED_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OTHER_SHA="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
PR_URL="https://github.com/perfectuser21/cecelia/pull/4327"
DIGEST="sha256:delivery-terminal-authority-contract"
export DB_URL BRAIN_URL RUN_ID TASK_ID PR_URL MERGED_SHA OTHER_SHA DIGEST

curl -sf "$BRAIN_URL/api/brain/health" | jq -e '.status=="ok" or .ok==true' >/dev/null

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO tasks (id, title, description, task_type, status, payload)
VALUES ('$TASK_ID', 'delivery terminal authority e2e', 'contract e2e', 'harness_initiative', 'in_progress', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO initiative_runs (id, initiative_id, phase, current_task_id)
VALUES ('$RUN_ID', '$TASK_ID', 'B_task_loop', '$TASK_ID')
ON CONFLICT (id) DO NOTHING;
SQL

DELIVERY_ID="$(node --input-type=module <<'NODE'
import { createDeliveryFromMerge } from './packages/brain/src/delivery-terminal-authority.js';
const result = await createDeliveryFromMerge({
  dbUrl: process.env.DB_URL,
  run_id: process.env.RUN_ID,
  task_id: process.env.TASK_ID,
  pr_url: process.env.PR_URL,
  merged_sha: process.env.MERGED_SHA,
  head_sha: process.env.MERGED_SHA,
  contract_manifest_digest: process.env.DIGEST,
  target_environment: 'local_api',
  base_repo: 'perfectuser21/cecelia',
});
console.log(result.delivery_id);
NODE
)"

export DELIVERY_ID

curl -sf "$BRAIN_URL/api/brain/harness/delivery/$DELIVERY_ID/status" \
  | jq -e '.parent.run_phase=="delivery/staging_pending" and .parent.task_status!="completed" and .merged_sha==env.MERGED_SHA'

node --input-type=module <<'NODE'
import {
  applyStagingResult,
  applyProductionResult,
  persistFinalReportAndComplete,
  replayDeliveryEvent,
} from './packages/brain/src/delivery-terminal-authority.js';

await applyStagingResult({
  dbUrl: process.env.DB_URL,
  delivery_id: process.env.DELIVERY_ID,
  verdict: 'PASS',
  tested_sha: process.env.MERGED_SHA,
  idempotency_key: 'staging-pass',
});
await applyProductionResult({
  dbUrl: process.env.DB_URL,
  delivery_id: process.env.DELIVERY_ID,
  line: 'internal',
  tested_sha: process.env.MERGED_SHA,
  health_ok: true,
  fingerprint_sha: process.env.MERGED_SHA,
  e2e_ok: true,
  rollback_anchor: 'prod-before-delivery-terminal-authority',
  idempotency_key: 'promote-pass',
});
await persistFinalReportAndComplete({
  dbUrl: process.env.DB_URL,
  delivery_id: process.env.DELIVERY_ID,
  report_id: 'report-delivery-terminal-authority',
  handoff_id: 'handoff-delivery-terminal-authority',
  learning_id: 'learning-delivery-terminal-authority',
  okr_commitment_map_id: 'okr-delivery-terminal-authority',
  idempotency_key: 'report-pass',
});
await replayDeliveryEvent({
  dbUrl: process.env.DB_URL,
  delivery_id: process.env.DELIVERY_ID,
  event_type: 'report_persisted',
  idempotency_key: 'report-pass',
});
NODE

psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
SELECT count(*) FROM harness_deliveries d
JOIN initiative_runs r ON r.id = d.run_id
JOIN tasks t ON t.id = d.task_id
WHERE d.id = '$DELIVERY_ID'
  AND d.status = 'completed'
  AND d.final_report_id IS NOT NULL
  AND r.phase = 'done'
  AND t.status = 'completed'
  AND d.completed_at > NOW() - interval '5 minutes';" \
  | tr -d ' ' | grep -qx '1'

psql "$DB_URL" -v ON_ERROR_STOP=1 -t -c "
SELECT count(*) FROM (
  SELECT idempotency_key
  FROM harness_delivery_events
  WHERE delivery_id = '$DELIVERY_ID'
    AND idempotency_key = 'report-pass'
  GROUP BY idempotency_key
  HAVING count(*) > 1
) dup;" \
  | tr -d ' ' | grep -qx '0'

echo "Golden Path local_api delivery terminal authority passed"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| delivery 状态机 | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | Merge 后 parent 进入 delivery/staging_pending 且 staging child 绑定 merge manifest | missing module/export 或 parent 仍 completed |
| staging fail-closed | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | staging SKIP(no_contract) 不得 success 且 parent 保持 blocked | 当前 SKIP 可被当作非失败 |
| SHA gate | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | tested_sha 缺失或不等于 merged_sha 必须 fail-closed | 当前缺失/漂移可能 pending/promote |
| executor success false authority | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | staging child completed+executor success 不得替代 PASS | 当前 child completed+executor success 可被当交付成功 |
| production rollback | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | Internal production health/fingerprint/E2E 失败进入 rollback_required 且带 rollback anchor | 当前 promote best-effort/report 仍可完成 |
| customer attestation | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | customer confirm 无签名 attestation 不得 promoted | 当前 body promoted_by 可标 promoted |
| customer attestation positive | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | customer repo 签名 deployment attestation verified 后才 promoted | 当前缺少客户 repo 签名验真链路 |
| report gate | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | report dispatch失败不得 parent complete; persisted 后 atomically complete | 当前 report dispatch best-effort 后 parent 仍可 completed |
| replay idempotency | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | 重放同一 staging/promote/report 事件不重复 | 当前 staging/promote/report 幂等粒度不足 |
| fixture audit | `sprints/07271908-kernel-delivery-terminal-authority/tests/delivery-terminal-authority.test.ts` | PR4327 PR4317 parent completed + staging queued fixture 在审计中 FAIL | 当前生产快照会被视为已完成 |

## notes

- contract-gate: active (`packages/brain/src/lib/contract-gate.js` present).
- target_environment: local_api.
- 不得修改历史生产行；PR#4327/#4317 只可作为只读 fixture。
- 不得修改、复用、合并 PR #4372。
