# Sprint Contract Draft (Round 1)

## 锚定父路声明

覆盖父路 `bb8cc561-b3ee-4fec-b74d-2255694bd963` 第 1-6 步。

## 范围与权威边界

本 Sprint 只修改 Kernel/Harness 的 attempt 结果通道和 GAN 反馈血缘，不改变 reviewer 的判断标准。权威来源仅为服务端创建的 `harness_attempts` 行、该 attempt 的受控结果通道、`harness_attempts.result` 和 append-only `orchestrator_decision_log`。工作树文件、客户端自报路径、prompt、stdout 散文均不具 authority。

## Response Schema（推导来源: PRD字面 + api_registry/现有 execution contract）

### Endpoint: `POST /api/brain/harness/attempts/:attemptId/callback`

这是既有端点的收紧，不新增公开端点。

**Success (HTTP 200)**:

```json
{"ok":true,"attemptId":"<uuid>","deduped":false}
```

- `ok` (boolean, 必填): 现有 callback 响应字段。
- `attemptId` (uuid string, 必填): 必须等于 URL 与服务端 attempt。
- `deduped` (boolean, 必填): 同一 canonical result 重放为 `true`，首写为 `false`。

**Error (HTTP 4xx)**:

```json
{"ok":false,"error":"<stable error code/message>"}
```

**禁用字段名**: `transcript`、`chain_of_thought`、`reasoning`、`messages`、`prompt`、`raw_output`、`token`、`password`、`secret`、`private_key`、`authorization`、`cookie`。

### Result file: `harness-result/reviewer-v1`

```json
{
  "contract_version": "1.0",
  "attempt_id": "<uuid>",
  "status": "completed",
  "summary": "<string>",
  "artifacts": [],
  "checks": [],
  "decision": {
    "outcome": "APPROVED | NEEDS_REVISION",
    "reason": "<string>",
    "binding": {
      "run_id": "<uuid>",
      "round": 1,
      "contract_sha": "<40-hex>"
    },
    "feedback": [
      {
        "id": "FB-001",
        "severity": "blocker | major | minor",
        "requirement": "<string>",
        "evidence": "<string>",
        "resolution_criteria": "<string>"
      }
    ],
    "rubric": [
      {
        "dimension": "<stable-name>",
        "score": 0,
        "max_score": 10,
        "reason": "<string>"
      }
    ]
  },
  "error": null,
  "provider_metadata": {
    "provider": "codex",
    "session_id": "<fresh-session-id>"
  }
}
```

硬限制：原始文件最大 `262144` bytes；`feedback` 最多 100 条，`rubric` 最多 16 条；描述字段按固定 UTF-8 code point 上限确定性截断并记录 `truncation`，但 `attempt_id/run_id/round/contract_sha/outcome/feedback.id` 永不截断。原始文件超限、schema 不符、禁用键或 secret 命中均拒绝，不得以截断掩盖非法输入。

服务端持久化时在 `harness_attempts.result` 增加只由服务端生成的保留字段：

```json
{
  "_authority": {
    "source": "attempt-result-channel",
    "channel_version": "attempt-result/v1",
    "sha256": "<64-hex canonical JSON digest>",
    "byte_length": 1234,
    "truncation": {}
  }
}
```

结果文件不得自带 `_authority`；自带即拒绝。decision log 只复制 `attempt_id/run_id/round/contract_sha/outcome/result_sha256` 和有界 summary，不复制完整 feedback/rubric；完整对象以 `harness_attempts.result` 为唯一持久化源。

所有 `constraints.read_only=true` 的新 attempt（reviewer/judge/reporter/canary 以及未来 read-only role）都必须在服务端 `task_bundle.constraints` 固化：

```json
{
  "result_channel": {
    "version": "attempt-result/v1",
    "required": true,
    "container_file": "/run/cecelia/harness-result/result.json",
    "max_bytes": 262144
  }
}
```

role-specific schema 仍由 `expected_output` 选择；reviewer 使用上面的严格扩展，其他 read-only role 使用其既有 HarnessResult schema，但共享同一固定路径/安全/清理/重放规则。

### 下一跳 TaskBundle 输入

round 2 proposer：

```json
{
  "prior_review": {
    "state": "bound",
    "source_attempt_id": "<uuid>",
    "run_id": "<uuid>",
    "review_round": 1,
    "contract_sha": "<40-hex>",
    "verdict": "NEEDS_REVISION",
    "feedback": [],
    "rubric": [],
    "result_sha256": "<64-hex>",
    "truncation": {}
  }
}
```

