# Sprint Contract Draft（Round 1）— 完整 Codex Slot 安全硬切换

## 合同 Notes

- 合同基线：`origin/main@0f5d2b65986fc11091bb40532536decd8f9e039f`；旧 PR #4237-#4242 仅用于核对失败历史与边界，禁止合并、cherry-pick 或复制其锁定合同/实现。
- registry 三源已读取；API/DB/test registry 的最近扫描为 2026-07-18，已过 24h 新鲜度阈值，因此字段方案以 PRD 字面约束和当前 `origin/main` 源码为主，新增部分标记 `[NEW_PATTERN]`。
- `GET /api/brain/line/codex-slot-company-access/context-manifest` 当前返回 404；累积 FR 以 PRD 的“本 line 暂无历史”为准，并登记 `context-manifest: unavailable (HTTP 404)`。
- 本仓存在 `packages/brain/src/lib/contract-gate.js`，代码层 Contract Gate 不跳过。
- `journey_type=agent_remote`，不适用 user_facing staging 预览闸。
- 本合同批准只代表逻辑合同成立；xian-m1、xian-m4 真机生命周期未由 proposer 执行，均保持 `logic-done-pending`，须由 final-e2e 真目标通过后才可标 done。

## 锚定父路声明

独立小路（无父路）

## 已知约束（来自回归测试、生产调用方与累积 FR）

- `[scripts/__tests__/codex-request.test.sh]` → 非法/缺失 `--team` 拒绝、拉取后只读、不回传、退出码透传、auth mode 600、禁止 login、48h 新鲜度门。
- `[packages/brain/scripts/smoke/codex-cred-isolation-smoke.sh]` → Brain 内部 Codex 使用前必须复制到独立临时目录，写快照不得污染真实 auth。
- `[scripts/codex-request.sh]` → 当前生产调用形态是 `--team team1..team5` + `scp` 直接取 auth；本 sprint 必须硬切为只给迁移提示。
- `[scripts/codex-remote-launch.sh]` → 当前生产调用形态允许 `--team/--brief/--collect` 并直接推送 auth；本 sprint 必须硬切为只给迁移提示。
- `[docs/handoffs/202607212017-feb1fbb4.md]` → 旧“拉回再回传”曾造成 lost-update，当前单一写者模型不得回退。
- `[真实主机只读探针 2026-07-24]` → xian-m1 SSH 别名自报 hostname 为 `mac-mini-m1-us`，证明名称/别名不能作为身份；xian-m1 的 Tailscale CLI 位于 App bundle，安装器不能假设其在 PATH。
- `[真实主机只读探针 2026-07-24]` → xian-m1、xian-m4 当前选中的 `ExitNodeStatus.ID` 相同；合同只允许与每机 root 配置中的 stable node ID/IP 对账，禁止把本次观测值写死进仓库。
- `[累积FR]` → 本 line 暂无历史。
- `context-manifest: unavailable (HTTP 404)`。

## Response Schema（推导来源：PRD 字面 + 当前 Brain 错误风格 + `[NEW_PATTERN]`）

PRD 未给 HTTP 字段名；以下是本 sprint 新增模式。字段一经合同批准不得改名。

### Endpoint: `POST /api/brain/codex-slots/acquire`

**Success（HTTP 201）**：

```json
{
  "ok": true,
  "session": {
    "session_id": "uuid",
    "handle": "actor/project/name",
    "status": "running",
    "agent_id": "xian-m1|xian-m4",
    "lease_id": "uuid"
  }
}
```

- 顶层 keys 必须完全等于 `["ok","session"]`。
- `ok`（boolean，必填）来源：当前 Brain success 风格。
- `session.session_id`（UUID string，必填）、`handle`（string，必填）、`status`（字面量 `"running"`）、`agent_id`（root 配置的稳定 agent ID）、`lease_id`（UUID string，必填）来源：PRD Golden Path。
- 禁用字段名：`actor`、`team`、`account_ref`、`host`、`token`、`auth`、`auth_json`、`prompt`、`env`。

**Error（HTTP 400/401/409/423/503）**：

```json
{
  "ok": false,
  "error": {
    "code": "string",
    "message": "string",
    "retryable": false
  }
}
```

