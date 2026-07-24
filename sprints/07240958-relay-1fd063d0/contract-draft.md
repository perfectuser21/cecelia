# Sprint Contract Draft（Round 2）— 完整 Codex Slot 安全硬切换

## 合同 Notes

- 基线为 Round 1 commit `dfa2813b73cde88346f83c1ceff68250f9d61b15`；保留 PRD，不合并、cherry-pick 或复制旧草稿 PR #4237-#4242。
- Round 2 只核销 `.harness/gan-feedback-r1.md` 的 5 个 blocking；先删除重复说明，再替换真实调用方、cutover/durable、全局唯一/SSOT、API oracle 与 6 条 invariant 映射。
- registry 最近扫描已过 24h，新 HTTP 字段以 PRD和当前生产调用方源码推导并标为 `[NEW_PATTERN]`；`context-manifest` 仍不可用，累积 FR 以 PRD“暂无历史”为准。
- `journey_type=agent_remote`、`target_environment=local_api`；不适用 user_facing staging 预览闸。
- xian-m1/xian-m4 写入型真机验收前均为 `logic-done-pending`。

## 锚定父路声明

独立小路（无父路）

## 已知约束（回归测试、生产调用方、现有 SSOT）

- `scripts/codex-request.sh` 的合法旧调用 `--team team1` 当前会 SSH/scp auth；`scripts/codex-remote-launch.sh --team team3` 当前会 SSH/scp/tmux，必须在任何子进程、网络或 auth 动作前硬停。
- `packages/brain/src/executor.js` 的 `pickLocalAccountByDeficit()` 当前读取美国机完整 auth，并由 `buildCodexBridgePayload()` 发送 `accounts:[{id,auth}]`。
- `packages/brain/scripts/codex-bridge/codex-bridge.cjs` 的 `/run`、`/execute` 接受 raw `accounts`; 缺失时 `loadRawAuth()`/`injectLocalAccount()` 从西安本地真实 auth fallback；`/execute-review` 也本地取 auth。
- 机器身份真相源已经是 `system_registry(type='machine')`；容量/新鲜度真相源已经是 `fleet-resource-cache.js`，Codex 并发消费者是 `slot-allocator.js`，不得再建平行 agent/capacity 真相源。
- 账号选择必须复用当前 `pickLocalAccountByDeficit` 的语义：5h `used_percent > 95` 不可选，7d `deficit = elapsed_target_pct - used_percent` 降序，同 deficit 按 5h 用量升序；broker 只返回 `account_ref`，不得返回 raw auth。
- `packages/brain/scripts/codex-bridge/codex-account-usage.cjs` 的“bridge 本地账号选择”随 fallback 一并退役，不再是分配真相源。

## Response Schema（PRD 字面 + 当前 Brain 风格 + `[NEW_PATTERN]`）

共同 UUID 格式为 RFC 4122：`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`。

### `POST /api/brain/codex-slots/acquire`（201；幂等重放仍为 201）

```json
{"ok":true,"session":{"agent_id":"xian-m1|xian-m4","handle":"actor/project/name","lease_id":"uuid","session_id":"uuid","status":"running"}}
```

- 顶层 keys 完全等于 `["ok","session"]`；session keys 完全等于 `["agent_id","handle","lease_id","session_id","status"]`。
- `ok` 为 boolean true；两个 ID 为 UUID string；`handle` 为非空 string；`status` 只能为 `running`；`agent_id` 只能为 `xian-m1|xian-m4`。
- 同一 `Idempotency-Key` 两次响应的 `session_id/lease_id/handle/agent_id/status` 字面相同，DB 只有一份 lease/session/acquire audit。

### `POST /api/brain/codex-slots/:session_id/stop`（200；重复 stop 仍为 200）

```json
{"ok":true,"session":{"cleanup":{"auth_absent":true,"lease_state":"released","temp_absent":true,"tmux_absent":true},"handle":"actor/project/name","session_id":"uuid","status":"stopped"}}
```

- 顶层/session/cleanup keys 必须 exact；三个 absent 字段均为 boolean true，`lease_state="released"`。
- 两次 stop 的 body 字面相同；DB release transition 与 stop audit 各恰好 1 次。

