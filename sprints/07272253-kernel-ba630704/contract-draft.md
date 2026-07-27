# Sprint Contract Draft（Round 1）

## Response Schema（推导来源: PRD 字面 + 现有 HarnessResult v1）

### Endpoint: `POST /api/brain/harness/attempts/:attemptId/callback`

**Success (HTTP 200)**:

```json
{"ok":true,"attemptId":"<uuid>","deduped":false}
```

- `ok`（boolean，必填）：沿用现有 callback。
- `attemptId`（uuid string，必填）：必须等于 URL 与服务端 attempt。
- `deduped`（boolean，必填）：同一 canonical digest 重放为 `true`。

**Error (HTTP 400/401/404/409/500)**:

```json
{"ok":false,"error":{"key":"<stable_key>","code":"<stable_code>"}}
```

- 顶层 keys 必须严格为 `["error","ok"]`，`error` keys 必须严格为 `["code","key"]`。
- 稳定分类：400 `invalid_result`；401 `invalid_credential`；404 `attempt_not_found`；
  409 `scope_conflict|lineage_conflict|digest_conflict`；500 `persistence_failed`。
- **禁用字段名**：`message`、`secret`、`transcript`、`chain_of_thought`、`stack`。

### HarnessResult v1 reviewer decision

保持顶层 `contract_version:"1.0"`、`attempt_id`、`provider_metadata`；只兼容扩展
`decision.review`：

```json
{
  "outcome":"REVISION",
  "feedback":[{"id":"fb-1","text":"<bounded>","rubric_id":"r-1"}],
  "rubric":[{"id":"r-1","score":6,"max_score":10}],
  "run_id":"<server-bound uuid>",
  "round":1,
  "contract_sha":"<server-bound 40/64 hex>",
  "digest":{"version":"v1","value":"sha256:<64 hex>"}
}
```

Round 2 proposer 仍用 HarnessResult v1，并以 `decision.resolutions` 提交
`[{feedback_id,status,evidence}]`；feedback id 必须逐个且仅一次覆盖。

## 已知约束（来自 registry、累积 FR 与回归测试）

- `[api_registry]` 未登记此 Harness callback；端点 shape 以现有
  `routes/harness-callback.js` 与 PRD 的严格错误体为准。
- `[db_registry]` 使用既有 `harness_attempts.result` 与 append-only
  `orchestrator_decision_log`，不新增 ledger。
- `[累积FR] context-manifest: unavailable`。
- `[execution-contract.test.js]` → HarnessResult v1 已要求顶层
  `contract_version/attempt_id/provider_metadata`，decision 目前 passthrough。
- `[dispatcher.test.js]` → reviewer 强制 fresh/read-only；ACTION_SPECS 是运行时
  action 注册权威。当前 worktree 还存在真实 `spawn:canary` read-only action，
  因而动态枚举必须按真实 registry 自动继承，但不得把未注册 reporter 名称硬编码进去。
- `[harness-attempt-callback.test.js]` → callback 已有 credential、lease、
  provider/session/attestation 检查；本单在真实 HTTP + PostgreSQL 上补齐绑定、digest 与稳定错误。
- `[ground-truth.test.js]` → verdict 与批准由 DB/远端 SHA 物化，worktree prose 不是权威。
- `[harness-kernel-approvals.test.js]` → 人工批准必须锚定 current head。

## Golden Path

覆盖父路 `Harness reviewer feedback convergence` 第 1-5 步

[只读 reviewer/judge action] → [HarnessResult v1 绑定与 digest] → [callback 真写库] →
[round 2 feedback/resolution lineage] → [同一 final SHA 人工批准后合并]

### Step 1: attempt 隔离的只读 result channel

**来源**: `[FROM_PRD]` — “Golden Path（核心场景）”行为 1。

**可观测行为**: Dispatcher 从真实 `ACTION_SPECS` 动态选择 `readOnly=true` action；
每个 attempt 得到唯一宿主普通文件并以容器内 `BRAIN_RESULT_FILE` 可写挂载，
`/workspace` 仍只读。路径逃逸、symlink、link count≠1（含 hardlink/跨 attempt）、
非普通文件、owner/mode 非预期及缺结果均 fail-closed。当前真实 registry 的 read-only
集合自动继承；不存在的 action 不得硬编码。