- 顶层 keys 必须完全等于 `["error","ok"]`。
- `error` 的 keys 必须完全等于 `["code","message","retryable"]`。
- frozen/身份未知/agent 状态不明/容量不明/mmv 不明均 fail closed；通用 404 不得算端点存在。

### Endpoint: `POST /api/brain/codex-slots/:session_id/stop`

**Success（HTTP 200）**：

```json
{
  "ok": true,
  "session": {
    "session_id": "uuid",
    "handle": "actor/project/name",
    "status": "stopped",
    "cleanup": {
      "auth_absent": true,
      "tmux_absent": true,
      "temp_absent": true,
      "lease_state": "released"
    }
  }
}
```

- 顶层 keys 必须完全等于 `["ok","session"]`。
- `cleanup` keys 必须完全等于 `["auth_absent","lease_state","temp_absent","tmux_absent"]`。
- 重复 stop 返回相同 stopped 摘要，不新建审计副作用。

### Endpoint: `POST /api/brain/codex-slots/reap`

**Success（HTTP 200）**：

```json
{
  "ok": true,
  "summary": {
    "checked": 0,
    "heartbeat_updated": 0,
    "released": 0,
    "quarantined": 0
  }
}
```

- 顶层 keys 必须完全等于 `["ok","summary"]`。
- `summary` keys 必须完全等于 `["checked","heartbeat_updated","quarantined","released"]`，值均为非负 integer。
- agent 不可达、响应丢失或元数据不匹配只能增加 `quarantined`，不得增加 `released`。

### Agent protected receiver：`sudo -n /usr/local/libexec/cecelia-codex-slot-agent <health|prepare|receive|launch|status|stop> --json`

**Health success（exit 0）**：

```json
{
  "ok": true,
  "agent": {
    "agent_id": "xian-m1|xian-m4",
    "identity_ok": true,
    "capacity": {"known": true, "available": true},
    "mmv": {
      "online": true,
      "stable_node_id_match": true,
      "ip_allowlist_match": true
    }
  }
}
```

- agent 只从 root-owned 配置读 `agent_id`、容量阈值、`stable_node_id` 与 `allowed_ips`；CLI 参数、hostname、DNS alias、环境变量不得覆盖信任值。
- 认证快照只从受保护 stdin frame 读取，agent 必须先通过 mmv/身份/容量检查再读取；响应禁止回显 frame 内容。

## 真实调用方请求 shape

### 当前生产调用方（必须退役）

1. `scripts/codex-request.sh --team <team1..team5>`；可由 `CODEX_US_HOST` 改目标，直接 `scp "${US_HOST}:~/.codex-${TEAM}/auth.json"` 到本地。
2. `scripts/codex-remote-launch.sh --team <team1..team5> [--brief PATH|--collect]`；可由 `CODEX_REMOTE_HOST` 改目标，直接 push/pull auth 并创建 tmux。
3. 两者均由客户端决定 team/host，正是本 sprint 要硬切掉的 authority path。

硬切后，这两个脚本对任何参数都不得执行 `ssh/scp/codex/tmux`，只输出 `codex-slot start` 迁移提示并退出 `64`；`--help` 可退出 `0`，但同样只能描述迁移。

### 新用户调用方

```text
codex-slot start [--project <safe-segment>] [--name <safe-segment>]
codex-slot stop <handle>
codex-slot status <handle>
```

- 禁止接受：`--actor`、`--team`、`--account`、`--host`、`--agent`、任意 auth/token/path。
- 用户命令只把动作、project/name/handle 交给受控 SSH forced-command 或本机 root adapter。

### 受保护 adapter → Brain（逐字段固定）

```http
POST /api/brain/codex-slots/acquire
Authorization: Bearer <CODEX_SLOT_BROKER_TOKEN>
Content-Type: application/json
Idempotency-Key: <uuid>
X-Codex-Slot-Identity-Kind: uid | ssh_key
X-Codex-Slot-Identity: <numeric uid | SHA256:key-fingerprint>

{"project":"cecelia","name":"main"}
```