### `POST /api/brain/codex-slots/reap`（200）

```json
{"ok":true,"summary":{"checked":0,"heartbeat_updated":0,"quarantined":0,"released":0}}
```

- 顶层与 summary keys 必须 exact；四个 summary 值均为非负 integer。

### 共同 Error（400/401/403/409/423/503）

```json
{"error":{"code":"UNAUTHENTICATED|FORBIDDEN_IDENTITY|INVALID_REQUEST|ACCOUNT_BUSY|ROLLOUT_FROZEN|AGENT_UNAVAILABLE|DURABILITY_FAILED","message":"string","retryable":false},"ok":false}
```

- exact keys；`code/message` 为 string，`retryable` 为 boolean。
- acquire/stop/reap 每个端点在缺失或错误 Bearer 下均先返回 401 + `UNAUTHENTICATED`；通用 404 不算端点存在。
- 所有 success/error 响应禁止出现 `actor/team/account_ref/host/token/auth/auth_json/prompt/env/accounts`。
- 用户 `status` 不属于 PRD 必需路径，本轮从 client 与 task-plan 删除；agent 内部 `status` 动作用于 stop/reaper 精确核验，不发布用户 status HTTP API。

## 真实调用方请求 shape

### 硬切前现网（退役证据）

`executor → codex-bridge POST /run` 当前无认证 header，body 为：

```json
{
  "task_id":"uuid","checkpoint_id":null,"prompt":"text","task_type":"codex_dev",
  "work_dir":"path","timeout_ms":600000,"runner":"path","runner_args":["..."],
  "branch":"name","accounts":[{"id":"team1","auth":{"tokens":{"access_token":"..."}}}],
  "callback_url":"http://localhost:5221/api/brain/execution-callback"
}
```

`/run`、`/execute` 在 `accounts` 缺失时本地 `selectBestCodexAccount→loadRawAuth→injectLocalAccount`；`/execute-review` 总是本地选择并注入。`/health.accounts`、`/accounts` 又让 executor/bridge 各自选择账号，形成第二 issuer。

### 硬切后内部任务（executor）调用

1. executor 先以服务端 task identity 调同一 broker acquire；broker 使用既有 usage/deficit 语义选 `account_ref`，写全局 lease/session/audit，并向已选 agent protected receiver 投递 snapshot。
2. broker 返回不含 secret 的 slot receipt 后，executor 才调用所选 agent 上的 `/run`：

```http
POST /run
Authorization: Bearer <root-owned receiver token>
Content-Type: application/json
Idempotency-Key: <与 broker acquire 相同的 UUID>
```

```json
{
  "task_id":"uuid","checkpoint_id":null,"prompt":"text","task_type":"codex_dev",
  "work_dir":"path","timeout_ms":600000,"runner":"path","runner_args":["..."],
  "branch":"name","callback_url":"http://localhost:5221/api/brain/execution-callback",
  "slot":{"agent_id":"xian-m1|xian-m4","lease_id":"uuid","receipt":"opaque","session_id":"uuid"}
}
```

- `/run` body 禁止 `accounts/auth/token/account_ref`；bridge 校验 receiver token、receipt 与本机 root `agent_id`，只使用 broker 为该 session 准备的私有目录。
- `/execute` 与 `/execute-review` 返回 410 迁移错误，不再选择账号；bridge 的 `loadRawAuth/injectLocalAccount/setupInjectedAccounts` 与本地 auth fallback 删除。
- `/health` 不返回账号用量，`/accounts` 返回 410；executor 选机只读 machine/fleet/slot SSOT。

### 用户调用

```text
codex-slot start [--project <safe-segment>] [--name <safe-segment>]
codex-slot stop <handle>
```

adapter → Brain 固定为 Bearer、`Idempotency-Key`、`X-Codex-Slot-Identity-Kind: uid|ssh_key`、`X-Codex-Slot-Identity`；acquire body exact `{"name":"...","project":"..."}`，stop body exact `{}`。用户不能提供 actor/tenant/team/account/host/agent/auth。