**验证命令**:

```bash
cd packages/brain
npx vitest run --root /workspace sprints/07272253-kernel-ba630704/tests/reviewer-lineage-contract.test.ts \
  -t '只读 ACTION_SPECS 动态获得 attempt 隔离 result channel'
```

**硬阈值**: `/workspace:ro`；result 文件 `0600`、普通文件、`nlink=1`、当前 uid；
跨 attempt/逃逸/链接/缺失各 0 次 callback。

---

### Step 2: HarnessResult v1 reviewer decision 绑定与 canonical digest

**来源**: `[FROM_PRD]` — 行为 2；不新增 v2 或平行 schema。

**可观测行为**: `decision.review` 有界归一化 outcome/feedback/rubric/run/round/
contract_sha；run/round/attempt/task/contract_sha 取服务端 attempt TaskBundle 与远端当前
contract SHA，客户端同名字段只做等值校验。canonical digest v1 对省略 digest 字段后的
canonical JSON（递归 key 排序、数组保序、UTF-8）算 SHA-256，服务端必重算。

**验证命令**:

```bash
cd packages/brain
npx vitest run --root /workspace sprints/07272253-kernel-ba630704/tests/reviewer-lineage-contract.test.ts \
  -t 'HarnessResult v1 绑定并重算 canonical digest'
```

**硬阈值**: 篡改/错 scope/stale SHA 全拒绝；同 digest 重放只产生一份权威；
异 digest 同 attempt 返回 409；feedback/rubric/result 大小上限由一个共享常量执行。

---

### Step 3: 真实 callback → PostgreSQL 双层持久化

**来源**: `[FROM_PRD]` — 行为 3。

**可观测行为**: 真 `POST /api/brain/harness/attempts/:attemptId/callback` 通过
supertest/HTTP 与显式隔离 PostgreSQL，完整有界 decision 只写
`harness_attempts.result`，decision log 只写 attempt/run/round/contract_sha/digest/
outcome 的有界摘要；400/401/404/409/500 返回严格 schema，敏感值不出响应、日志、DB。

**验证命令**:

```bash
cd packages/brain
test -n "${TEST_DATABASE_URL:-}" || { echo 'FAIL: TEST_DATABASE_URL required'; exit 1; }
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  --root /workspace sprints/07272253-kernel-ba630704/tests/kernel-review-lineage.pg.integration.test.ts \
  -t '真实 callback 持久化完整 decision 与有界摘要'
```

**硬阈值**: 200 成功一次；400/401/404/409/500 全部精确 body；事务失败时两处均 0
新增行；响应、捕获日志与两张表对 secret/transcript/chain-of-thought/禁用字段命中数=0。

---

### Step 4: DB ground truth 驱动 round 2 feedback lineage

**来源**: `[FROM_PRD]` — 行为 4。

**可观测行为**: round 2 proposer 的 `prior_review` 仅来自指定 reviewer attempt 的
`harness_attempts.result`；resolutions 对 feedback id 恰好覆盖一次；round 2 reviewer
TaskBundle 使用同一 prior_review + resolutions 并输出 resolved/unresolved/disputed。
首轮与显式 legacy 标志分别表达 no-history，非首轮缺失或歧义历史阻断派发。

**验证命令**:

```bash
cd packages/brain
test -n "${TEST_DATABASE_URL:-}" || { echo 'FAIL: TEST_DATABASE_URL required'; exit 1; }
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  --root /workspace sprints/07272253-kernel-ba630704/tests/kernel-review-lineage.pg.integration.test.ts \
  -t 'ground truth 构建 round2 prior_review 与 resolutions'
```

**硬阈值**: 每个 feedback id coverage=1；未知/重复/缺失 id 均阻断；fresh sessions、
并发 run、resume/recovery、REVISION/APPROVED 均保持 attempt/run/round/SHA 隔离。

---

### Step 5: final SHA 人工批准闸保持服务端权威

**来源**: `[FROM_PRD]` — 行为 5 与 `review_required:true`。

**可观测行为**: 只有 evaluator PASS、judge PASS、用户 merge-gate approval 三者均锚定
服务器 current head SHA 才触发既有 merge/deploy；缺失、stale、错 SHA 或任一前置失败时
两类调用均为零。generator/evaluator/judge 不取得合并权。