- `Authorization` 必须由 root-owned adapter 注入；env 未配置、缺失或错误均返回 503/401，禁止 dev 放行。
- `X-Codex-Slot-Identity*` 只能由 adapter 从 `process.getuid()` 或 forced-command 的 root 映射生成；用户 body 同名字段必须 400。
- Body 顶层 keys 只能是 `["name","project"]`；stop body 只能是 `{}`。
- tenant/actor/team/agent/host 均由服务端 identity map、tenant scope、账号池和 agent registry 推导。

### Broker → agent（受保护 SSH stdin frame）

- SSH 使用专用 key + forced-command，只允许调用 root-owned agent 的白名单动作。
- 第一帧为不含秘密的长度前缀 JSON：`request_id`、`tenant_id`、`lease_id`、`session_id`、`action`。
- 第二帧才是 auth snapshot bytes；agent 在读取第二帧前必须重验 mmv。
- token/auth 不得出现在 argv、env、stdout、stderr、tmux 名、审计 payload 或日志。

## Golden Path

冻结旧入口与可信身份 → durable lease/session/audit → 健康 agent 与固定 mmv → 受保护投递 → launch 二次校验 → stop/reaper 清理与双机 fake-auth smoke

### Step 1：冻结旧入口，只从受控设备身份映射 actor

**来源**：`[FROM_PRD]` — Golden Path 1、边界“旧入口失败保持 frozen”与范围“硬切换旧入口”。

**可观测行为**：

- rollout 初始为 `frozen`，旧会话盘点未确认时 acquire 返回 423。
- 未认证请求返回 401；身份映射不存在返回 403/423，均不写 lease。
- body/CLI 携带 actor/team/host 等 authority 字段立即拒绝。
- 两个旧脚本只给迁移提示，不触碰 auth 或网络。

**验证命令**：

```bash
set -euo pipefail
REQ_HELP=$(bash scripts/codex-request.sh --help)
printf '%s\n' "$REQ_HELP" | grep -q 'codex-slot start'
if printf '%s\n' "$REQ_HELP" | grep -Eq '\bscp\b|拉取.*token|--team'; then
  echo 'FAIL: codex-request 仍描述旧 token 路径' >&2
  exit 1
fi
set +e
AUTHORITY_OUT=$(node scripts/codex-slot-client.mjs start --actor forged --team team1 --host xian-m4 2>&1)
AUTHORITY_RC=$?
set -e
[ "$AUTHORITY_RC" -eq 64 ]
printf '%s\n' "$AUTHORITY_OUT" | grep -q 'authority flags are forbidden'
UNAUTH_CODE=$(curl -sS -o /tmp/codex-slot-unauth.json -w '%{http_code}' -X POST \
  http://localhost:5221/api/brain/codex-slots/acquire \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: contract-unauth-check' \
  -d '{"project":"cecelia","name":"main"}')
[ "$UNAUTH_CODE" = '401' ]
jq -e 'keys == ["error","ok"] and .ok == false and (.error.code | type == "string")' /tmp/codex-slot-unauth.json
```

**硬阈值**：未认证 `401`；frozen `423`；authority fields `400/exit 64`；失败路径新 lease 数为 0。

### Step 2：持久化单账号租约、session 与脱敏审计

**来源**：`[FROM_PRD]` — Golden Path 2、durable write 边界、单槽串行、多租户与凭据安全 invariants。

**可观测行为**：

- 所有表按 `tenant_id` 隔离；同 tenant/account_ref 在 `active|quarantined|blocked` 中至多一行。
- lease、session、rollout 与 audit durable commit 后才返回成功。
- 同一 `Idempotency-Key` 重放返回同一 session/lease，不生成第二份 lease/audit。
- 审计只含 ID、状态和安全摘要，不含 token、prompt、完整 auth、完整 env。

**验证命令**：

