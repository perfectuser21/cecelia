# Sprint Contract Draft (Round 1)

## 锚定父路声明

覆盖父路 `bb8cc561-b3ee-4fec-b74d-2255694bd963` 第 1-5 步。

## 范围与历史证据

本 Sprint 只恢复 Kernel read-only 结果通道与 reviewer feedback lineage。旧任务
`0cb0dd5b` 的合同 commit `6f184cd0817f2c9302ffc3a2020c5bf70e798fe7` 和 reviewer
attempt `63ef1610-6742-4a76-9d60-4c58c2681833` 仅是 recovery 证据；本 run 第一轮仍是
`no-history:first-round`，不继承旧 verdict 或批准。

旧 Reviewer/audit 反馈在本合同中的一一解决映射：

| 反馈 | 本轮解决 |
|---|---|
| FB-001：合同过大、重复 invariant/N/A filler | 收敛为 5 个 Golden Path Step 与 5 条 BEHAVIOR；铁律只保留本单适用映射，其余按名称一次性显式 N/A。 |
| FB-001：callback 错误断言不完整 | Step 2 要求逐例断言 HTTP 状态、精确 `{ok:false,error:{key,code}}`、稳定 key/code 与禁区字段零反射。 |
| FB-002：RCI 在 Red 审批前不存在 | 将 `scripts/harness/rci-reviewer-feedback-lineage.sh` 列为 Generator artifact；Red 测试明确证明其尚未交付；Green 后先 `bash -n` 再真实执行。 |
| AUDIT-001：验证可能误连生产库 | 所有命令只接受显式 `TEST_DATABASE_URL`；库名须以 `_test` 结尾或以 `preview_` 开头，并在任何 mutation 前核验 `current_database()` 与 `inet_server_addr()`。 |

## Response Schema（推导来源: PRD 字面 + 现有 attempt callback）

### Endpoint: `POST /api/brain/harness/attempts/:attemptId/callback`

这是既有端点的收紧，不新增 verdict ledger 或平行 approval API。

**Success (HTTP 200)**:

```json
{"ok":true,"attemptId":"<uuid>","deduped":false}
```

- `ok` (boolean, 必填): 必须为 `true`。
- `attemptId` (uuid string, 必填): 必须等于 URL 与 server-owned attempt。
- `deduped` (boolean, 必填): 首次持久化为 `false`，同 digest 重放为 `true`。

**Error (HTTP 4xx/5xx)**:

```json
{"ok":false,"error":{"key":"invalid_result","code":"REVIEW_RESULT_INVALID"}}
```

顶层 keys 必须精确为 `["error","ok"]`，`error` keys 必须精确为 `["code","key"]`。
稳定映射：

| HTTP | `error.key` | `error.code` | 适用 |
|---:|---|---|---|
| 400 | `invalid_result` | `REVIEW_RESULT_INVALID` | schema、超限、禁区字段或 digest 无效 |
| 401 | `unauthorized` | `ATTEMPT_CREDENTIAL_INVALID` | token 无效 |
| 404 | `not_found` | `ATTEMPT_NOT_FOUND` | server-owned attempt 不存在 |
| 409 | `attempt_conflict` | `ATTEMPT_SCOPE_MISMATCH` | lease/provider/attempt/run/round/SHA 不匹配、跨 attempt、不同 digest 重放 |
| 409 | `lineage_missing` | `PRIOR_REVIEW_MISSING` | 非首轮精确历史缺失 |
| 500 | `persistence_failed` | `CALLBACK_PERSISTENCE_FAILED` | 原子持久化失败 |

**禁止响应/日志字段名**:
`secret`、`token`、`authorization`、`cookie`、`password`、`private_key`、
`transcript`、`chain_of_thought`、`reasoning`、`prompt`、`messages`、`raw_output`。
错误响应和日志不得反射请求值或这些字段的内容。

### Reviewer result: `harness-result/reviewer-v1`

```json
{
  "contract_version": "1.0",
  "attempt_id": "<uuid>",
  "status": "completed",
  "summary": "<最多1000字符>",
  "artifacts": [],
  "checks": [],
  "decision": {
    "outcome": "APPROVED | REVISION",
    "reason": "<最多2000字符>",
    "review": {
      "run_id": "<uuid>",
      "round": 1,
      "contract_sha": "<40-hex>",
      "digest": "<64-hex sha256>",
      "feedback": [
        {"id":"FB-001","text":"<最多4000字符>","evidence":"<最多4000字符>"}
      ],
      "rubric": {
        "dod_machineability": 0,
        "scope_match_prd": 0,
        "test_is_red": 0,
        "internal_consistency": 0,
        "risk_registered": 0,
        "verification_oracle_completeness": 0,
        "ci_workflow_alignment": 0
      }
    }
  },
  "error": null,
  "provider_metadata": {"provider":"codex","session_id":"<fresh-session-id>"}
}
```