## Risks

| 风险 | 失败关闭与执行 oracle |
|---|---|
| executor/bridge raw auth 或本地 fallback 漏网 | A01 + B02 真调用生产 executor，捕获真实 `/run` 边界并查 broker/agent/DB；任一 `accounts/auth` 或本地 auth read 即失败。 |
| inventory/cutover 部分成功 | B03 authenticated frozen、inventory gate、每个 cutover fault 后 durable state 都必须仍为 frozen。 |
| 同公司账号跨 tenant 并发 | A02 全局 partial unique index + B04 两 tenant 同 `account_ref` 真并发，只准一个 blocking lease。 |
| machine/fleet/slot 与平行表漂移 | 不建 `codex_slot_agents`；B08 直接查 system_registry、fleet freshness、slot capacity，陈旧/缺映射为 0 可用。 |
| commit 后响应丢失或重启造成未知成功 | B05 对每个 durable fault 真 kill/restart/replay，最终一个 lease/session/audit，ID 可重放。 |
| reaper 静默死亡 | B11 连续失败计数持久化，阈值时写 P0 Bark action_receipt；外部 Bark 仅允许本地 capture sink 替代。 |

## Golden Path

冻结旧入口与盘点 → 全局 durable lease/session/audit → 复用 machine/fleet/slot 与 usage/deficit → broker-only receiver → 同一 mmv 判定 launch → stop/reaper 与双机清理

### Step 1：旧入口在网络/auth 前硬停，盘点与 cutover 原子开放

**来源**：`[FROM_PRD]` — Golden Path 1 与旧入口失败保持 frozen；`[AI_ADDED]` — Round 2 用合法旧参数 tripwire 防止 `--help` 假绿。

**可观测行为**：两个旧脚本合法旧调用 exit 64 且未启动 ssh/scp/codex/tmux；authenticated acquire 在 inventory 未完成或任一 cutover fault 时返回 423 exact error，durable rollout 保持 frozen。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
[ -x "$S" ] || exit 1
"$S" --case frozen-inventory-cutover --json | jq -e '.ok==true and .authenticated_frozen.http_code==423 and .inventory_incomplete.http_code==423 and ([.faults[].rollout_state]|all(.=="frozen")) and .opened.inventory_complete==true'
```

**硬阈值**：所有拒绝发生在副作用前；只有 inventory complete + 全 cutover step durable 后为 open。

### Step 2：公司账号全局唯一，durable 写与重启仍幂等

**来源**：`[FROM_PRD]` — Golden Path 2、durable crash 边界；`[AI_ADDED]` — Round 2 明确两个 tenant 竞争同一 account_ref。

**可观测行为**：blocking 唯一键只含公司 `account_ref`，不含 tenant；两 tenant 并发只有一个 201；每个 durable fault 真重启重放后仍只有一个 lease/session/audit。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
G=$("$S" --case global-account-contention --json)
D=$("$S" --case durable-crash-restart --json)
printf '%s\n' "$G" | jq -e '.ok==true and ([.attempts[].http_code]|sort)==[201,409] and .global_blocking_leases==1'
printf '%s\n' "$D" | jq -e '.ok==true and .postgresql_real==true and ([.faults[]|select(.pid_before!=.pid_after and .blocking_leases==1 and .sessions==1 and .acquire_audits==1)]|length)==(.faults|length)'
```

**硬阈值**：任何时刻同 account_ref 的 active/quarantined/blocked 总数 ≤1；重放无 unknown success。

### Step 3：复用现有账号选择与 machine/fleet/slot SSOT

**来源**：`[FROM_PRD]` — 自动 slot、账号用量选择、身份/容量未知 fail closed；`[AI_ADDED]` — Round 2 消除 `codex_slot_agents` 重叠。