```bash
set -euo pipefail
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
INDEX_DEF=$(psql "$DB_URL" -Atqc "SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid = to_regclass('codex_slot_one_blocking_lease_per_account')")
printf '%s\n' "$INDEX_DEF" | grep -q 'account_ref'
printf '%s\n' "$INDEX_DEF" | grep -q 'active'
printf '%s\n' "$INDEX_DEF" | grep -q 'quarantined'
printf '%s\n' "$INDEX_DEF" | grep -q 'blocked'
SMOKE=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
[ -x "$SMOKE" ] || { echo "FAIL: missing $SMOKE" >&2; exit 1; }
OUT=$("$SMOKE" --case durable-idempotent-acquire --json)
printf '%s\n' "$OUT" | jq -e '
  keys == ["ok","session"] and
  .ok == true and
  (.session | keys == ["agent_id","handle","lease_id","session_id","status"]) and
  .session.status == "running"
'
```

**硬阈值**：并发 acquire 恰好 1 个 201，另一请求为同幂等结果或 409；任何 durable write 故障不得留下可分配并发 lease。

### Step 3：只选择身份、容量和固定美国 mmv 均明确健康的 agent

**来源**：`[FROM_PRD]` — Golden Path 3、`target_environment=local_api` 及真实 xian-m1/xian-m4 接缝。

**可观测行为**：

- xian-m1/xian-m4 的 agent_id 来自 root 配置，不等于“SSH 别名/hostname 可信”。
- Tailscale 可执行路径由安装器探测；采样失败、陈旧、多选 exit node、stable node ID 不匹配、允许 IP 不匹配或 offline 均 `available=false`。
- 容量来自 `/System/Volumes/Data` 真采样与 root 配置阈值；未知即不可用。

**验证命令**：

```bash
set -euo pipefail
for HOST in xian-m1 xian-m4; do
  OUT=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" \
    'test -x /usr/local/libexec/cecelia-codex-slot-agent || { echo "RED: agent not installed" >&2; exit 1; }; sudo -n /usr/local/libexec/cecelia-codex-slot-agent health --json')
  printf '%s\n' "$OUT" | jq -e --arg host "$HOST" '
    .ok == true and
    .agent.agent_id == $host and
    .agent.identity_ok == true and
    .agent.capacity.known == true and
    .agent.capacity.available == true and
    .agent.mmv.online == true and
    .agent.mmv.stable_node_id_match == true and
    .agent.mmv.ip_allowlist_match == true
  '
done
```

**硬阈值**：两台目标 agent 均须 `identity_ok/capacity.known/capacity.available/mmv.* = true`；任一 false/缺字段/SSH 非零则本轮不可调度。

### Step 4：broker 经受保护 stdin 投递有限 auth snapshot

**来源**：`[FROM_PRD]` — Golden Path 4、mmv prepare→投递竞态边界、响应只返回摘要。

**可观测行为**：

- broker 是唯一 issuer；client 和旧入口无法读 token。
- agent 在读取第二帧或落盘前重新采样 mmv；prepare 后出口变化则不读取、不写入。
- auth 文件 mode 600，父目录非 group/world 可读；响应只含 receipt/session/state 摘要。
- 投递断线或响应丢失时 lease 进入 `blocked/quarantined`，不得自动复用。

**验证命令**：

```bash
set -euo pipefail
SMOKE=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
[ -x "$SMOKE" ] || { echo "FAIL: missing $SMOKE" >&2; exit 1; }
OUT=$("$SMOKE" --case protected-delivery-race --json)
printf '%s\n' "$OUT" | jq -e '
  .ok == true and
  .before_change.read_auth == false and
  .before_change.wrote_auth == false and
  .normal.mode == "600" and
  .normal.secret_echoed == false and
  .uncertain.lease_state == "quarantined"
'
```

**硬阈值**：mmv 变化时 auth read/write 均为 false；正常 auth mode 精确 600；不确定结果绝不 released。

### Step 5：launch 前二次重验 mmv，失败删除 auth 并拒绝启动

**来源**：`[FROM_PRD]` — Golden Path 5 与“投递和启动之间变化”边界。

**可观测行为**：

- launch 使用与 prepare 相同的 stable node ID/IP 判定函数。
- 二次校验失败时不创建 tmux，删除 auth/临时目录并返回非零。
- 成功时 session/tmux/pid 精确绑定；tmux 或 PID 不匹配视为不确定。

**验证命令**：

