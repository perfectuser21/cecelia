# Sprint Contract Draft（Round 5）— 完整 Codex Slot 安全硬切换

## 合同 Notes

- 基线为 Round 4 commit `376368be78d31c42941622a03242deb1ba83a468`；Round 5 只原位扩展 consumer inventory/INV-19，核销“非 `/run` 公司 Codex account home/token 消费旁路”这一项 blocking。
- consumer inventory 以本轮检索时当前 `origin/main` `a1b22bf72618f072f28f61baef4be38a52d1c185` 为证据锚；Round 4 已核销的退役 HTTP、executor 选机、七类 Error exact body与两段 `mmv` race 不回退。
- registry 最近扫描已过 24h，新 HTTP 字段以 PRD和当前生产调用方源码推导并标为 `[NEW_PATTERN]`；`context-manifest` 仍不可用，累积 FR 以 PRD“暂无历史”为准。
- `journey_type=agent_remote`、`target_environment=local_api`；不适用 user_facing staging 预览闸。
- xian-m1/xian-m4 写入型真机验收前均为 `logic-done-pending`。

## 锚定父路声明

独立小路（无父路）

## 已知约束（回归测试、生产调用方、现有 SSOT）

- `scripts/codex-request.sh` 的合法旧调用 `--team team1` 当前会 SSH/scp auth；`scripts/codex-remote-launch.sh --team team3` 当前会 SSH/scp/tmux，必须在任何子进程、网络或 auth 动作前硬停。
- `packages/brain/src/executor.js` 的显式 codex override、`location=xian`、`location=xian_m1` 三路均进入 `triggerCodexBridge()`；该函数当前读取美国机完整 auth 并发送 `accounts:[{id,auth}]`，`selectBestBridge()` 又读 `/health.accounts` 且全失败时固定回退 M4。
- `packages/brain/scripts/codex-bridge/codex-bridge.cjs` 的 `/run`、`/execute` 接受 raw `accounts`; 缺失时 `loadRawAuth()`/`injectLocalAccount()` 从西安本地真实 auth fallback；`/execute-review` 也本地取 auth。
- `harness-skill-relay.js → spawnCodexBridgeDetached → /run` 当前发送 `account_id`；`brain-meta` 的 codex-usage/refresh 与 `credentials-health-scheduler` 当前消费 bridge `/accounts`。
- 当前 main 的非 `/run` 生产消费者还包括：`llm-caller.js` 直接轮询 `.codex-team1/2` 并 fallback API key；executor 的 `triggerCodexReview` 继承进程凭据、`triggerLocalCodexExec` 接受 `CODEX_REVIEW_HOME/CODEX_HOME`；relay container/headed 复制 `CODEX_RELAY_HOME/auth.json`；orchestrator dispatcher/watchdog 由 `account_id/codex_home` 解析并 rw 挂载 `.codex-teamN`。
- 代码检索还发现 `llm-capacity.js`、`scripts/dispatch-worker.mjs`、bridge `codex-account-usage.cjs`、cron `credentials-health-check.sh` 直接读公司 auth/token；engine 两个 Codex runner、`scripts/codex-launch.sh` 消费上游 `CODEX_HOME(S)`；`scripts/codex-supervisor.mjs` 与两条本机 executor 会继承默认凭据。它们必须逐路选择 broker 链或独立凭据域，不得留在盘点之外。
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

- 顶层/session/cleanup keys 必须 exact；`ok=true`，`session_id` 为 UUID string、`handle` 为非空 string；三个 absent 字段均为 boolean true，`lease_state="released"`。
- 两次 stop 的 body 字面相同；DB release transition 与 stop audit 各恰好 1 次。

### `POST /api/brain/codex-slots/reap`（200）

```json
{"ok":true,"summary":{"checked":0,"heartbeat_updated":0,"quarantined":0,"released":0}}
```

- 顶层与 summary keys 必须 exact；四个 summary 值均为非负 integer。

### 共同 Error exact matrix（400/401/403/409/423/503）

```json
{"error":{"code":"UNAUTHENTICATED|FORBIDDEN_IDENTITY|INVALID_REQUEST|ACCOUNT_BUSY|ROLLOUT_FROZEN|AGENT_UNAVAILABLE|DURABILITY_FAILED","message":"string","retryable":false},"ok":false}
```