**可观测行为**：broker 复用既有 deficit 排序但只接触 `account_ref`；agent 身份来自 system_registry 映射 + root attest，容量来自 fresh fleet/slot；缺映射、陈旧或 unknown 均无候选。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
"$S" --case machine-fleet-usage-ssot --json | jq -e '.ok==true and .agent_table_exists==false and .identity_source=="system_registry" and .capacity_source=="fleet-resource-cache" and .concurrency_source=="slot-allocator" and .usage_selection.rule=="existing-deficit" and .stale.available==0 and (.ttl.health_ms < .ttl.heartbeat_stale_ms and .ttl.heartbeat_stale_ms < .ttl.quarantine_review_ms)'
```

**硬阈值**：平行 agent 表不存在；stale/unknown capacity=0；usage 输入未知时不分配。

### Step 4：executor 与用户都先取 broker lease，bridge 不再拥有 raw auth

**来源**：`[FROM_PRD]` — broker 唯一 token issuer 与受保护 receiver；`[AI_ADDED]` — Round 2 补真实 executor→bridge caller。

**可观测行为**：真实 executor `/run` 只发送 slot receipt；内部任务与用户会话均显示 issuer=broker；bridge 本地 auth read=0，退役端点 410。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
"$S" --case executor-bridge-broker-only --json | jq -e '.ok==true and .internal.issuer=="broker" and .user.issuer=="broker" and (.run_body|has("accounts")|not) and (.run_body|has("auth")|not) and (.run_body.slot|keys==["agent_id","lease_id","receipt","session_id"]) and .bridge.local_auth_reads==0 and .bridge.execute_code==410 and .bridge.execute_review_code==410'
```

**硬阈值**：跨机 raw auth 字节数=0；没有 broker lease/receiver auth 时 `/run` 拒绝。

### Step 5：prepare/launch 共用 mmv 判定，失败清理

**来源**：`[FROM_PRD]` — Golden Path 4-5 与两次 mmv 重验。

**可观测行为**：prepare 与 launch 返回同一 predicate ID；出口变化时 launch 非零、auth/tmux/temp absent、lease 不 released；installer 配置失败非零且无半安装。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
"$S" --case protected-delivery-and-launch --json | jq -e '.ok==true and .prepare.predicate_id==.launch.predicate_id and .race.read_auth==false and .race.wrote_auth==false and .launch.rejected==true and .cleanup.auth_absent==true and .cleanup.tmux_absent==true and .cleanup.temp_absent==true and .cleanup.lease_state!="released"'
```

**硬阈值**：两阶段判定语义相同；任一失败都 fail closed 并清理。

### Step 6：stop/reaper 精确收口并告警，双机 fake-auth 无残留

**来源**：`[FROM_PRD]` — Golden Path 5-6、两轮 reaper、xian-m1/xian-m4 fake-auth smoke。

**可观测行为**：重复 stop body 相同且 release/audit 各一次；reaper summary 全为非负 integer，不确定状态只 quarantine；连续失败持久计数并写 P0 Bark receipt；双机均清理。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
"$S" --case stop-reaper-alert --json | jq -e '.ok==true and .stop.same_body==true and .stop.release_transitions==1 and .stop.audit_events==1 and ([.reaper.summary[]]|all(type=="number" and .>=0 and floor==.)) and .reaper.unreachable_released==0 and .alert.severity=="P0" and .alert.bark_receipt_count==1'
```