```bash
set -euo pipefail
SMOKE=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
[ -x "$SMOKE" ] || { echo "FAIL: missing $SMOKE" >&2; exit 1; }
OUT=$("$SMOKE" --case launch-exit-node-race --json)
printf '%s\n' "$OUT" | jq -e '
  .ok == true and
  .launch_rejected == true and
  .auth_absent == true and
  .tmux_absent == true and
  .temp_absent == true and
  .lease_state != "released"
'
```

**硬阈值**：launch mmv 失败后 auth/tmux/temp 全部 absent，lease 只能 blocked/quarantined，命令非零由 smoke 捕获并断言。

### Step 6：stop/reaper 精确收口，并在两台真机完成 fake-auth 生命周期

**来源**：`[FROM_PRD]` — Golden Path 5-6、真实主机专用假 auth smoke 与“未知状态隔离”边界。

**可观测行为**：

- stop 幂等；只有 agent 精确确认 session_id/agent_id/tmux/pid 停止且 auth/temp 均 absent 才释放 lease。
- reaper 两轮扫描保持真实时间与数据库状态；不可达/响应丢失/元数据不匹配均 quarantine。
- xian-m1 与 xian-m4 分别用专用假 auth fixture 跑 prepare→receive→launch fixture process→stop→cleanup。
- 完成后无 auth、tmux、临时目录或 blocking lease 残留。

**验证命令**：

```bash
set -euo pipefail
SMOKE=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh
[ -x "$SMOKE" ] || { echo "FAIL: missing $SMOKE" >&2; exit 1; }
OUT=$("$SMOKE" --case reaper-two-pass --json)
printf '%s\n' "$OUT" | jq -e '
  .ok == true and
  .first_pass.unreachable_state == "quarantined" and
  (.first_pass.response | keys == ["ok","summary"]) and
  .first_pass.response.ok == true and
  (.first_pass.response.summary | keys == ["checked","heartbeat_updated","quarantined","released"]) and
  .second_pass.unreachable_state == "quarantined" and
  .second_pass.response.summary.released == 0 and
  .confirmed_stop.lease_state == "released"
'
```