- exact keys；有限映射不得漂移：

| 真实失败场景 | HTTP | `code` | exact `message` | `retryable` |
|---|---:|---|---|---|
| Bearer 缺失/错误 | 401 | `UNAUTHENTICATED` | `authentication required` | `false` |
| extra/非法字段 | 400 | `INVALID_REQUEST` | `request does not match the exact schema` | `false` |
| UID/SSH key 未映射或伪造 | 403 | `FORBIDDEN_IDENTITY` | `identity is not mapped` | `false` |
| 公司账号已有 blocking lease | 409 | `ACCOUNT_BUSY` | `account already has a blocking lease` | `true` |
| rollout/inventory 未开放 | 423 | `ROLLOUT_FROZEN` | `codex slot rollout is frozen` | `true` |
| agent 身份/容量/mmv 不可用 | 503 | `AGENT_UNAVAILABLE` | `no healthy codex slot agent available` | `true` |
| durable commit/重放失败 | 503 | `DURABILITY_FAILED` | `durable write failed` | `true` |

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

### 硬切后生产 Codex credential consumer inventory

| caller | 当前入口 | 硬切合同 |
|---|---|---|
| executor explicit | `payload.executor=codex` → `triggerCodexBridge(task, route.url)` | 先 broker acquire，再向该 route 发 receipt-only `/run` |
| executor xian | `location=xian` → `triggerCodexBridge(task)` | 先 broker acquire，再向 broker 所选 agent 发 `/run` |
| executor xian_m1 | `location=xian_m1` → `triggerCodexBridge(task, XIAN_M1_BRIDGE_URL)` | 先 broker acquire；固定路由仍须通过 agent 身份/容量/mmv gate |
| harness relay | `harness-skill-relay → spawnCodexBridgeDetached(.../run)` | 删除 `account_id/xian_account_id` 与 raw key；先 broker acquire，再发送 receipt-only `/run` |

四路都以服务端 task identity 调同一 broker acquire；每一路捕获的 broker `lease_id/session_id/receipt/agent_id` 必须与随后真实 `/run` 的 `slot` 字面相同：

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

- `/run` body 禁止 `account_id/accounts/auth/token/account_ref/github_token/anthropic_api_key`；bridge 校验 receiver token、receipt 与本机 root `agent_id`，只使用 broker 为该 session 准备的私有目录。
- `/execute` 与 `/execute-review` 返回 410 迁移错误，不再选择账号；bridge 的 `loadRawAuth/injectLocalAccount/setupInjectedAccounts` 与本地 auth fallback 删除。
- `/health` 不返回账号用量，`/accounts` 返回 410；executor 不再从 `/health.accounts` 二次选机或固定回退 M4，`location=xian` 必须按 broker receipt 的 `agent_id` 映射真实 receiver。`brain-meta` 的 codex-usage/refresh 与 `credentials-health-scheduler` 改读 broker 写入既有 `account_usage_cache` 的无秘密字段；三者均不得成为第二 issuer。

当前 main 宽搜命中的其余生产路径必须进入同一个 exact inventory；每条只能取下列两种结论之一，且 B02/final-e2e 必须真实触发：