**验证命令**:

```bash
cd packages/brain
test -n "${TEST_DATABASE_URL:-}" || { echo 'FAIL: TEST_DATABASE_URL required'; exit 1; }
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  --root /workspace sprints/07272253-kernel-ba630704/tests/kernel-review-lineage.pg.integration.test.ts \
  -t '只有同一 final SHA 三重批准允许一次合并'
```

**硬阈值**: 所有负路径 merge=0、deploy=0；唯一正路径 merge=1，后续 deploy=1；
首个 P0 task 的 `review_required` 必须为 true。

## 真实调用方请求 shape

生产调用方是 `docker/cecelia-runner/entrypoint.sh`：认证为
`Authorization: Bearer $HARNESS_CALLBACK_TOKEN`，租约为
`X-Harness-Lease-Owner: $HARNESS_LEASE_OWNER`，`Content-Type: application/json`；
URL attemptId 与 body 顶层 `attempt_id` 必须相同。body 必须保留 HarnessResult v1 顶层
`contract_version/status/summary/artifacts/checks/decision/error/provider_metadata`。
DoD 与 RCI 必须使用该 shape，不提供 body credential 或另一条 reviewer 专用路由。

## 接缝清单

- Dispatcher/launcher ↔ 宿主文件系统 ↔ runner：真临时目录、真实 inode metadata 与
  Docker mount 参数验；未在真实容器完成前为 `logic-done-pending`。
- callback Router ↔ `harness_attempts`/`orchestrator_decision_log`：真实隔离 PostgreSQL
  事务与真实 HTTP 验；不得用 pool mock 替代。
- ground-truth ↔ dispatcher TaskBundle ↔ approval gate：从同一 DB result 行和远端 SHA
  构建后续 bundle，并以真实 dispatch/recovery 测试验证。

## 禁 mock 边清单

- `ACTION_SPECS` ↔ dispatcher ↔ detached launcher（改动态只读 action/result channel 传递）。
- runner result 文件 ↔ callback Router（改跨模块结果传递与生命周期收口）。
- callback Router ↔ `harness_attempts`/`orchestrator_decision_log`（改 DB 写路径）。
- `harness_attempts.result` ↔ ground-truth ↔ round 2 dispatcher TaskBundle（改 lineage 接力）。
- evaluator/judge/human approval ↔ current-head merge/deploy gate（改/回归状态机接缝）。

只允许 mock 真实第三方 merge/deploy 的最终副作用函数来计数；服务端批准判断、DB 与上述边禁 mock。

## 未覆盖真实链路清单

- merge/deploy 的 GitHub/生产副作用以 spy 计数替代，原因是合同阶段禁止真实合并/部署；
  补位由 evaluator 在同一 final SHA 上验证 gate，真实动作仅在用户批准后由 controller 执行。
- 无其余 mock 豁免；第三方 API 真调规则 N/A（本单无新增第三方 API）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 上述五个 Golden Path 行为。 |
| NFR | 有界大小/等待；fresh session；callback 幂等；错误不泄密。 |
| Invariant | HarnessResult 保持 v1；服务端绑定；DB 为权威；无批准不 merge/deploy。 |
| 判定点 | canonical digest、历史 lineage 与 final SHA 均由服务端确定性判断。 |
| 保质期 | result 与 attempt 同生命周期；approval 随 head SHA 变化立即过期。 |
| 死亡告警 | result 缺失、persistence_failed、非首轮无历史必须稳定失败并进入现有 Kernel 告警。 |
| 失败语义 | 全部 fail-closed；同 digest replay 幂等，异 digest 冲突，不做部分写。 |
| 效果确认 | 回读两张表、后续 TaskBundle 与 merge/deploy 调用计数，不以 HTTP 200 单独判成功。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| result 是否属于当前 attempt | 客户端自报；服务端 bundle+远端 SHA | 服务端等值绑定 | PRD 指定 server-owned authority | 跨 run/round 错绑 |
| replay 是否相同 | 原字符串；canonical digest v1 | 省略 digest 后 canonical JSON SHA-256 | 消除 key 顺序歧义 | 重复写或冲突漏报 |
| feedback 是否已解决 | prose；feedback id claim map | 同一 prior_review id 精确覆盖 | 可确定性核对 | 反馈静默丢失 |
| 是否允许合并 | 任一 PASS；三重同 final SHA | evaluator+judge+human 同 current head | 既有人工权威 | 未批准代码面客 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| channel 非法/缺结果 | 阻断 callback | 修复 channel 后同 attempt 恢复 | 无只读 workspace 写入降级 |
| invalid/credential/not-found/conflict | 返回稳定 400/401/404/409 | 同 digest 可重放 | 不反射输入 |
| DB 持久化失败 | 事务回滚，500 `persistence_failed` | 是 | 无内存/worktree 权威降级 |
| 非首轮历史缺失 | 阻断派发 | 恢复精确 attempt 行后可重试 | 不从 prose 猜测 |
| stale/missing approval | merge/deploy 0 调用 | 新 final SHA 重新审批 | 无自动放行 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| read-only agent HarnessResult | 不可信 | 严格有界 schema；禁 transcript/CoT/secret；feedback 仅作为数据 | 客户端绑定字段不得覆盖服务端，未知字段拒绝 |