**硬阈值**：每台真机 smoke exit 0；两轮不确定扫描 released=0；确认停止后 cleanup 四项全 true；DB blocking lease count=0 且查询带 5 分钟时间窗。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 旧入口硬切 | `tests/codex-slot-contract.test.ts` | 旧 codex-request 只返回 codex-slot start 迁移提示且不再描述 scp；旧 codex-remote-launch 只返回 codex-slot start 迁移提示且不再描述推送 token | 当前 help 仍描述旧 scp/team 流程，断言失败 |
| authority flags | `tests/codex-slot-contract.test.ts` | 新 client 拒绝 actor team host authority flags | client 文件缺失，Node 已启动后 exit code 断言失败 |
| 鉴权与接线 | `tests/codex-slot-contract.test.ts` | Brain codex-slots 路由使用 fail-closed 鉴权且 wiring 存在 | 路由文件缺失断言失败 |
| durable lease | `tests/codex-slot-contract.test.ts` | 数据库含 tenant_id 与单账号阻塞租约唯一约束 | migration 缺失断言失败 |
| 真 PostgreSQL migration | `tests/codex-slot-contract.test.ts` | 真实 PostgreSQL 已应用 tenant-scoped codex_slot schema | psql 真连接后 count=0，值断言失败 |
| mmv/agent 身份 | `tests/codex-slot-contract.test.ts` | agent 使用 root 配置的 mmv stable node ID 和允许 IP 而非 hostname | agent 文件缺失断言失败 |
| reaper | `tests/codex-slot-contract.test.ts` | reaper 两轮扫描对不可达状态保持隔离而不释放 | reaper 文件缺失断言失败 |
| 双机 fake-auth smoke | `tests/codex-slot-contract.test.ts` | smoke 在 xian-m1 与 xian-m4 仅使用专用假 auth 并验证清理 | smoke 文件缺失断言失败 |

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| **FR（做什么）** | 功能需求 | 受控身份映射、自动 agent/account、durable lease/session/audit、broker-only 投递、mmv 双校验、stop/reaper、旧入口硬切、双机 fake-auth smoke。 |
| **NFR（做得多好）** | 性能/可靠性 | fail closed；单账号阻塞租约唯一；所有关键写先 durable commit；installer 同时通过 macOS Bash 3.2 与现代 Bash；日志零 secret/prompt/full auth/env。 |
| **Invariant（永不违反）** | 安全/一致性 | 用户不能指定 actor/team/agent；同 tenant/account 至多一个 active/quarantined/blocked lease；未知状态不释放；真实 token 不进 fixture/CI/log/git。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表。 |
| **保质期（何时过期）** | 数据/配置过期 | agent health 采样、heartbeat、容量采样的 TTL 均来自 root 配置；过期即 unavailable。lease 只有精确 stop receipt 才结束，不因 TTL 自行释放。 |
| **死亡告警（停了谁知道）** | 故障可见性 | scheduler-jobs reaper 连续失败计数；首次失败写 working_memory，连续阈值到达即 P0/Bark，且 API health 暴露最后成功时间。 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 身份/DB/SSH/agent/mmv/容量/回执任一未知都拦截；同 Idempotency-Key 可重试；结果不确定进入 blocked/quarantined。 |
| **效果确认（已发≠已生效）** | 真正生效回执 | acquire 需 agent running + durable registry；stop 需 agent 精确 cleanup receipt + DB released；双机 final-e2e 需真机 auth/tmux/temp absence 与 DB 对账。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ agent 身份是否可信 | A. SSH alias/hostname；B. root 配置 agent_id + 当前 SSH 目标映射 | B | PRD 明禁名称/DNS；实测 xian-m1 alias 与 hostname 不同 | auth 投递到错误机器，直接泄密 |
| ⚠️ 当前出口是否为可信 mmv | A. HostName/DNS；B. `ExitNodeStatus.ID` 精确匹配 root stable ID，IP 集与 root allowlist 对账且 online/唯一选中 | B | PRD 明确 stable node ID/IP，名称不可作信任依据 | 公司账号从错误国家/IP 使用，直接面客与风控风险 |
| agent 容量是否可用 | A. host 自报布尔值；B. agent 当次真采样 `/System/Volumes/Data` 并按 root 阈值判断 | B | PRD 要求容量未知 fail closed | 磁盘不足导致半写 session/auth |
| ⚠️ lease 是否可释放 | A. heartbeat TTL；B. 精确 agent status/stop receipt 对齐 session_id、agent_id、tmux/pid 且 auth/temp absent | B | PRD 明确未知/不可达隔离而不释放 | 同公司账号并发使用或遗留 auth |
| 旧会话盘点是否完成 | A. 文件标志；B. durable rollout state + 审计确认 | B | PRD 要求盘点前冻结，durable write 后才开放 | 旧/新入口并存造成重复租约 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| broker token 未配置/错误 | 503/401，不查身份、不写 DB | 是 | 无开放降级 |
| UID/SSH key 未映射 | 403/423，不创建 lease | 是 | 由管理员补 root/DB 映射后重试 |
| durable write 任一点失败 | rollback；若 agent 结果未知则 blocking/quarantine | 同 Idempotency-Key 是 | 禁止内存成功覆盖 DB 失败 |
| agent 身份/mmv/容量未知 | 503，不投递 auth | 是 | 尝试另一台明确健康 agent；两台均不明则失败 |
| 投递响应丢失 | lease/session quarantine，禁止换账号重试 | 查询同 request_id | 人工或 reaper 精确核验 |
| launch 二次 mmv 失败 | 删除 auth/temp，不创建 tmux；lease blocked/quarantine | stop/cleanup 幂等 | 无放行降级 |
| stop/reaper 不可达或元数据不匹配 | quarantine，不 release | 是 | 恢复连接后精确状态核验 |
| 旧入口被调用 | exit 64 + 迁移提示 | 是 | 只能转 `codex-slot start` |