原始 JSON 上限 `65536` bytes；feedback 最多 32 条且 id 唯一；rubric 必须恰好是上述
7 维、每项为 0..10 整数。server 以 canonical JSON 重算 `digest` 并要求相等；server-owned
TaskBundle 的 attempt/run/round/contract SHA 才是 authority，worker 自报不能覆盖。

下一轮 proposer 接收：

```json
{"prior_review":{"state":"bound","source_attempt_id":"<uuid>","outcome":"REVISION","run_id":"<uuid>","round":1,"contract_sha":"<40-hex>","digest":"<64-hex>","feedback":[],"rubric":{}}}
```

下一轮 reviewer 接收相同 `prior_review`，另含：

```json
{"resolution_map":[{"feedback_id":"FB-001","status":"resolved|unresolved|disputed","evidence":"<当前合同SHA锚定证据>"}]}
```

`resolution_map` 的 feedback id 集合必须与 prior feedback id 集合完全相等、无重无漏。
首轮固定为 `{"state":"no-history","reason":"first-round"}`；legacy 固定为
`{"state":"no-history","reason":"legacy-unbound"}`；round > 1 缺绑定历史必须拒绝派发。

## 已知约束

- `[回归测试] dispatcher.test.js` → `reviewer bundle 不继承 proposer transcript，且强制 fresh/read-only`
- `[回归测试] dispatcher.test.js` → `proposer bundle 指定下一轮规范分支，避免产物落到共享任务分支`
- `[回归测试] ground-truth.test.js` → `同时保留 propose tip SHA，且只接受锚定当前 SHA 的 reviewer verdict`
- `[回归测试] attempt-store.test.js` → `终态写入只接受一次，重复 callback 返回 deduped`
- `[回归测试] harness-attempt-callback.test.js` → callback token、lease、provider、attempt 与 reviewer round/SHA 已由服务端锚定
- `[回归测试] harness-kernel-approvals.test.js` → 人工审批复用 current-head 与 server-owned review request
- `[累积FR] context-manifest: unavailable (HTTP 404)`；PRD 明示本 line 暂无历史
- `[历史证据] 旧 commit/attempt 只供 recovery 对照，不是本 run 的 approval authority`

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | read-only role 在 `/workspace:ro` 下获得 attempt-scoped writable result；callback 持久化绑定 review；后续 fresh session 获得精确 lineage。 |
| NFR | 64 KiB；feedback≤32；7 维 rubric；同 digest 幂等；跨 run/round/attempt/SHA 隔离。 |
| Invariant | authority 只来自 server-owned attempt、现有 decision log 与 current-head human approval；不建第二 verdict ledger。 |
| 判定点 | run/round/SHA/digest 全等才属于当前 review；非首轮缺历史 fail-closed。 |
| 保质期 | result channel 仅当前 attempt lease 有效；terminal 后以 DB result/decision log 回放。 |
| 死亡告警 | result/lineage/persistence 失败使用稳定 code，进入现有 Kernel 失败与人工 review 通道。 |
| 失败语义 | 非法输入不写 DB；同 digest replay 200 deduped；不同 digest 409；首轮/legacy 仅显式 no-history。 |
| 效果确认 | 查 attempt result + reviewer decision log + 下一跳持久化 TaskBundle；merge/deploy 另查精确 final SHA 人工批准。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ review 是否属于当前合同 | 客户端自报；server attempt；server attempt + current contract SHA | server attempt + current contract SHA | PRD 已明确 current-head binding | stale review 放行 |
| ⚠️ 非首轮缺历史是否继续 | 空反馈继续；fail-closed | fail-closed | PRD 已明确 | 反馈静默丢失 |