| inventory key | 当前生产路径 | 合同选择 |
|---|---|---|
| `executor_bridge_selector` | executor `pickLocalAccountByDeficit` 读五个 auth/token | broker：删除本地读，usage/deficit 由 broker lease/session/receipt 收口 |
| `llm_caller` | `getNextCodexTeamHome → callCodexHeadless` + API-key fallback | broker：调用前 acquire；Codex 仅见 receipt 私有目录，API-key fallback=0 |
| `llm_capacity` | `pollCodexLedger` 读 `.codex-team1..5/auth.json` | broker：usage probe 也有 lease/session/receipt，调用方只见无秘密容量 |
| `dispatch_worker` | worker 读 auth、选 `account.home` 并设置 `CODEX_HOME` | broker：每次 worker attempt 独立 lease/session/receipt，不得本地轮换 |
| `bridge_account_usage` | bridge usage 模块读 auth、选 `codexHome` | broker：usage probe 走同一租约链，不得产生第二 selector |
| `credentials_health_cron` | cron 读 auth/token 调 wham | broker：health probe 走同一租约链，cron 不读取公司 auth |
| `harness_relay_container` | 快照 `CODEX_RELAY_HOME/auth.json` 后 rw mount | broker：只挂 receiver receipt 私有目录，不读/复制宿主公司 auth |
| `harness_relay_headed` | 快照后给 headed Codex 注入 `CODEX_HOME` | broker：同上，receipt agent/session 必须逐次对账 |
| `orchestrator_dispatch` | `account_id/codex_home` → `.codex-teamN` rw mount | broker：payload authority 删除，dispatcher 只消费 receipt |
| `relay_watchdog_resume` | attempt `account_id`/task `codex_home` 重建挂载 | broker：resume 复用原 lease/session/receipt，不重新选择 home |
| `bridge_run` | bridge 与 receiver/runner 消费 Codex home | broker：只消费 receiver 私有 receipt 目录 |
| `engine_runner` | `runner.sh` 接受/轮换 `CODEX_HOMES` | broker：只接受单一 receipt 私有目录，禁多公司 home fallback |
| `engine_playwright_runner` | playwright runner 同样轮换 `CODEX_HOMES` | broker：同上 |
| `codex_launch` | launcher 接受空/default `CODEX_HOME` | broker：必须提供 receipt 私有目录；空值/default home 失败关闭 |
| `executor_codex_review` | `triggerCodexReview` spawn 时继承全部进程 env | 隔离：固定 `CODEX_REVIEW_HOME` 独立域；清除 `CODEX_HOME/CODEX_RELAY_HOME/OPENAI_API_KEY`，不能 realpath 到公司 roots |
| `executor_dynamic_local` | `triggerLocalCodexExec` 接受 `CODEX_REVIEW_HOME/CODEX_HOME` | 隔离：只允许同一独立 review 域，禁 `CODEX_HOME` fallback 与公司 roots |
| `codex_supervisor` | `spawnSync('codex')` 继承默认 home/env | 隔离：固定 `CODEX_SUPERVISOR_HOME` 独立域并清除公司/API-key fallback |

broker 路统一 oracle：`trigger_count=1`、真实 adapter/PG/receiver、`account_ref/lease_id/session_id/receipt/agent_id` 逐字段对账、`company_auth_reads/company_home_mounts/api_key_fallbacks=0`。隔离路统一 oracle：真实启动该生产函数/脚本与 Codex fixture 进程，独立 root 通过 root-owned allowlist+`realpath` 校验，`company_auth_open_attempts/company_home_mounts/company_env_inherited/api_key_inherited=0`，公司 auth FIFO/canary 未触碰。`docker-executor` 与 `orchestrator/providers/codex.js` 是上述 relay/orchestrator 的通用下游，必须由对应真实触发覆盖；`conversation-capture-codex.js` 只读 session history、无 credential selection/mount，以 source scan `credential_access=false` 登记而非伪装成消费者。

### 用户调用

```text
codex-slot start [--project <safe-segment>] [--name <safe-segment>]
codex-slot stop <handle>
```

- 本机 CLI 走 root-owned adapter，由 Unix peer credential 得到 UID，再查 durable `codex_slot_actor_identities`；UID 不由 argv/body/header 自报。
- SSH key 走 root-owned `authorized_keys` forced-command，固定携带管理员映射 ID/公钥 fingerprint；只解析白名单 `start|stop` 的 `SSH_ORIGINAL_COMMAND`，用户不能改 identity。
- adapter → Brain 固定为 Bearer、`Idempotency-Key`、`X-Codex-Slot-Identity-Kind: uid|ssh_key` 与服务端得到的 opaque mapping ref；acquire body exact `{"name":"...","project":"..."}`，stop body exact `{}`。
- CLI/body 出现 `actor/tenant/team/account/account_ref/host/agent/agent_id/auth/token/accounts` 任一 authority 字段，必须在网络/lease 前 exit 64/HTTP 400；未知或伪造 UID/key mapping 返回 403 且 lease=0。

## Risks