### 输入对抗面（对外暴露 agent 必填）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| 用户 CLI argv | 不可信 | 不把 argv 拼入 prompt；project/name/handle 严格 safe-segment/长度限制 | 拒绝 actor/team/host/agent/auth/token/path 与未知 flag |
| SSH forced-command 原始命令 | 不可信 | 白名单动作 + 结构化 JSON，不执行任意 shell | forced-command 忽略用户请求的可执行路径；只调用 root agent |
| Brain HTTP body/header | body 不可信；adapter token/身份头仅在 token 通过后可信 | zod exact schema，拒绝额外 keys | fail-closed token + timingSafeEqual + tenant/identity DB 映射 |
| auth snapshot bytes | 高敏感、不可信结构 | 不记录、不解析 prompt；只做大小上限、JSON 最小结构和私有落盘 | 超限/结构异常立即清理并 quarantine |
| agent JSON/stdout | 不可信远端回执 | exact schema、字段长度截断、禁止拼接执行 | session/agent/request ID 任一不匹配即 quarantine |

## 接缝清单

1. **受控身份 adapter ↔ Brain**：真调用方以 Bearer + identity kind/value + Idempotency-Key 发请求；final-e2e 用两 tenant/identity 对账，用户 body 无 authority。当前 `logic-done-pending`。
2. **Brain broker ↔ xian-m1/xian-m4 agent ↔ Tailscale/mmv**：两台真机分别执行 health/prepare/receive/launch/stop，stable ID/IP 只与 root 配置对账。当前 `logic-done-pending`。
3. **agent ↔ 文件系统/tmux ↔ DB registry/reaper**：真机 fixture lifecycle 后检查 auth/tmux/temp absence，真实 PostgreSQL 检查 lease/session/audit。当前 `logic-done-pending`。

## 禁 mock 边清单

- 受控身份 adapter ↔ Brain route（本单改身份跨模块传递，测试不得伪造 route 内 actor）。
- Brain broker/state machine ↔ PostgreSQL `codex_slot_*` 表（本单改 durable write 与状态迁移，必须真 PostgreSQL）。
- broker ↔ xian agent protected receiver（本单改 auth 投递接缝，final-e2e 必须真 SSH 到两台 agent）。
- agent ↔ Tailscale status/root config（本单改 mmv 判定，final-e2e 必须读真状态，不以 HostName/DNS fixture 代替）。
- agent ↔ 私有 auth 文件/tmux（本单改生命周期，必须真落盘、真 tmux/fixture process、真 cleanup）。
- scheduler-jobs ↔ reaper ↔ agent status/DB（本单改周期扫描，必须两轮不重置状态、真实时间流逝）。

仅允许替换最外层 OpenAI 服务：本 sprint 按 PRD 使用专用 fake auth fixture，禁止真实公司 token；该豁免不得替换上述 broker/agent/Tailscale/FS/tmux/DB 接缝。

## 未覆盖真实链路清单

| 未覆盖真实链路点 | 为什么 | 真验证补位计划 |
|---|---|---|
| fake auth fixture 未验证 OpenAI/Codex 第三方真实认证成功 | PRD/NFR 明令 smoke 绝不使用真实公司 token；本 sprint 验的是安全生命周期，不是第三方账号有效性 | 不在自动化中补真实 token；rollout 后由账号持有人在受控生产 session 单次人工确认，证据只记成功/失败摘要，不记 token/prompt。该点不得被表述为本 sprint 已验证。 |
| proposer 阶段未执行 xian-m1/xian-m4 写入型生命周期 | proposer 只起草合同；当前仅执行只读 Tailscale/容量探针 | evaluator final-e2e 在两台真机运行本合同 E2E；通过前保持 `logic-done-pending`。 |

## E2E 验收

**journey_type**：`agent_remote`
**target_environment**：`local_api`（来源：任务 payload；真实主机接缝由脚本经受控 SSH 验收）