**硬阈值**：确认停止才 release；连续失败达到配置阈值时本轮产生且只产生一个 P0 Bark receipt。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 旧入口 | `tests/codex-slot-contract.test.ts` | 旧 codex-request 合法参数在任何网络前 exit 64；旧 codex-remote-launch 合法参数在任何网络前 exit 64 | 当前脚本触发 tripwire 后 exit 1 |
| broker-only caller | `tests/codex-slot-contract.test.ts` | executor bridge payload 不含 accounts auth 且必须携带 slot receipt；bridge 删除 raw auth 与本地 fallback | 当前源码仍发送/读取 raw auth |
| 全局租约与 SSOT | `tests/codex-slot-contract.test.ts` | migration 用 account_ref 全局 blocking 唯一且不建 codex_slot_agents；agent 身份容量复用 machine fleet slot SSOT | migration/实现尚不存在 |
| cutover/durable | `tests/codex-slot-contract.test.ts` | authenticated frozen inventory cutover 与 durable crash restart smoke 存在 | smoke 尚不存在 |
| API oracle | `tests/codex-slot-contract.test.ts` | acquire stop reap 全鉴权 exact schema 并直接比较幂等副作用 | route 尚不存在 |
| invariant | `tests/codex-slot-contract.test.ts` | 六条 blocking invariant 都有真实 smoke case | smoke/installer 尚不存在 |

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 受控身份、全局账号租约、既有 SSOT 选机/选账号、broker-only 投递、mmv 双校验、stop/reaper、旧入口硬切、双机 fake-auth。 |
| NFR | fail closed；关键写 durable；macOS Bash 3.2 + modern Bash；日志/响应无 secret/prompt/full auth/env。 |
| Invariant | 用户不能指定 authority；公司 account_ref 全局最多一个 blocking lease；未知不释放；bridge 无持久 auth/fallback。 |
| 判定点 | 见下表。 |
| 保质期 | `health TTL < heartbeat stale < quarantine review TTL` 从配置读取并由 B08 执行断言；过期即 unavailable。 |
| 死亡告警 | reaper 连续失败计数写 working_memory，阈值时 P0 + Bark action_receipt，B11 真验。 |
| 失败语义 | 身份/DB/receiver/mmv/capacity/receipt 任一未知即拒绝或 quarantine；同幂等键安全重放。 |
| 效果确认 | acquire 查真实 DB 与 receiver；stop 查 cleanup+release/audit count；双机 final-e2e 查 agent/DB 无残留。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ agent 身份 | hostname/alias；system_registry 映射 + root attest | 后者 | PRD 明禁名称/DNS | auth 投错机器 |
| ⚠️ mmv 出口 | 名称；stable node ID + IP allowlist + online | 后者 | PRD 字面要求 | 公司账号从错误出口使用 |
| 容量可用 | 新表布尔；fresh fleet effectiveSlots + slot allocator | 后者 | 现有 SSOT | 半写/过载 |
| ⚠️ lease 可释放 | TTL 猜测；精确 stop/status receipt | 后者 | 未知必须隔离 | 同账号并发 |
| rollout 可开放 | 文件标志；durable inventory + 全 cutover step | 后者 | 原子开放 | 新旧入口并存 |

### 失败语义声明

| 场景 | 失败行为 | 幂等/降级 |
|---|---|---|
| broker/receiver auth 缺失或错误 | 401/503，不读身份/auth、不写 lease | 无开放降级 |
| inventory/cutover 失败 | 423，rollout durable frozen | 修复后同键重试 |
| durable fault/响应丢失 | rollback 或重放同一已提交结果 | 禁止创建第二 lease |
| usage、machine、fleet、slot 任一未知 | 503，无候选 | 不用固定 fallback |
| delivery/launch/stop 不确定 | cleanup + blocked/quarantined | 精确核验后再释放 |
| reaper 连续失败 | 保留 blocking lease，计数并 P0/Bark | 恢复后继续两轮核验 |

### 输入对抗面

| 输入来源 | 信任等级 | 防护 | 越权拒绝 |
|---|---|---|---|
| CLI argv | 不可信 | safe segment/长度限制，不拼 prompt | 拒绝 actor/team/account/host/agent/auth/token/path |
| adapter headers/body | body 不可信 | Bearer 先验、exact schema | identity 只由 root adapter 映射 |
| executor `/run` | 服务内但不默认可信 | receiver Bearer + opaque receipt + exact slot | raw accounts/auth 与 receipt 不匹配均拒绝 |
| auth snapshot | 高敏感 | 受保护 frame、大小/结构限制、零日志 | 失败即清理/quarantine |
| agent receipt | 远端不可信 | exact IDs、长度截断、DB 对账 | 任一不匹配不 release |

## 接缝清单

1. **旧脚本/executor ↔ broker/bridge**：B01/B02 真调用当前生产 caller，未通过前 `logic-done-pending`。
2. **broker ↔ PostgreSQL ↔ machine/fleet/slot/usage**：B03-B08 真 PostgreSQL 与真实模块，不 mock 被改边。
3. **broker/bridge ↔ xian-m1/xian-m4 agent ↔ mmv/FS/tmux**：B09-B12 与 final-e2e 真机验证，未通过前 `logic-done-pending`。