| 风险 | 失败关闭与执行 oracle |
|---|---|
| 任一 `/run` 或非 `/run` 公司账号 consumer 绕过 broker | A01 + B02 对 exact 17 路 inventory 每路真触发；broker 路逐项对账 account_ref/lease/session/receipt/agent，隔离路以独立 root + 公司 auth FIFO/canary 证明物理/配置不可读。 |
| 退役入口、usage/health/runner 或 account-home mount 恢复第二 issuer | B02 保留 `/execute*` 真 410 与 `/accounts` 退役 oracle，同时要求 llm-caller/capacity、dispatch-worker、bridge usage、cron、relay、orchestrator/watchdog、engine runner 全部进入 exact inventory。 |
| UID/key 或客户端 authority 伪造 | A02 + B06 真验 mapped UID/key 成功、未知/伪造 403、CLI/body authority 在网络/lease 前拒绝。 |
| inventory/cutover 部分成功 | B03 authenticated frozen、inventory gate、每个 cutover fault 后 durable state 都必须仍为 frozen。 |
| 同公司账号跨 tenant 并发 | A02 全局 partial unique index + B04 两 tenant 同 `account_ref` 真并发，只准一个 blocking lease。 |
| machine/fleet/slot 与平行表漂移 | 不建 `codex_slot_agents`；B08 直接查 system_registry、fleet freshness、slot capacity，陈旧/缺映射为 0 可用。 |
| commit 后响应丢失或重启造成未知成功 | B05 对每个 durable fault 真 kill/restart/replay，最终一个 lease/session/audit，ID 可重放。 |
| reaper 静默死亡 | B11 连续失败计数持久化，阈值时写 P0 Bark action_receipt；外部 Bark 仅允许本地 capture sink 替代。 |

## Golden Path

冻结旧入口与盘点 → 全局 durable lease/session/audit → 复用 machine/fleet/slot 与 usage/deficit → broker-only receiver → 同一 mmv 判定 launch → stop/reaper 与双机清理

### Step 1：可信身份/authority 先决，旧入口硬停且 cutover 原子开放

**来源**：`[FROM_PRD]` — Golden Path 1 与旧入口失败保持 frozen；`[AI_ADDED]` — Round 2 用合法旧参数 tripwire 防止 `--help` 假绿。