上述两点已由冻结 PRD 拍板，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等 | 降级 |
|---|---|---|---|
| 认证/路径/shape/binding/敏感/超限失败 | 对应 4xx，DB 零写入 | 相同非法输入稳定失败 | 无 |
| 同 attempt 同 digest 重放 | 200 + `deduped:true` | 是 | 无 |
| 同 attempt 不同 digest 或非首轮缺历史 | 409 | recovery 可重读既有 authority | 无 |
| DB 原子写失败 | 500，attempt 不伪装完成 | 是 | 人工处置 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权拒绝 |
|---|---|---|---|
| role result JSON | 不可信 | 严格 schema、限长、禁 transcript/CoT/prompt/messages | 自报 path/run/round/SHA 不能取得 authority |
| callback transport | 已认证但 payload 不可信 | token + lease + provider/machine + digest 双验 | 任何 scope mismatch 409 |

## 真实调用方请求 shape

- URL：`POST /api/brain/harness/attempts/${HARNESS_ATTEMPT_ID}/callback`
- 认证：`Authorization: Bearer ${HARNESS_CALLBACK_TOKEN}`
- fencing：`X-Harness-Lease-Owner: ${HARNESS_LEASE_OWNER}`
- `Content-Type: application/json`
- body：provider 由 attempt-scoped output path 读出的 `HarnessResult`；`attempt_id` 与 URL 完全相同
- `/workspace` 继续只读；仅 server 为当前 attempt 派生的 result path 可写，客户端不可提交任意宿主路径

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。无第三方 API；GitHub 只用于 current-head 读取，不是可 mock 的审批 authority。）

## 禁 mock 边清单

- local/remote launcher ↔ attempt-scoped result path
- result parser/callback route ↔ `harness_attempts` 与 `orchestrator_decision_log`（真 PostgreSQL）
- ground-truth ↔ dispatcher TaskBundle
- human review decision log ↔ merge/deploy current-head gate

## 接缝清单

1. 容器文件系统：`/workspace:ro` 与独立 result path；RCI 真执行前为 `logic-done-pending`。
2. callback/DB：仅在显式隔离 `_test|preview_*` 数据库真验。
3. fresh-session lineage：从已持久化 attempt/result 重建，不从 transcript 或旧工作树取值。

## Golden Path

Kernel 创建 read-only attempt → 角色写 attempt result → callback 原子持久化绑定 review →
ground truth/dispatcher 注入精确 lineage → 现有 current-head 人工门决定 release。

### Step 1: 创建 attempt-scoped 可写结果通道

**来源**: `[FROM_PRD]` — Golden Path 第 1 步。

**可观测行为**: dispatcher 枚举中每个 `readOnly=true` role（当前为 reviewer、judge、reporter/
canary，未来新增 read-only role 也自动继承）均保持 `/workspace:ro`，仅当前 attempt 的固定
result path 可写；路径逃逸、symlink、跨 attempt 访问均拒绝。

**验证命令**:

```bash
bash scripts/harness/rci-reviewer-feedback-lineage.sh result-channel
```

**硬阈值**: 每个 read-only role 的固定 path 写入 exit 0；workspace/逃逸/symlink/跨
attempt 四类均非零；任一 read-only role 缺 channel 即 FAIL。

### Step 2: callback 校验并持久化有界 reviewer result

**来源**: `[FROM_PRD]` — Golden Path 第 2 步及边界情况。

**可观测行为**: 合法 callback 只写当前 attempt；每个拒绝路径返回约定 HTTP 与精确 error
shape，且响应/日志不反射禁区字段。

**验证命令**:

```bash
bash scripts/harness/rci-reviewer-feedback-lineage.sh callback
```

**硬阈值**: 合法首写 200；非法场景分别为 400/401/404/409；错误 body keys 精确；
5 分钟内 attempt result 与 reviewer decision log 各恰好 1 条。

### Step 3: 将精确 prior review 与 resolution map 注入 fresh session

**来源**: `[FROM_PRD]` — Golden Path 第 3 步。

**可观测行为**: round 2 proposer 得到 round 1 exact `prior_review`；round 2 reviewer 得到
同一对象和 feedback id 一一对应的 `resolution_map`；session id 不复用。

**验证命令**:

```bash
bash scripts/harness/rci-reviewer-feedback-lineage.sh lineage
```

**硬阈值**: run/round/SHA/digest/feedback/rubric 逐字段相等；resolution id 集合完全相等；
round > 1 缺历史非零失败；首轮与 legacy reason 可区分。

### Step 4: replay/recovery/resume 与并发 run 隔离幂等

**来源**: `[FROM_PRD]` — Golden Path 第 4 步。