round 2 reviewer 还必须收到：

```json
{
  "prior_review": "<与 proposer 同一份不可变对象>",
  "resolution_map": {
    "source_review_attempt_id": "<uuid>",
    "source_contract_sha": "<40-hex>",
    "items": [
      {
        "feedback_id": "FB-001",
        "status": "resolved | unresolved | disputed",
        "evidence": "<artifact/test reference>"
      }
    ]
  }
}
```

round 2 proposer 的 authenticated attempt result 必须报告逐条 resolution claim，供服务端按 source review 重新校验后注入 reviewer：

```json
{
  "decision": {
    "resolution_map": {
      "source_review_attempt_id": "<uuid>",
      "source_contract_sha": "<40-hex>",
      "items": [
        {
          "feedback_id": "FB-001",
          "status": "resolved | unresolved | disputed",
          "evidence": "<artifact/test reference>"
        }
      ]
    }
  }
}
```

服务端要求 `items` 与 prior feedback id 完全集合相等、无重复；proposer claim 只是 reviewer 的待核验输入，不会自行把 feedback 标为已解决。

首轮只能是 `{"state":"no-history","reason":"first-round"}`。legacy attempt 只能是 `{"state":"no-history","reason":"legacy-unbound"}`。round > 1 的 v1 attempt 找不到精确绑定 reviewer result 时 fail-closed，禁止伪造成空反馈。

## 已知约束

- `[回归测试] packages/brain/src/orchestrator/__tests__/dispatcher.test.js` → `reviewer bundle 不继承 proposer transcript，且强制 fresh/read-only`
- `[回归测试] packages/brain/src/orchestrator/__tests__/dispatcher.test.js` → `proposer bundle 指定下一轮规范分支，避免产物落到共享任务分支`
- `[回归测试] packages/brain/src/orchestrator/__tests__/ground-truth.test.js` → `同时保留 propose tip SHA，且只接受锚定当前 SHA 的 reviewer verdict`
- `[回归测试] packages/brain/src/orchestrator/__tests__/ground-truth.test.js` → `task 作用域：跨 task 分支不计入`
- `[回归测试] packages/brain/src/orchestrator/__tests__/execution-contract.test.js` → `normalizes a skill-native reviewer verdict into the canonical decision fields`
- `[回归测试] packages/brain/src/orchestrator/__tests__/attempt-store.test.js` → attempt terminal write、lease fencing 与 replay dedupe 约束。
- `[累积FR]` context-manifest: unavailable（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回 404）；PRD 明确本 line 暂无历史。
- `[历史实证]` commit `920637070` 已将 reviewer verdict 持久化到 decision log；本 Sprint 不另建可变 verdict 账本。
- `[历史实证]` commit `5dd087cc3` 已以 contract SHA 冻结审批；本 Sprint 复用并收紧 run/round/SHA 绑定。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 为所有 read-only Harness 角色提供 attempt-scoped 可写结果通道；持久化完整 reviewer 结果并注入后续 fresh session。 |
| **NFR（做得多好）** | 性能/可靠性/容量 | 256 KiB 上限；callback 重放幂等；并发 run/attempt 隔离；绑定字段零截断；清理可恢复。 |
| **Invariant（永不违反）** | 安全/一致性/幂等 | authority 只来自服务端 attempt；run/round/SHA 必须精确；secret/CoT 不入账；人工批准前不 merge/deploy。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表。 |
| **保质期（何时过期）** | 数据/能力失效 | 结果通道在 terminal 持久化后立即清理；失败隔离目录最多保留 24h；attempt result/decision log 按现有审计保留策略。legacy 由 bundle capability 而非日期识别。 |
| **死亡告警（停了谁知道）** | 故障可见性 | non-first round 缺 authoritative result、清理连续失败或 callback 结构拒绝写稳定 error_code/计数；连续失败进入现有 Kernel 告警，主理人可按 attempt 查询。 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 绑定、路径、schema、secret、大小错误 fail-closed；同 digest replay 幂等；不同 digest 冲突 409；首轮/legacy 才允许显式 no-history。 |
| **效果确认（已发≠已生效）** | 真实生效回执 | 同时查 `harness_attempts.result` 完整字段、decision log 的 attempt/SHA/digest 锚点，以及下一跳持久化 task_bundle 中的 prior_review/resolution_map。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ non-first round 缺结果是否可降级 | A. 空反馈继续；B. fail-closed；C. 任意 no-history | B；仅首轮/legacy 明确 no-history | PRD 要求缺反馈不得静默降级 | 静默丢反馈导致 24+ 轮不收敛 |
| ⚠️ callback 是否属于当前合同 | A. 分支名；B. 客户端 SHA；C. 服务端 attempt bundle + 远端 tip SHA | C | authority 必须是服务端事实，且 stale SHA 必拒绝 | 旧合同被错误批准或覆盖新合同 |
| 结果是否为受控文件 | A. 信任客户端路径；B. 固定 server-owned root + `O_NOFOLLOW`/regular/nlink 校验 | B | 防路径逃逸、软链接、跨 attempt 读取 | 宿主 secret 泄露或结果串 run |
| 超限处理 | A. 全量截断；B. 原始文件拒绝，合法描述字段确定性截断 | B | binding/verdict 不可改变，容量又需确定性 | verdict/SHA 被截断后权威失真 |