## 禁 mock 边清单

- 旧脚本/executor ↔ broker ↔ codex-bridge `/run`（必须真实捕获生产请求，禁止 mock caller）。
- broker/state machine ↔ PostgreSQL lease/session/rollout/audit（必须真 PG + 真 kill/restart）。
- broker ↔ `system_registry`/fleet cache/slot allocator/既有 usage-deficit selector（禁止平行 fixture SSOT；外部 wham 可用专用 usage snapshot）。
- bridge/agent ↔ root config/mmv/私有 FS/tmux（final-e2e 真机）。
- scheduler-jobs ↔ reaper ↔ PostgreSQL/notifier receipt（Bark 外网仅允许本地 capture sink）。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位 |
|---|---|---|
| fake auth 不验证 OpenAI/Codex 真认证与 wham 真 key | PRD 明禁真实公司 token 进入 fixture/smoke | 只验既有 deficit 排序语义；真实账号有效性不宣称 done。 |
| proposer 未执行双机写入型 lifecycle | proposer 只修合同 | evaluator final-e2e 真跑前保持 `logic-done-pending`。 |

## E2E 验收

**journey_type**：`agent_remote`
**target_environment**：`local_api`

```bash
#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
SMOKE="packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh"
[ -x "$SMOKE" ] || { echo "FAIL: missing $SMOKE" >&2; exit 1; }

OUT=$("$SMOKE" --case final-e2e --hosts xian-m1,xian-m4 --fixture-id contract-v2 --json)
printf '%s\n' "$OUT" | jq -e '
  keys==["auth_matrix","caller","global_account","hosts","ok","reaper","run_id","tenants"] and
  .ok==true and
  .caller.executor_issuer=="broker" and .caller.user_issuer=="broker" and
  .caller.raw_auth_boundary_bytes==0 and .caller.bridge_local_auth_reads==0 and
  .global_account.blocking_leases==1 and
  ([.auth_matrix[]|select(.missing==401 and .wrong==401)]|length)==3 and
  ([.hosts[]|select((.host=="xian-m1" or .host=="xian-m4") and .cleanup.auth_absent==true and .cleanup.tmux_absent==true and .cleanup.temp_absent==true and .cleanup.lease_state=="released")]|length)==2 and
  .tenants.cross_reads==0 and .tenants.audit_secret_rows==0 and
  ([.reaper.summary[]]|all(type=="number" and .>=0 and floor==.)) and
  .reaper.unreachable_released==0 and .reaper.bark_receipts==1
'

RUN_ID=$(printf '%s\n' "$OUT" | jq -er '.run_id')
[[ "$RUN_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "FAIL: bad run_id" >&2; exit 1; }
BLOCKING=$(psql "$DB_URL" -Atqc "SELECT count(*) FROM codex_slot_leases WHERE request_id='$RUN_ID' AND state IN ('active','quarantined','blocked') AND updated_at > NOW()-interval '5 minutes'")
SECRETS=$(psql "$DB_URL" -Atqc "SELECT count(*) FROM codex_slot_audit_events WHERE request_id='$RUN_ID' AND created_at > NOW()-interval '5 minutes' AND payload::text ~* '(access_token|refresh_token|auth_json|prompt|full_env)'")
[ "$BLOCKING" -eq 0 ] && [ "$SECRETS" -eq 0 ] || { echo "FAIL: residual blocking=$BLOCKING secrets=$SECRETS" >&2; exit 1; }

printf 'OK: Codex Slot broker-only global lease + dual-host lifecycle run=%s\n' "$RUN_ID"
```

**PASS**：exit 0；三端点鉴权、真实 executor/user broker-only、全局账号唯一、双机 cleanup、租户隔离、reaper summary/P0 receipt 与 DB 时间窗全部通过。
**FAIL**：任一 shell/Brain/DB/SSH/agent 非零，schema/UUID/enum 不符，raw auth/fallback、并发 blocking lease、secret 或残留出现。