**可观测行为**：mapped UID 与 forced-command SSH key 可 acquire；未知/伪造 identity 403、客户端 authority 64/400 且 lease=0；两个旧脚本零网络硬停；inventory/cutover fault 返回 exact 423 并保持 frozen。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
[ -x "$S" ] || exit 1
"$S" --case frozen-inventory-cutover --json | jq -e '.ok==true and .authenticated_frozen.http_code==423 and .inventory_incomplete.http_code==423 and ([.faults[].rollout_state]|all(.=="frozen")) and .opened.inventory_complete==true'
"$S" --case identity-authority-error-matrix --json | jq -e '.mapped.uid.http_code==201 and .mapped.ssh_key.http_code==201 and .forbidden.unknown.http_code==403 and .forbidden.forged.http_code==403 and .authority.cli.exit_code==64 and .authority.cli.network_attempts==0 and .authority.body.http_code==400 and .leases_created_on_reject==0'
```

**硬阈值**：身份/authority/旧入口拒绝均发生在网络或 lease 前；只有 inventory complete + 全 cutover step durable 后为 open。

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

### Step 4：全部生产 Codex credential consumer 进入 broker 或隔离域

**来源**：`[FROM_PRD]` — broker 唯一 token issuer 与受保护 receiver；`[AI_ADDED]` — Round 5 按当前 main 宽搜结果穷尽 17 路生产 credential consumer，并为每路固定 broker/隔离二选一 oracle。

**可观测行为**：四路 `/run` 与 13 路其余 broker consumer 各有完整 lease/session/receipt；3 路本机执行只见独立凭据域且无法读取公司 auth；broker 分别选 M1/M4 的两次 `location=xian` 到达 receipt 指定 receiver；Round 4 的 `/execute*`、`/health.accounts`、`/accounts` oracle 保持不变。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
"$S" --case production-callers-broker-only --json | jq -e '
  def brokered: .trigger_count==1 and .mode=="broker" and .transport=="real" and .broker.issuer=="broker" and .broker.account_ref==.execution.account_ref and .broker.lease_id==.execution.lease_id and .broker.session_id==.execution.session_id and .broker.receipt==.execution.receipt and .broker.agent_id==.execution.agent_id and .company_auth_reads==0 and .company_home_mounts==0 and .api_key_fallbacks==0;
  def isolated: .trigger_count==1 and .mode=="isolated" and .transport=="real-process" and .process_exit==0 and .isolation.root_allowlisted==true and .isolation.realpath_outside_company_roots==true and .isolation.company_auth_open_attempts==0 and .isolation.company_home_mounts==0 and .isolation.company_env_inherited==0 and .isolation.api_key_inherited==0 and .isolation.company_canary_reads==0;
  .ok==true and
  (.callers|keys==["executor_explicit","executor_xian","executor_xian_m1","harness_relay"]) and
  ([.callers[]|select(.broker.issuer=="broker" and .broker.lease_id==.run.body.slot.lease_id and .broker.session_id==.run.body.slot.session_id and .broker.receipt==.run.body.slot.receipt and .broker.agent_id==.run.body.slot.agent_id and (.run.headers|keys==["authorization","content-type","idempotency-key"]))]|length)==4 and
  ([.callers[].run.body|select(has("account_id") or has("accounts") or has("auth") or has("token") or has("account_ref") or has("github_token") or has("anthropic_api_key"))]|length)==0 and
  (.consumer_inventory|keys==["bridge_account_usage","bridge_run","codex_launch","codex_supervisor","credentials_health_cron","dispatch_worker","engine_playwright_runner","engine_runner","executor_bridge_selector","executor_codex_review","executor_dynamic_local","harness_relay_container","harness_relay_headed","llm_caller","llm_capacity","orchestrator_dispatch","relay_watchdog_resume"]) and
  ([.consumer_inventory|to_entries[]|select(.key!="codex_supervisor" and .key!="executor_codex_review" and .key!="executor_dynamic_local")|select(.value|brokered)]|length)==14 and
  ([.consumer_inventory|to_entries[]|select(.key=="codex_supervisor" or .key=="executor_codex_review" or .key=="executor_dynamic_local")|select(.value|isolated)]|length)==3 and
  .inventory_scan.main_sha=="a1b22bf72618f072f28f61baef4be38a52d1c185" and .inventory_scan.production_paths==17 and .inventory_scan.unclassified_paths==0 and
  .inventory_scan.traced_downstream.docker_executor=="harness_relay_container" and .inventory_scan.traced_downstream.orchestrator_codex_provider=="orchestrator_dispatch" and .inventory_scan.excluded.conversation_capture.credential_access==false and
  ([.cutover.dynamic_xian[].broker.agent_id]|sort)==["xian-m1","xian-m4"] and ([.cutover.dynamic_xian[]|select(.caller=="executor_xian" and .broker.receipt==.run.body.slot.receipt and .broker.agent_id==.run.body.slot.agent_id and .broker.agent_id==.receiver.agent_id)]|length)==2 and
  .cutover.executor.selection_source=="broker_receipt" and .cutover.executor.bridge_health_calls==0 and .cutover.executor.account_health_reads==0 and .cutover.executor.fixed_m4_fallbacks==0 and
  ([.cutover.retired[]|select(.transport=="http" and .request_count==1 and .http_code==410 and .auth_reads==0 and .processes_started==0 and .leases_created==0)]|length)==2 and (.cutover.retired|keys)==["execute","execute_review"] and
  .bridge.local_auth_reads==0 and .bridge.fallback_attempts==0 and .bridge.accounts_code==410 and .bridge.health_has_accounts==false and
  .consumers.brain_meta.source=="account_usage_cache" and .consumers.brain_meta.http_codes==[200,200] and .consumers.credentials_health.source=="account_usage_cache" and .consumers.credentials_health.completed==true and .consumers.bridge_accounts_calls==0 and .consumers.raw_auth_reads==0'
```

**硬阈值**：17/17 production paths 已分类并各真触发一次，14 路 broker 对账、3 路隔离 canary 零触碰、unclassified=0；4/4 caller、M1/M4 与 Round 4 退役/选机/cache oracle 全保留。

### Step 5：prepare/launch 共用 mmv 判定，失败清理

**来源**：`[FROM_PRD]` — Golden Path 4-5 与两次 mmv 重验。