notes:

- `judgment-pending-user: non-first round 缺结果是否可降级`
- `judgment-pending-user: callback 是否属于当前合同`
- `contract-gate: enabled (packages/brain/src/lib/contract-gate.js present)`

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 固定结果文件缺失/软链接/逃逸/跨 attempt | callback 不完成 attempt，记录稳定错误码 | 修复同 attempt 后可在 lease 内重试 | 无 |
| schema/secret/CoT/原始大小非法 | HTTP 400/409，禁止持久化 payload | 相同非法输入稳定失败 | 无 |
| terminal callback 同 digest 重放 | 返回 200 + `deduped:true`，不重复 decision log | 是，键=`attempt_id + result_sha256` | N/A |
| terminal callback 不同 digest 重放 | 409 `result_digest_conflict` | 否 | 人工调查 |
| round > 1 缺 authoritative prior review | 不派下一 proposer/reviewer，稳定 `feedback_lineage_missing` | recovery 重读 DB 后可恢复 | 仅首轮/legacy 显式 no-history |
| 清理失败 | 已持久化结果仍有效，记录 cleanup pending 并由 recovery 重试 | 是 | 目录隔离且 24h 后告警，不丢 DB authority |
| P0 首次 Controller contract 未人工批准 | merge/deploy gate deny | 批准记录写入后重试 | 无 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| read-only role 结果文件 | 不可信内容、受认证 attempt 容器 | 固定 JSON schema、禁 transcript/prompt/messages/reasoning、字符串与数组上限 | 禁止自报路径/run/round/SHA 取得 authority；与服务端绑定不符即拒绝 |
| remote bridge callback | 传输已认证但 payload 不可信 | callback token、lease owner、machine attestation、digest/schema 双验 | wrong attempt/provider/machine/digest 409 |
| legacy inline callback | 兼容但非反馈血缘 authority | 只走现有 result schema | 明确 `legacy-unbound no-history`，不得注入结构化 prior review |

## 真实调用方请求 shape

生产调用方为 Kernel local detached launcher 或 remote bridge，不是外部租户客户端：

- 认证：`Authorization: Bearer ${HARNESS_CALLBACK_TOKEN}`。
- fencing：`X-Harness-Lease-Owner: ${HARNESS_LEASE_OWNER}`。
- URL：`POST /api/brain/harness/attempts/${HARNESS_ATTEMPT_ID}/callback`。
- `Content-Type: application/json`。
- body 为固定结果通道读取并 canonicalize 后的 `HarnessResult`，`attempt_id` 必须与 URL/服务端 attempt 相同；客户端不得提交宿主绝对路径。
- local/remote launcher 都必须注入 `BRAIN_RESULT_FILE=/run/cecelia/harness-result/result.json`；只有服务端生成的 attempt 目录以 `rw` 挂载，工作树继续 `ro`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。测试只允许替换 GitHub/通知等更外层无关依赖；结果通道↔callback、callback↔真实 PostgreSQL、ground-truth↔dispatcher 不得 mock。）

## 禁 mock 边清单

- detached/remote launcher ↔ attempt-scoped result channel（本单修改 mount/env/文件消费，测试必须真建目录、真挂只读 workspace、真写固定结果文件）。
- result channel reader ↔ callback route（本单修改完整结果进入 callback 的数据传递，测试必须真读固定文件并调用真实 route）。
- callback route ↔ `harness_attempts`/`orchestrator_decision_log`（本单修改 DB 写路径，测试必须真 PostgreSQL 验证完整 result、digest 与幂等日志）。
- ground-truth ↔ dispatcher `buildInputs`（本单修改跨模块 feedback lineage，测试必须真读已持久化 attempt result 并构造下一跳 bundle）。
- approval gate ↔ merge/deploy handler（本单修改 P0 生命周期门禁，测试必须验证未批准时真实 handler 不执行 merge/deploy）。