## 风险与缓解

| 风险 | 缓解与验收信号 |
|---|---|
| lineage 错绑 | bundle/attempt/current SHA 等值校验；跨 scope 稳定 409 |
| digest 歧义 | canonical v1 省略 digest；tamper/replay/conflict RCI |
| result-channel 逃逸 | attempt 独立目录、inode/owner/mode/nlink 检查 |
| 测试库污染 | 只接受显式 `TEST_DATABASE_URL`，写前核对 DB 名与 server addr |
| 批准绕过 | 三重同 final SHA；所有负路径 merge/deploy=0 |

## E2E 验收

**journey_type**: autonomous  
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail

test -n "${TEST_DATABASE_URL:-}" || { echo "FAIL: explicit TEST_DATABASE_URL required"; exit 1; }
case "$TEST_DATABASE_URL" in
  *"/cecelia"|*"localhost/cecelia"|*"127.0.0.1/cecelia")
    echo "FAIL: production/default cecelia database forbidden"
    exit 1
    ;;
esac

DB_NAME=$(psql "$TEST_DATABASE_URL" -Atqc 'SELECT current_database()')
DB_ADDR=$(psql "$TEST_DATABASE_URL" -Atqc 'SELECT COALESCE(inet_server_addr()::text, current_setting('\''unix_socket_directories'\''))')
test -n "$DB_NAME" || { echo "FAIL: current_database unavailable"; exit 1; }
test -n "$DB_ADDR" || { echo "FAIL: inet_server_addr unavailable"; exit 1; }
test "$DB_NAME" != "cecelia" || { echo "FAIL: production database selected"; exit 1; }

cd packages/brain
npm ls --depth=0 >/dev/null
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run \
  --root /workspace \
  sprints/07272253-kernel-ba630704/tests/reviewer-lineage-contract.test.ts \
  sprints/07272253-kernel-ba630704/tests/kernel-review-lineage.pg.integration.test.ts \
  --reporter=verbose

echo "OK: result-channel -> callback HTTP -> isolated PostgreSQL -> ground truth -> round2 TaskBundle -> final-SHA gate"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 五步生产链 | `tests/reviewer-lineage-contract.test.ts` | `HarnessResult v1 绑定并重算 canonical digest` | 当前 passthrough 不拒绝 tamper |
| 真 DB RCI | `tests/kernel-review-lineage.pg.integration.test.ts` | `真实 callback 持久化完整 decision 与有界摘要` | 当前错误 body/摘要/lineage 不符 |
| round2/批准 | 同上 | `ground truth 构建 round2 prior_review 与 resolutions`、`只有同一 final SHA 三重批准允许一次合并` | 当前无 prior_review/resolutions 全链 |

## Notes

- contract-gate: `packages/brain/src/lib/contract-gate.js` 存在，必须 gate-clean。
- evidence-only：旧合同 `f6ca642f...` 与 reviewer attempt `0c58a945...` 不作为绑定权威。
- judgment-pending-user: 无；四个判定点均由冻结 PRD 明确定义。