```bash
#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
SMOKE="packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh"
[ -x "$SMOKE" ] || { echo "FAIL: missing executable smoke $SMOKE" >&2; exit 1; }

RUN_PREFIX="codex-slot-e2e-$(date +%Y%m%d%H%M%S)-$$"
HOSTS=(xian-m1 xian-m4)
TENANTS=()
HANDLES=()

for HOST in "${HOSTS[@]}"; do
  TENANT_ID=$(node -e "console.log(require('node:crypto').randomUUID())")
  CASE_ID="${RUN_PREFIX}-${HOST}"
  TENANTS+=("$TENANT_ID")

  OUT=$("$SMOKE" \
    --case full-lifecycle \
    --host "$HOST" \
    --tenant-id "$TENANT_ID" \
    --run-id "$CASE_ID" \
    --fixture-id contract-v1 \
    --json)

  printf '%s\n' "$OUT" | jq -e --arg host "$HOST" --arg run "$CASE_ID" '
    keys == ["cleanup","host","ok","run_id","session"] and
    .ok == true and
    .host == $host and
    .run_id == $run and
    (.session | keys == ["agent_id","handle","lease_id","session_id","status"]) and
    .session.agent_id == $host and
    .session.status == "stopped" and
    (.cleanup | keys == ["auth_absent","lease_state","temp_absent","tmux_absent"]) and
    .cleanup.auth_absent == true and
    .cleanup.tmux_absent == true and
    .cleanup.temp_absent == true and
    .cleanup.lease_state == "released"
  '

  HANDLE=$(printf '%s\n' "$OUT" | jq -er '.session.handle')
  HANDLES+=("$HANDLE")

  BLOCKING=$(psql "$DB_URL" -Atqc "SELECT count(*) FROM codex_slot_leases WHERE tenant_id = '$TENANT_ID'::uuid AND request_id = '$CASE_ID' AND state IN ('active','quarantined','blocked') AND updated_at > NOW() - interval '5 minutes'")
  [ "$BLOCKING" -eq 0 ] || { echo "FAIL: $HOST blocking leases=$BLOCKING" >&2; exit 1; }

  STOPPED=$(psql "$DB_URL" -Atqc "SELECT count(*) FROM codex_slot_sessions WHERE tenant_id = '$TENANT_ID'::uuid AND request_id = '$CASE_ID' AND handle = '$HANDLE' AND state = 'stopped' AND updated_at > NOW() - interval '5 minutes'")
  [ "$STOPPED" -eq 1 ] || { echo "FAIL: $HOST stopped session count=$STOPPED" >&2; exit 1; }

  SECRET_ROWS=$(psql "$DB_URL" -Atqc "SELECT count(*) FROM codex_slot_audit_events WHERE tenant_id = '$TENANT_ID'::uuid AND request_id = '$CASE_ID' AND created_at > NOW() - interval '5 minutes' AND payload::text ~* '(access_token|refresh_token|fixture_token|prompt|auth_json)'")
  [ "$SECRET_ROWS" -eq 0 ] || { echo "FAIL: $HOST audit contains forbidden secret fields" >&2; exit 1; }
done

CROSS_A=$(psql "$DB_URL" -Atqc "SELECT count(*) FROM codex_slot_sessions WHERE tenant_id = '${TENANTS[0]}'::uuid AND handle = '${HANDLES[1]}'")
CROSS_B=$(psql "$DB_URL" -Atqc "SELECT count(*) FROM codex_slot_sessions WHERE tenant_id = '${TENANTS[1]}'::uuid AND handle = '${HANDLES[0]}'")
[ "$CROSS_A" -eq 0 ] && [ "$CROSS_B" -eq 0 ] || { echo 'FAIL: tenant data crossed' >&2; exit 1; }

REAPER_OUT=$("$SMOKE" --case reaper-two-pass --run-id "${RUN_PREFIX}-reaper" --json)
printf '%s\n' "$REAPER_OUT" | jq -e '
  .ok == true and
  .first_pass.unreachable_state == "quarantined" and
  (.first_pass.response | keys == ["ok","summary"]) and
  .first_pass.response.ok == true and
  (.first_pass.response.summary | keys == ["checked","heartbeat_updated","quarantined","released"]) and
  .second_pass.unreachable_state == "quarantined" and
  .second_pass.response.summary.released == 0 and
  .confirmed_stop.lease_state == "released"
'

printf 'OK: Codex Slot local control-plane + xian-m1/xian-m4 fake-auth lifecycle verified run=%s\n' "$RUN_PREFIX"
```

**PASS 标准**：脚本 exit 0；两台真机各完成一次专用 fake-auth lifecycle；两 tenant 不串；无 blocking lease/auth/tmux/temp/secret audit 残留。
**FAIL 标准**：任一解释器/SSH/Brain/DB/agent 非零、schema 不符、出口/身份/容量不明、cleanup 不完整或 reaper 误释放。