## 接缝清单

1. 宿主/容器文件系统接缝：只读 `/workspace` + 单独 `rw` attempt result mount；用 local Docker RCI 真启动验证，未跑真 RCI 前状态为 `logic-done-pending`。
2. callback/真实 PostgreSQL 接缝：用隔离数据库迁移后真 POST callback，再用 `psql` 查 `harness_attempts.result` 和 decision log。
3. fresh-session 跨 attempt 接缝：从 round 1 persisted result 重建 ground truth，派 round 2 bundle 并检查 exact run/round/SHA/digest；不得从工作树读 reviewer 散文。

## Golden Path

Kernel 派发 read-only attempt → 受控结果通道收完整结构化结果 → callback 校验并持久化不可变事实 → ground truth 按 run/round/SHA 取 prior review → fresh-session proposer/reviewer 收反馈与 resolution map → APPROVED/人工审批进入同一审计链。

### Step 1: 为 read-only attempt 建立隔离结果通道

**来源**: `[FROM_PRD]` — Golden Path 1、DoD 1 与边界情况“路径逃逸、软链接绕行、跨 attempt 写入”。

**可观测行为**: `/workspace` 保持只读；每个 attempt 只有自身固定 `BRAIN_RESULT_FILE` 可写；不同 run/attempt 的宿主目录、mount 和文件不可互访。

**验证命令**:

```bash
bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario result-channel
```

**硬阈值**: 只读 workspace 写入非零退出；固定结果文件写入成功；逃逸、软链接、跨 attempt 读取 3 类均非零退出；命令总耗时 < 60s。

---

### Step 2: callback 校验并持久化完整 reviewer result

**来源**: `[FROM_PRD]` — Golden Path 2-3、DoD 2-3。

**可观测行为**: callback 只接受当前 attempt、lease、provider/machine、run/round/SHA、schema、大小与禁用内容都合格的 canonical result；完整 verdict/feedback/rubric/binding/digest 落 `harness_attempts.result`，decision log 写同 attempt/SHA/digest 锚点。

**验证命令**:

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario callback
```

**硬阈值**: 合法 callback HTTP 200；DB 在 5 分钟窗口内恰好 1 个 terminal attempt result 和 1 个 reviewer verdict log；非法输入 HTTP 4xx/409 且 DB 零写入。

---

### Step 3: replay、recovery、resume 与并发 run 保持隔离幂等

**来源**: `[FROM_PRD]` — Golden Path 3、DoD 5 与边界情况并发/replay/recovery/resume。

**可观测行为**: 同 attempt 同 digest 重放返回 `deduped:true` 且不增写日志；不同 digest 冲突；两个 run 不互读；recovery/resume 从 DB immutable result 恢复，不依赖已清理文件。

**验证命令**:

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario replay-isolation
```

**硬阈值**: 每 attempt 最多 1 个 authority result + 1 个 verdict log；跨 run 查询计数为 0；清理后 recovery 仍重建相同 `result_sha256`。

---

### Step 4: round 2 proposer/reviewer 获得精确反馈血缘

**来源**: `[FROM_PRD]` — Golden Path 4、DoD 4。

**可观测行为**: fresh-session proposer round 2 收到 round 1 reviewer 的完整 prior_review；reviewer round 2 收到同一 prior_review 与逐条 resolution map。所有对象绑定当前 run、上一 round、上一 contract SHA 和 source attempt。

**验证命令**:

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario round2-lineage
```

**硬阈值**: `prior_review.state=bound`；feedback/rubric 数量和值与 persisted result 一致；每个 feedback id 在 resolution map 恰好出现一次；session id 与上一 attempt 不同；stale/wrong binding 不派发。

---

### Step 5: missing、stale、敏感内容与 legacy 明确分路

**来源**: `[FROM_PRD]` — Golden Path 2、5 和全部边界情况。

**可观测行为**: v1 non-first round 缺文件/缺 feedback authority、wrong run/round、stale SHA、secret/CoT、超限均 fail-closed；首轮与 legacy rollout 仅输出可区分的 no-history reason。

**验证命令**:

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario invalid-and-legacy
```

**硬阈值**: 8 类非法输入全部非零/HTTP 4xx 或 409；首轮 reason=`first-round`；legacy reason=`legacy-unbound`；非法 payload 不出现在 `harness_attempts.result` 或 decision log。