**可观测行为**：双机正常 receive 以 0700/0600 durable 落盘并启动 fixture/tmux；独立 prepare→receive 变化支不读、不写、不 launch 且 lease 保持 blocking；独立 receive→launch 变化支先完成 auth read/0600 write，再拒绝 launch、删 auth/tmux/temp 且 lease 保持 blocked/quarantined。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
for H in xian-m1 xian-m4; do O=$("$S" --case protected-delivery-and-launch --host "$H" --json); printf '%s\n' "$O" | jq -e --arg h "$H" '.ok==true and .host==$h and .normal.received==true and .normal.auth_read==true and .normal.parent_mode=="0700" and .normal.auth_mode=="0600" and .normal.fsync_file==true and .normal.fsync_parent==true and .normal.fixture_sha256==.normal.read_sha256 and .normal.response_secret_bytes==0 and .normal.launch.exit_code==0 and .normal.launch.fixture_pid>1 and .normal.launch.process_running==true and .normal.launch.tmux_present==true and .normal.stop.cleanup.auth_absent==true and .normal.stop.cleanup.tmux_absent==true and .normal.stop.cleanup.temp_absent==true and .normal.stop.cleanup.lease_state=="released" and .prepare.predicate_id==.launch.predicate_id and (.prepare_to_receive.run_id|type=="string" and length>0) and .prepare_to_receive.auth_read==false and .prepare_to_receive.auth_written==false and .prepare_to_receive.launch_attempted==false and (.prepare_to_receive.lease_state=="blocked" or .prepare_to_receive.lease_state=="quarantined") and (.receive_to_launch.run_id|type=="string" and length>0) and .receive_to_launch.run_id!=.prepare_to_receive.run_id and .receive_to_launch.received==true and .receive_to_launch.auth_read==true and .receive_to_launch.auth_written==true and .receive_to_launch.auth_mode=="0600" and .receive_to_launch.fsync_file==true and .receive_to_launch.fsync_parent==true and .receive_to_launch.launch_rejected==true and .receive_to_launch.cleanup.auth_absent==true and .receive_to_launch.cleanup.tmux_absent==true and .receive_to_launch.cleanup.temp_absent==true and (.receive_to_launch.cleanup.lease_state=="blocked" or .receive_to_launch.cleanup.lease_state=="quarantined")' || exit 1; done
```

**硬阈值**：2/2 主机正常链路通过；两支不同 run 各有独立证据，前支零 auth I/O/launch，后支先 0600 durable write 再拒绝并清理，二者都不 release lease。

### Step 6：stop/reaper 精确收口并告警，双机 fake-auth 无残留

**来源**：`[FROM_PRD]` — Golden Path 5-6、两轮 reaper、xian-m1/xian-m4 fake-auth smoke。

**可观测行为**：重复 stop body 相同且 release/audit 各一次；reaper summary 全为非负 integer，不确定状态只 quarantine；连续失败持久计数并写 P0 Bark receipt；双机均清理。

**验证命令**：

```bash
S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
"$S" --case stop-reaper-alert --json | jq -e '.ok==true and .stop.same_body==true and .stop.body.ok==true and (.stop.body.session.session_id|test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) and (.stop.body.session.handle|type=="string" and length>0) and .stop.release_transitions==1 and .stop.audit_events==1 and ([.reaper.summary[]]|all(type=="number" and .>=0 and floor==.)) and .reaper.unreachable_released==0 and .alert.severity=="P0" and .alert.bark_receipt_count==1'
```

**硬阈值**：确认停止才 release；连续失败达到配置阈值时本轮产生且只产生一个 P0 Bark receipt。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 旧入口 | `tests/codex-slot-contract.test.ts` | 旧 codex-request 合法参数在任何网络前 exit 64；旧 codex-remote-launch 合法参数在任何网络前 exit 64 | 当前脚本触发 tripwire 后 exit 1 |
| broker-only consumer | `tests/codex-slot-contract.test.ts` | 全部生产 Codex credential consumer 都有 broker 或物理隔离 oracle；bridge/消费者删除 raw auth fallback、health/accounts 选机依赖 | 当前源码仍直接选择、读取、继承或挂载公司 auth/home |
| 全局租约与 SSOT | `tests/codex-slot-contract.test.ts` | migration 用 account_ref 全局 blocking 唯一且不建 codex_slot_agents；agent 身份容量复用 machine fleet slot SSOT | migration/实现尚不存在 |
| cutover/durable | `tests/codex-slot-contract.test.ts` | authenticated frozen inventory cutover 与 durable crash restart smoke 存在 | smoke 尚不存在 |
| API oracle | `tests/codex-slot-contract.test.ts` | identity authority error matrix 逐响应 body exact 与 stop 类型 exact，acquire stop reap 鉴权幂等 | route 尚不存在 |
| invariant | `tests/codex-slot-contract.test.ts` | 六条 blocking invariant 含 INV-19 全消费者、mmv 两变化支与 INV-27 双 Bash真执行 | smoke/installer 尚不存在 |

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

1. **全部生产 Codex credential consumer ↔ broker/隔离域**：B01/B02 真调用 17 路 exact inventory，未通过前 `logic-done-pending`。
2. **broker ↔ PostgreSQL ↔ machine/fleet/slot/usage**：B03-B08 真 PostgreSQL 与真实模块，不 mock 被改边。
3. **broker/bridge ↔ xian-m1/xian-m4 agent ↔ mmv/FS/tmux**：B09-B12 与 final-e2e 真机验证，未通过前 `logic-done-pending`。

## 禁 mock 边清单

- llm-caller/executor/relay/orchestrator/watchdog/worker/usage/health/runner ↔ broker 或隔离域（B02 必须逐路真触发，禁止 mock consumer）。
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
  def exact_error($http;$code;$message;$retryable): .transport=="http" and .request_count==1 and .http_code==$http and (.body|keys)==["error","ok"] and (.body.ok|type)=="boolean" and .body.ok==false and (.body.error|keys)==["code","message","retryable"] and (.body.error.code|type)=="string" and .body.error.code==$code and (.body.error.message|type)=="string" and .body.error.message==$message and (.body.error.retryable|type)=="boolean" and .body.error.retryable==$retryable;
  def brokered: .trigger_count==1 and .mode=="broker" and .transport=="real" and .broker.issuer=="broker" and .broker.account_ref==.execution.account_ref and .broker.lease_id==.execution.lease_id and .broker.session_id==.execution.session_id and .broker.receipt==.execution.receipt and .broker.agent_id==.execution.agent_id and .company_auth_reads==0 and .company_home_mounts==0 and .api_key_fallbacks==0;
  def isolated: .trigger_count==1 and .mode=="isolated" and .transport=="real-process" and .process_exit==0 and .isolation.root_allowlisted==true and .isolation.realpath_outside_company_roots==true and .isolation.company_auth_open_attempts==0 and .isolation.company_home_mounts==0 and .isolation.company_env_inherited==0 and .isolation.api_key_inherited==0 and .isolation.company_canary_reads==0;
  keys==["callers","consumer_inventory","cutover","errors","global_account","hosts","identity","inventory_scan","ok","reaper","run_id","tenants"] and
  .ok==true and
  (.callers|keys==["executor_explicit","executor_xian","executor_xian_m1","harness_relay"]) and
  ([.callers[]|select(.broker.issuer=="broker" and .broker.lease_id==.run.body.slot.lease_id and .broker.session_id==.run.body.slot.session_id and .broker.receipt==.run.body.slot.receipt and .raw_auth_boundary_bytes==0)]|length)==4 and ([.cutover.dynamic_xian[].broker.agent_id]|sort)==["xian-m1","xian-m4"] and ([.cutover.dynamic_xian[]|select(.broker.receipt==.run.body.slot.receipt and .broker.agent_id==.run.body.slot.agent_id and .broker.agent_id==.receiver.agent_id)]|length)==2 and .cutover.executor.selection_source=="broker_receipt" and .cutover.executor.bridge_health_calls==0 and .cutover.executor.account_health_reads==0 and .cutover.executor.fixed_m4_fallbacks==0 and ([.cutover.retired[]|select(.transport=="http" and .request_count==1 and .http_code==410 and .auth_reads==0 and .processes_started==0 and .leases_created==0)]|length)==2 and (.cutover.retired|keys)==["execute","execute_review"] and .cutover.consumers.brain_meta_source=="account_usage_cache" and .cutover.consumers.credentials_health_source=="account_usage_cache" and .cutover.consumers.bridge_calls==0 and
  (.consumer_inventory|keys==["bridge_account_usage","bridge_run","codex_launch","codex_supervisor","credentials_health_cron","dispatch_worker","engine_playwright_runner","engine_runner","executor_bridge_selector","executor_codex_review","executor_dynamic_local","harness_relay_container","harness_relay_headed","llm_caller","llm_capacity","orchestrator_dispatch","relay_watchdog_resume"]) and
  ([.consumer_inventory|to_entries[]|select(.key!="codex_supervisor" and .key!="executor_codex_review" and .key!="executor_dynamic_local")|select(.value|brokered)]|length)==14 and
  ([.consumer_inventory|to_entries[]|select(.key=="codex_supervisor" or .key=="executor_codex_review" or .key=="executor_dynamic_local")|select(.value|isolated)]|length)==3 and
  .inventory_scan.main_sha=="a1b22bf72618f072f28f61baef4be38a52d1c185" and .inventory_scan.production_paths==17 and .inventory_scan.unclassified_paths==0 and .inventory_scan.traced_downstream.docker_executor=="harness_relay_container" and .inventory_scan.traced_downstream.orchestrator_codex_provider=="orchestrator_dispatch" and .inventory_scan.excluded.conversation_capture.credential_access==false and
  .identity.mapped_uid==201 and .identity.mapped_ssh_key==201 and .identity.unknown==403 and .identity.forged==403 and .identity.authority_cli==64 and .identity.authority_body==400 and .identity.reject_leases==0 and
  (.errors|keys)==["account_busy","agent_unavailable","durability_failed","forbidden_identity","invalid_request","rollout_frozen","unauthenticated"] and (.errors.unauthenticated|exact_error(401;"UNAUTHENTICATED";"authentication required";false)) and (.errors.invalid_request|exact_error(400;"INVALID_REQUEST";"request does not match the exact schema";false)) and (.errors.forbidden_identity|exact_error(403;"FORBIDDEN_IDENTITY";"identity is not mapped";false)) and (.errors.account_busy|exact_error(409;"ACCOUNT_BUSY";"account already has a blocking lease";true)) and (.errors.rollout_frozen|exact_error(423;"ROLLOUT_FROZEN";"codex slot rollout is frozen";true)) and (.errors.agent_unavailable|exact_error(503;"AGENT_UNAVAILABLE";"no healthy codex slot agent available";true)) and (.errors.durability_failed|exact_error(503;"DURABILITY_FAILED";"durable write failed";true)) and
  .global_account.blocking_leases==1 and
  ([.hosts[]|select((.host=="xian-m1" or .host=="xian-m4") and .normal.received==true and .normal.auth_read==true and .normal.parent_mode=="0700" and .normal.auth_mode=="0600" and .normal.fsync_file==true and .normal.fsync_parent==true and .normal.fixture_sha256==.normal.read_sha256 and .normal.response_secret_bytes==0 and .normal.launch.fixture_pid>1 and .normal.launch.process_running==true and .normal.launch.tmux_present==true and .cleanup.auth_absent==true and .cleanup.tmux_absent==true and .cleanup.temp_absent==true and .cleanup.lease_state=="released" and (.prepare_to_receive.run_id|type=="string" and length>0) and .prepare_to_receive.auth_read==false and .prepare_to_receive.auth_written==false and .prepare_to_receive.launch_attempted==false and (.prepare_to_receive.lease_state=="blocked" or .prepare_to_receive.lease_state=="quarantined") and (.receive_to_launch.run_id|type=="string" and length>0) and .receive_to_launch.run_id!=.prepare_to_receive.run_id and .receive_to_launch.received==true and .receive_to_launch.auth_read==true and .receive_to_launch.auth_written==true and .receive_to_launch.auth_mode=="0600" and .receive_to_launch.fsync_file==true and .receive_to_launch.fsync_parent==true and .receive_to_launch.launch_rejected==true and .receive_to_launch.cleanup.auth_absent==true and .receive_to_launch.cleanup.tmux_absent==true and .receive_to_launch.cleanup.temp_absent==true and (.receive_to_launch.cleanup.lease_state=="blocked" or .receive_to_launch.cleanup.lease_state=="quarantined"))]|length)==2 and
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

**PASS**：exit 0；17/17 credential consumer 二选一 oracle、三端点鉴权/七类 Error body exact、全局账号唯一、双机正常链与两段 mmv 变化、租户隔离、reaper/P0 receipt 与 DB 时间窗全部通过。
**FAIL**：任一 shell/Brain/DB/SSH/agent 非零，schema/UUID/enum 不符，raw auth/fallback、并发 blocking lease、secret 或残留出现。