**可观测行为**: 同 digest replay 不增写；不同 digest、wrong run/round、stale SHA、敏感或
超限输入不污染 DB；recovery/resume 只回放自身 authority。

**验证命令**:

```bash
bash scripts/harness/rci-reviewer-feedback-lineage.sh isolation
```

**硬阈值**: 两个并发 run 交叉读取为 0；同 attempt authority/log 各最多 1；8 类拒绝均
fail closed。

### Step 5: APPROVED 与 release 复用现有 authority

**来源**: `[FROM_PRD]` — Golden Path 第 5 步。

**可观测行为**: APPROVED 走与 REVISION 相同的 attempt/run/round/SHA/digest 写链；任务保持
`review_required=true`；无精确 final SHA 的 server-owned human approval 时 merge/deploy
均不执行。

**验证命令**:

```bash
bash scripts/harness/rci-reviewer-feedback-lineage.sh authority
```

**硬阈值**: stale approval 永不 allow；人工批准前 merge/deploy 调用数 0；精确批准后才为 1；
不存在新 verdict 表或可变 approval 文件。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

: "${TEST_DATABASE_URL:?必须显式提供隔离 TEST_DATABASE_URL，禁止生产式 DSN fallback}"
DB_PROBE=$(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text,'unix-socket')")
IFS='|' read -r TEST_DB_NAME TEST_DB_ADDR <<EOF
$DB_PROBE
EOF
case "$TEST_DB_NAME" in
  preview_*|*_test) ;;
  *) echo "FAIL: 拒绝非隔离数据库 $TEST_DB_NAME"; exit 1 ;;
esac
[ -n "$TEST_DB_ADDR" ] || { echo "FAIL: inet_server_addr() 未核验"; exit 1; }

test -f scripts/harness/rci-reviewer-feedback-lineage.sh
bash -n scripts/harness/rci-reviewer-feedback-lineage.sh
TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  bash scripts/harness/rci-reviewer-feedback-lineage.sh all
npx vitest run \
  sprints/07272225-kernel-225d8ea7/tests/kernel-reviewer-feedback-lineage.contract.test.ts
```

通过标准：RCI 自己在任何 mutation 前重复核验 `current_database()/inet_server_addr()`；
五场景均真执行、无 skip、exit 0。不可达或非隔离 DB 直接 FAIL。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| result channel | `sprints/07272225-kernel-225d8ea7/tests/kernel-reviewer-feedback-lineage.contract.test.ts` | `attempt-scoped result channel 拒绝逃逸、symlink 与跨 attempt` | result-channel API 尚未满足，FAIL |
| callback error | 同上 | `callback error 返回精确稳定 shape 且不反射 forbidden fields` | structured callback error API 尚未实现，FAIL |
| lineage | 同上 | `round 2 注入 exact prior_review 与一一对应 resolution_map` | feedback-lineage API 尚未实现，FAIL |
| authority | 同上 | `APPROVED 仍由 current-head 人工 authority 阻断 release` | lineage/release projection 尚未实现，FAIL |
| RCI | 同上 | `Generator 交付的 RCI 先过 bash -n 再真实执行` | 指定脚本在 Red 阶段不存在，FAIL |

## 历史铁律映射（去重）

- 适用并由 Step 1-5/RCI 覆盖：`语义成功`、`真实退出码`、`命令真跑`、`多轮状态`、
  `字段有界`、`显式失败`、`表名认领`、`真实消费方`、`未知值同义`、`Ref校验`、
  `测试隔离`、`部署失败`、`生产自报`、`异步测试`、`合同表格`、`Red精确提交`、
  `接线回归`、`合并权`、`历史核对`、`共享禁区`、`提前合并`、`Brain冒烟`、
  `环境推导`、`真环境`、`多租户测试`、`凭据安全`、`日志脱敏`、`端点鉴权`、`租户隔离`。
- 显式 N/A（本单不触及，且不复制为重复 checkbox filler）：`watchdog_overdue恢复`、
  `advisory fixAvailable`、`headed心跳/接管/点火`、`付费调用`、`跨模块时间常数`、
  `Judge格式`、`退役/报告/后台job/多端/cron/task_type/常驻服务/launchd/容量槽` 及五条重复冒烟
  占位铁律。相关既有回归必须保持绿。

notes:

- `contract-gate: enabled (packages/brain/src/lib/contract-gate.js present)`
- `logic-done-pending: result channel、真 PostgreSQL 与 fresh-session 接缝须由 Generator RCI 真验`