---

### Step 6: APPROVED 与首次 P0 人工批准进入同一权威链

**来源**: `[FROM_PRD]` — Golden Path 5-6、DoD 8。

**可观测行为**: APPROVED 使用与 NEEDS_REVISION 相同的 channel/schema/binding/digest/persistence 路径；首次 Controller contract 变更强制 `review_required=true`，缺服务端人工批准记录时 merge/deploy handler 均不执行。

**验证命令**:

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario approved-human-gate
```

**硬阈值**: APPROVED 只有 SHA 匹配时 gate allow；`review_required=true` 且 `reviewApproved=false` 时 merge/deploy 调用计数均为 0；批准后才各执行 1 次。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous  
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

export DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
STARTED_AT=$(date +%s)
LOG_FILE=$(mktemp)

bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario all 2>&1 | tee "$LOG_FILE"
grep -q 'RESULT_CHANNEL_PASS' "$LOG_FILE"
grep -q 'CALLBACK_PERSISTENCE_PASS' "$LOG_FILE"
grep -q 'REPLAY_ISOLATION_PASS' "$LOG_FILE"
grep -q 'ROUND2_LINEAGE_PASS' "$LOG_FILE"
grep -q 'INVALID_LEGACY_PASS' "$LOG_FILE"
grep -q 'APPROVED_HUMAN_GATE_PASS' "$LOG_FILE"

npx vitest run \
  sprints/07272206-kernel-0cb0dd5b/tests/kernel-result-feedback-lineage.integration.test.ts \
  packages/brain/src/orchestrator/__tests__/execution-contract.test.js \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  packages/brain/src/orchestrator/__tests__/ground-truth.test.js \
  packages/brain/src/orchestrator/__tests__/attempt-store.test.js \
  packages/brain/src/orchestrator/__tests__/kernel-callback-flow.integration.test.js \
  packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js

ELAPSED=$(( $(date +%s) - STARTED_AT ))
[ "$ELAPSED" -lt 600 ] || { echo "FAIL: E2E ${ELAPSED}s >= 600s"; exit 1; }
echo "OK: Kernel reviewer result channel + feedback lineage E2E ${ELAPSED}s"
```

通过标准：脚本 exit 0；六个真实场景标记齐全；真实 PostgreSQL 与 callback/dispatcher 回归全绿；总耗时 < 600s。任一环境不可用、测试 skip 或稳定标记缺失均 FAIL。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| result channel | `sprints/07272206-kernel-0cb0dd5b/tests/kernel-result-feedback-lineage.integration.test.ts` | `read-only callback 持久化完整 reviewer 结果`；`路径逃逸、软链接、跨 attempt 与 secret fail-closed` | `result-channel.js` 尚不存在，suite FAIL |
| feedback lineage | 同上 | `fresh-session round 2 精确收到绑定反馈与 resolution map`；`stale SHA、wrong run/round、缺结果文件拒绝` | `feedback-lineage.js` 尚不存在，suite FAIL |
| authority/replay | 同上 | `并发 run、recovery、resume 与 callback 重放隔离幂等`；`APPROVED 走同一 authority 链` | schema/binding API 尚不存在，suite FAIL |
| rollout/security | 同上 | `legacy rollout 只产生显式 no-history`；`确定性截断保留 verdict/binding 且禁 transcript` | legacy/truncation 规则尚不存在，suite FAIL |
| release gate | 同上 | `首次 P0 review_required 在人工批准前阻断 merge deploy` | release projection 尚不存在，suite FAIL |

## 实现与版本同步约束

- 更新 `packages/brain/src/orchestrator/execution-contract.js`、`dispatcher.js`、`ground-truth.js`、`attempt-store.js`、`packages/brain/src/routes/harness-callback.js`、local/remote transport 与容器 mount/env。
- 新增 result-channel/feedback-lineage 实现及必要 additive migration；不得另建可变 verdict SSOT。
- 更新 `packages/brain/DEFINITION.md` 与 `packages/brain/package.json`，版本必须从 `1.267.94` 单调递增。
- 新增 `scripts/devgate/kernel-result-feedback-lineage-rci.sh`，并接入现有 RCI/DevGate；不修改未经本合同授权的共享 CI 判定逻辑。
- 代码提交前先提交 Red 测试并运行 `lint-tdd-commit-order` 与 `check-test-coverage`；Generator 只推分支/PR，不 merge。
