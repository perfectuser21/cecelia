# Sprint Contract Draft（Round 2）— Codex Slot 安全硬切换

## 合同边界

- 基线：`440e00ba3c560fada3aa310193cbc6ef330506e1`；合同分支：`cp-07240705-ws-56bf3e23`。
- 交付档位：`segmented`，保留 ws1→ws8 串行链；8 段对应 durable store、身份路由、agent、broker/client、reaper/rollout、旧入口/安装、smoke、版本/终验，均有唯一实现 owner。
- 合同测试是批准后只读法律，不得出现在任何 workstream 的 `files` 写集。
- 在范围内：PRD 10 步、Bash 3.2/现代 Bash、真 PostgreSQL、受控 SSH forced-command、xian-m1/xian-m4 非秘密 fixture 真机接缝。
- 不在范围内：真实公司 token smoke、长期双轨、信任根自动学习、TTL 自动释放、账号计费重做、合并 #4237–#4242。
- `context-manifest: unavailable`：本轮实取该端点仍返回 Cannot GET；按 PRD“本 line 暂无历史”执行。
- contract-gate：仓库内 `packages/brain/src/lib/contract-gate.js` 存在，必须通过。

## 技术上下文与已知约束

- API/DB/test registry 已读取；registry 快照陈旧且未发现 Codex Slot 端点/表，因此本 Sprint 的 CLI JSON 行协议、表与状态是 `[NEW_PATTERN]`，字段以 PRD 字面为最高优先级。
- 现有 `scripts/codex-request.sh` 会从美国机拉取 auth；`scripts/codex-remote-launch.sh` 会直接推 auth 并创建 tmux。两者都是必须硬切的真实旧入口。
- 现有回归 `scripts/__tests__/codex-request.test.sh` 与 `scripts/__tests__/codex-remote-launch.test.sh` 必须随硬切更新；任务计划授权 ws6 修改二者。
- 定时任务唯一注册表为 `packages/brain/src/scheduler-jobs.js:JOBS`，reaper 周期固定 60000 ms。
- [回归测试] `packages/brain/src/routing/resolve-executor.test.js`：agent 候选必须经过 active/capacity/tags 筛选。
- [回归测试] `packages/brain/src/__tests__/codex-bridge-token-inject.test.js`：auth 临时目录隔离、0700 目录、真实持久 auth 不得被回写。
- [累积 FR] 本 line 暂无已验收能力。

## Response Schema（推导来源：PRD 字面 + NEW_PATTERN）

本任务无 HTTP response。生产 client、broker forced-command 与 agent 使用单行 JSON；普通输出禁止附加日志行。

### `acquire` 成功

```json
{"ok":true,"operation":"acquire","request_id":"<opaque>","session_handle":"<opaque>","agent_id":"xian-m1","slot":1,"state":"running","lease_state":"active"}
```

- 顶层 keys 必须精确等于 `["agent_id","lease_state","ok","operation","request_id","session_handle","slot","state"]`。
- `ok=true`；`operation="acquire"`；`request_id/session_handle` 为非空 string；`agent_id` 仅 `xian-m1|xian-m4`；`slot` 为正整数；`state` 仅 `prepared|auth_accepted|running`；`lease_state` 仅 `blocking|active`。acquire 只承诺 durable session，client 用同一 handle status/readback 到 running。

### `status|stop|release` 成功

```json
{"ok":true,"operation":"status","request_id":"<opaque>","session_handle":"<opaque>","agent_id":"xian-m1","slot":1,"state":"running","lease_state":"active","sanitized_reason":null}
```

- 顶层 keys 必须精确等于 `["agent_id","lease_state","ok","operation","request_id","sanitized_reason","session_handle","slot","state"]`。
- `operation` 字面等于本次真实操作；`state` 仅 `prepared|auth_accepted|running|stopped|released|quarantined`；`lease_state` 仅 `blocking|active|quarantined|released`。

### 失败

```json
{"ok":false,"operation":"status","request_id":"<opaque>","error_code":"handle_forbidden","sanitized_reason":"handle_not_owned"}
```

- 顶层 keys 必须精确等于 `["error_code","ok","operation","request_id","sanitized_reason"]`。
- `error_code` 是稳定非秘密代码；跨 actor 句柄固定为 `handle_forbidden`。

**禁用字段名**：`actor`、`actor_id`、`account_key`、`token`、`access_token`、`refresh_token`、`auth`、`auth_json`、`environment`、`claimed_host`。所有 schema oracle 必须执行 `has(...) | not`。

## 真实调用方请求 shape

### 员工设备 → broker forced-command

- 生产入口：`scripts/codex-slot-client.sh <acquire|status|stop|release> ...`。
- transport：client 只执行 `ssh -F "$CODEX_SLOT_SSH_CONFIG" codex-slot@broker codex-slot-broker`，以 stdin 发送一行 JSON；不得拼接用户输入到远端 shell。
- 身份：broker 只读取 sshd 提供的受控 key fingerprint/有效 UID 并映射 actor；`CODEX_SLOT_SSH_CONFIG` 只选择本机受控 key 文件，不能声明 actor。
- `acquire` 请求 keys 精确为 `["operation","repo","request_id"]`；`status|stop|release` 请求 keys 精确为 `["operation","request_id","session_handle"]`。
- client 不接受 `actor/agent/host/slot/account/token/auth` 参数或环境字段；repo 必须是绝对路径，DB 列为 `TEXT`，worktree 派生值存 `TEXT`，不截成 `varchar(n)`。

### broker → xian agent

- transport：固定 `/etc/cecelia/codex-slot/agent_ssh_config`、固定 host key、broker 专用 key；命令仅为 `codex-slot-agent <prepare|accept-auth|launch|status|stop|cleanup>`。
- agent 身份与 `max_slots` 只读 root-owned 配置；broker 不能通过 argv 传入 agent 身份。
- `accept-auth` 元数据仅含 `operation,session_handle,slot,nonce,snapshot_bytes,snapshot_sha256`；snapshot 原始字节只走 stdin，绝不进 argv/env/stdout/audit。
- 独立验收 principal 使用 `/etc/cecelia/codex-slot/audit_ssh_config` 与 forced `codex-slot-audit`，只允许按 handle 读取 `stat/tmux/process/mmv/cleanup` 非秘密事实，不能读取 auth 内容。

## Auth snapshot 安全合同

- 受控来源：`/var/lib/cecelia/codex-slot/accounts/<account_key>/auth.json`；父目录 `0710 root:codex-slot-broker`，文件 `0600 codex-slot-broker:codex-slot-broker`。broker service account 只能读取已租账号文件，员工/agent 无源 store 权限。
- 最大长度：`MAX_AUTH_SNAPSHOT_BYTES=262144`；先 `lstat` 拒绝 symlink/非 regular/非 0600/owner 不符，再限长读取。超限稳定拒绝 `snapshot_too_large`。
- 内存生命周期：每次读取复制到独立 Buffer；完成、失败、timeout 均在 `finally` 以 `buffer.fill(0)` 清零，不缓存、不入 DB。
- 完整性与重放：SHA-256 在 broker 计算、agent 写盘前复算；不一致拒绝 `snapshot_hash_mismatch`。nonce 至少 128 bit、与 session 绑定、durable 单次消费；重放拒绝 `nonce_replayed`。
- 测试只用字面非秘密 fixture；spawn 旧脚本时环境为 `HOME/PATH/TMPDIR/LC_ALL/LANG` allowlist，禁止 `{...process.env}`，避免遗留脚本读取真实 token。

## 八要素需求规范

| 要素 | 本次答案 |
|------|----------|
| **FR** | 完成 PRD 10 步，从受控身份到 broker-only、reaper 与双机安全释放。 |
| **NFR** | 60 秒 reaper；262144-byte snapshot 上限；0600+fsync+rename+父目录 fsync；所有未知 fail closed。 |
| **Invariant** | 单账号最多一个 active/quarantined/blocking lease；broker 唯一 issuer；actor/agent/slot 不可由 client 自报。 |
| **判定点** | 见下表。 |
| **保质期** | 容量/出口样本新鲜度 `0 < freshness <= 60000ms`；nonce 单次；明确 release 后退役 session。 |
| **死亡告警** | scheduler sentinel 记录每轮结果；连续失败计数与既有告警；unreachable 立即 quarantine audit。 |
| **失败语义** | 身份、容量、SSH、出口、写盘、readback 任一未知均拒绝或隔离，不自动 release。 |
| **效果确认** | acquire 查真 PG；auth 查独立 stat/hash；launch 查真 tmux+process；release 查远端清理与 DB 终态。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ actor 是否可信 | client 自报；sshd key/UID | sshd key/UID | PRD 身份法律 | 越权占用公司账号 |
| ⚠️ agent 是否可信且可接单 | host 字符串；root identity+host key+新鲜容量 | 后者 | host 可伪造 | snapshot 发错主机 |
| ⚠️ `mmv` 是否为固定美国出口 | host 名；stable node ID+peer+IP+online+backend+新鲜度 | 后者全满足 | PRD 明确 | auth 泄漏或出口错误 |
| ⚠️ SSH 丢响应后是否成功 | 重试推断；handle 精确 readback | handle readback | 防双租约/双启动 | 误释放活会话 |
| agent/tmux 是否仍活 | 单看 tmux；registry+独立 tmux/process | 双信号 | 防孤儿与漂移 | 错误 heartbeat/release |

notes:
- `judgment-pending-user: actor 是否可信`
- `judgment-pending-user: agent 是否可信且可接单`
- `judgment-pending-user: mmv 是否为固定美国出口`
- `judgment-pending-user: SSH 丢响应后是否成功`

### 失败语义声明

| 场景 | 失败行为 | 重试幂等 | 降级 |
|------|----------|----------|------|
| 身份/容量/host key/`mmv` 无效或过期 | 拒绝 acquire/launch | request_id readback | 无 |
| snapshot oversize/hash/nonce/写盘失败 | 删除临时 auth，不启动 | nonce/session 定点 | 无 |
| SSH/agent 回应丢失或不完整 | quarantine | 只 status/readback | 人工核查 |
| reaper unreachable/mismatch/unknown | quarantine+sanitized audit | 多轮不振荡 | 禁止 TTL release |
| 旧入口调用 | 非零退出、broker-only 指引、零 auth 写入 | N/A | 无双轨 |

### 输入对抗面

| 输入来源 | 信任等级 | 防护 | 越权拒绝 |
|----------|----------|------|----------|
| CLI argv/env/stdin | 不可信 | 精确 keys、限长、shell 安全传参 | 身份/agent/slot/account/auth 字段拒绝 |
| agent JSON | 半可信 | 单行限长 schema、固定 host key | agent_id/slot 与 registry 不符即 quarantine |
| snapshot | 高敏感 | 受控 store、262144 bytes、sha256、zeroize | 仅 broker→agent stdin；错误稳定拒绝 |

## Risks

| 风险 | 影响 | Mitigation / 可执行 oracle |
|------|------|----------------------------|
| broker 误读个人/测试环境真实凭据 | 真实 token 泄漏 | 固定受控 store 权限；合同测试 spawn env allowlist；fixture SHA 扫描 stdout/stderr/audit/sandbox。 |
| snapshot 超限、hash 被换或 nonce 重放 | 内存/写盘滥用、重复授权 | 262144-byte 上限与三个稳定错误码；写盘前无 auth/tmux。 |
| smoke 自报成功但远端事实错误 | 假绿 | evaluator 直接用独立 audit SSH 查 owner/mode/tmux/process/mmv/cleanup，不采信 smoke 布尔值。 |
| 并发/历史 audit 冒充本轮 | 假绿或串会话 | 所有查询同时绑定 `run_id + session_handle + agent_id`，时间仅作附加约束。 |
| 旧入口或 rollout 非原子 | 第二 issuer/部分开放 | 两个旧脚本真执行；blocking lease 和两项证据独立阻断；真 PG 读回原子状态。 |
| 真机不可达 | 无法证明接缝 | 保持 `logic-done-pending`，不得将本地绿标 done。 |

## 禁 mock 边清单

- client ↔ broker forced-command（真实 SSH key/UID、stdin shape、跨 actor handle）。
- broker ↔ 真 PostgreSQL 五张 Codex Slot 表（租约、session、audit、rollout、observation）。
- broker ↔ agent SSH/stdin 与 agent ↔ root 配置/filesystem/tmux/process/`mmv`。
- reaper ↔ registry observation ↔ session 状态；rollout ↔ blocking lease/双证据/旧入口。

## 未覆盖真实链路清单

- 真实公司 token/真实 Codex 登录效果由 PRD 排除；只用非秘密 fixture 证明投递、权限、进程与清理，不宣称登录有效。
- GAN 阶段尚未执行 xian-m1/xian-m4 接缝，状态为 `logic-done-pending`；final evaluator 双机留证后才可 done。
- 本合同无 `force_*`/stub/mock 边豁免；非秘密 fixture 是 PRD 指定输入，不替代真 SSH、tmux、filesystem 或 PG。

## 接缝清单

1. 员工 client→broker forced-command：actor A 成功，actor B 对 A handle 的 status/stop 均稳定拒绝。
2. broker→xian agent→`mmv`：两台分别经固定 host key/stdin，独立 audit principal 读取实时全信号。
3. agent/tmux/filesystem↔PG：同一 handle 的进程、0600 文件、audit 与清理相互对账；未真验即 `logic-done-pending`。

## Golden Path

[受控身份] → [自动 slot] → [durable acquire] → [prepare] → [有限 snapshot stdin] → [`mmv` 双检 launch] → [handle readback] → [reaper] → [rollout/双旧入口硬切] → [双机 release 零残留] → [独立安全复核]

### Step 1：服务器映射可信 actor

**来源**：`[FROM_PRD]` — Golden Path 1。

**可观测行为**：key/UID 固定映射 actor；client 自报字段无效；跨 actor handle 拒绝。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t '受控 SSH key 映射 actor|无 UID/SSH key|actor B 对 actor A handle' --reporter=verbose
```

**硬阈值**：3 tests exit 0；真实 forced-command 跨 actor 拒绝另由 E2E 同一 handle 复验。

### Step 2：自动选择安全可用 agent/slot

**来源**：`[FROM_PRD]` — Golden Path 2。

**可观测行为**：只选 root identity、host key、`mmv`、健康、新鲜容量且有余量的 xian-m1/xian-m4；client 无 host/slot 输入。

**验证命令**：

```bash
npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts -t '自动选择仅接纳|容量缺失' --reporter=verbose
```

**硬阈值**：2 tests exit 0；缺失/零/过期容量均失败。

### Step 3：单账号 durable acquire

**来源**：`[FROM_PRD]` — Golden Path 3。

**可观测行为**：同一公司账号并发只有一个 blocking lease；相同 `request_id` 重放返回同一 handle。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t '单账号并发竞争|相同 request_id' --reporter=verbose
```

**硬阈值**：fulfilled=1、rejected=1、阻塞租约=1；重放 handle 相同。

### Step 4：agent 主机锁内 prepare

**来源**：`[FROM_PRD]` — Golden Path 4。

**可观测行为**：root config 声明 agent_id/max_slots；真实主机锁、worktree 与 0700 session dir 建成。

**验证命令**：

```bash
awk '/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh
```

**硬阈值**：两台真实 acquire 后独立 audit 均见 `auth_mode=0600`、tmux/process alive；无 smoke-only operation。

### Step 5：broker 唯一投递有限 snapshot

**来源**：`[FROM_PRD]` — Golden Path 5。

**可观测行为**：snapshot 只从受控 store 读、仅 stdin 投递、最大 262144 bytes、nonce 单次、hash 匹配、Buffer 清零。

**验证命令**：

```bash
npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-protocol-auth.contract.test.ts -t '受控 credential store|snapshot Buffer|oversize、nonce replay' --reporter=verbose
```

**硬阈值**：合法 fixture 0600；三个错误码逐字匹配；失败不留 auth。

### Step 6：0600 durable auth 与 launch 前二次 `mmv`

**来源**：`[FROM_PRD]` — Golden Path 6。

**可观测行为**：首次全信号通过才写 auth；launch 前再采样，改变任一信号即删除 auth且不建 tmux。

**验证命令**：

```bash
bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh mmv-fail-closed --assert-independent
```

**硬阈值**：独立 audit 证实失败分支 `auth_exists=false,tmux_alive=false,process_alive=false`。

### Step 7：未知结果精确 readback

**来源**：`[FROM_PRD]` — Golden Path 7。

**可观测行为**：未知投递 quarantine；重启后同 handle 可读；actor B 不可 status/stop。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t '未知投递结果|重建实例|actor B' --reporter=verbose
```

**硬阈值**：lease=`quarantined`；handle 不变；跨 actor 两操作均拒绝。

### Step 8：reaper 五分支两轮幂等

**来源**：`[FROM_PRD]` — Golden Path 8。

**可观测行为**：alive→heartbeat、stopped→release、unreachable/mismatch/unknown→quarantine；连续两轮不振荡。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t 'reaper 对' --reporter=verbose
```

**硬阈值**：5 classifications × 2 rounds 均为预期 action；JOBS=60000 ms。

### Step 9：rollout 原子硬切并禁用双旧入口

**来源**：`[FROM_PRD]` — Golden Path 9。

**可观测行为**：成功链 frozen→inventory_complete→broker_only；blocking lease、任一证据缺失均阻断且 DB 不部分写；两个旧脚本非零且零 auth。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t 'rollout|旧入口' --reporter=verbose
```

**硬阈值**：成功链完整；3 类阻断保持 frozen；两个入口各自非零、隔离 HOME 无 auth。

### Step 10：双主机生产调用链安全释放

**来源**：`[FROM_PRD]` — Golden Path 10。

**可观测行为**：两台各自从真实 client acquire，经 broker/agent 到 stop/release；同一 handle 对账 PG/SSH/tmux/worktree。

**验证命令**：

```bash
awk '/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh
```

**硬阈值**：xian-m1/xian-m4 各完整 5 事件；远端与 DB 零残留；审计绑定本轮 handle。

### Step 11：防造假与交付安全复核

**来源**：`[AI_ADDED]` — 闭环 reviewer 指出的 schema、独立 oracle、测试只读与环境继承假绿面。

**可观测行为**：精确 schema/禁用字段、真实 task payload、Bash 双版本、allowlist 最小变更、合同测试只读均通过。

**验证命令**：

```bash
npx vitest run sprints/07240705-relay-56bf3e23/tests --reporter=verbose
node packages/brain/scripts/contract-gate-check.mjs sprints/07240705-relay-56bf3e23
```

**硬阈值**：全部 exit 0；未完成双机接缝不得标 done。

## E2E 验收

**journey_type**：`agent_remote`

**target_environment**：`local_api`（本地 evaluator 编排真 PG 与两台真实 SSH 接缝）

```bash
#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="sprints/07240705-relay-56bf3e23"
TASK_ID="${HARNESS_TASK_ID:-56bf3e23-1bba-4c6a-8d19-e32d5d746395}"
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
ACTOR_A_CONFIG="${CODEX_SLOT_ACTOR_A_SSH_CONFIG:-/etc/cecelia/codex-slot/actor_a_ssh_config}"
ACTOR_B_CONFIG="${CODEX_SLOT_ACTOR_B_SSH_CONFIG:-/etc/cecelia/codex-slot/actor_b_ssh_config}"
AUDIT_CONFIG="${CODEX_SLOT_AUDIT_SSH_CONFIG:-/etc/cecelia/codex-slot/audit_ssh_config}"
RUN_ID="codex-slot-$(date +%s)-$$"
EVIDENCE_DIR="${CODEX_SLOT_EVIDENCE_DIR:-${SPRINT_DIR}/evidence/${RUN_ID}}"
mkdir -p "$EVIDENCE_DIR"
exec > >(tee "$EVIDENCE_DIR/e2e.stdout") 2> >(tee "$EVIDENCE_DIR/e2e.stderr" >&2)
export DB_URL

command -v jq >/dev/null
command -v psql >/dev/null
command -v ssh >/dev/null
for FILE in "$ACTOR_A_CONFIG" "$ACTOR_B_CONFIG" "$AUDIT_CONFIG"; do
  [ -r "$FILE" ] || { echo "FAIL: 缺受控 SSH 配置 $FILE"; exit 1; }
done

TASK_JSON=$(curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}")
echo "$TASK_JSON" | jq -e '.payload.target_environment == "local_api"'

npx vitest run "$SPRINT_DIR/tests" --reporter=verbose

PROVISION=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh provision-e2e --run-id "$RUN_ID")
echo "$PROVISION" | tee "$EVIDENCE_DIR/provision.json" | jq -e --arg run "$RUN_ID" 'keys == ["fixture_sha256","ok","rollout_state","run_id"] and .ok == true and .run_id == $run and .rollout_state == "broker_only" and (.fixture_sha256 | test("^[0-9a-f]{64}$"))'
FIXTURE_SHA=$(echo "$PROVISION" | jq -r '.fixture_sha256')

for HOST in xian-m1 xian-m4; do
  REQUEST_ID="${RUN_ID}-${HOST}"
  bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh set-e2e-capacity --run-id "$RUN_ID" --only-agent "$HOST"

  ACQUIRE=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh acquire --request-id "$REQUEST_ID" --repo "$PWD")
  echo "$ACQUIRE" | tee "$EVIDENCE_DIR/${HOST}-acquire.json" | jq -e --arg req "$REQUEST_ID" --arg host "$HOST" '
    keys == ["agent_id","lease_state","ok","operation","request_id","session_handle","slot","state"] and
    .ok == true and .operation == "acquire" and .request_id == $req and
    .agent_id == $host and (.slot | type == "number") and .slot > 0 and
    (.state == "prepared" or .state == "auth_accepted" or .state == "running") and
    (.lease_state == "blocking" or .lease_state == "active") and
    (. as $o | ["actor","actor_id","account_key","token","access_token","refresh_token","auth","auth_json","environment","claimed_host"] | all(. as $k | $o | has($k) | not))'
  HANDLE=$(echo "$ACQUIRE" | jq -er '.session_handle | select(type == "string" and length > 0)')

  set +e
  FORBIDDEN_STATUS=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_B_CONFIG" scripts/codex-slot-client.sh status --request-id "${REQUEST_ID}-b-status" --session-handle "$HANDLE" 2>&1)
  STATUS_RC=$?
  FORBIDDEN_STOP=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_B_CONFIG" scripts/codex-slot-client.sh stop --request-id "${REQUEST_ID}-b-stop" --session-handle "$HANDLE" 2>&1)
  STOP_RC=$?
  set -e
  [ "$STATUS_RC" -ne 0 ] && [ "$STOP_RC" -ne 0 ]
  printf '%s\n' "$FORBIDDEN_STATUS" > "$EVIDENCE_DIR/${HOST}-actor-b-status.json"
  printf '%s\n' "$FORBIDDEN_STOP" > "$EVIDENCE_DIR/${HOST}-actor-b-stop.json"
  for ERR in "$FORBIDDEN_STATUS" "$FORBIDDEN_STOP"; do
    echo "$ERR" | jq -e 'keys == ["error_code","ok","operation","request_id","sanitized_reason"] and .ok == false and .error_code == "handle_forbidden" and (.sanitized_reason | type == "string")'
  done

  STATUS=""
  for ATTEMPT in $(seq 1 60); do
    STATUS=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh status --request-id "${REQUEST_ID}-status-${ATTEMPT}" --session-handle "$HANDLE")
    STATE=$(echo "$STATUS" | jq -r '.state')
    LEASE_STATE=$(echo "$STATUS" | jq -r '.lease_state')
    [ "$STATE" = "running" ] && [ "$LEASE_STATE" = "active" ] && break
    [ "$STATE" = "quarantined" ] && { echo "FAIL: handle quarantined ${HANDLE}"; exit 1; }
    [ "$ATTEMPT" -eq 60 ] && { echo "FAIL: launch timeout handle=${HANDLE} state=${STATE}"; exit 1; }
    sleep 1
  done
  echo "$STATUS" | tee "$EVIDENCE_DIR/${HOST}-status.json" | jq -e --arg handle "$HANDLE" --arg host "$HOST" '
    keys == ["agent_id","lease_state","ok","operation","request_id","sanitized_reason","session_handle","slot","state"] and
    .ok == true and .operation == "status" and .session_handle == $handle and .agent_id == $host and
    .state == "running" and .lease_state == "active"'

  LIVE=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" codex-slot-audit status "$HANDLE")
  echo "$LIVE" | tee "$EVIDENCE_DIR/${HOST}-live-audit.json" | jq -e --arg handle "$HANDLE" --arg host "$HOST" '
    keys == ["agent_id","auth_exists","auth_mode","auth_owner","backend","mmv_ip","mmv_online","peer","process_alive","sampled_at_epoch","session_handle","stable_node_id","tmux_alive","worktree_exists"] and
    .agent_id == $host and .session_handle == $handle and .auth_exists == true and
    .auth_mode == "0600" and .auth_owner == "codex-slot-agent" and
    .tmux_alive == true and .process_alive == true and .worktree_exists == true and
    .mmv_online == true and (.stable_node_id | type == "string" and length > 0) and
    (.peer | type == "string" and length > 0) and (.mmv_ip | type == "string" and length > 0) and
    (.backend | type == "string" and length > 0) and .sampled_at_epoch >= (now - 60)'

  REAPER_ALIVE=$(node packages/brain/src/codex-slot/cli.js reaper-once --run-id "$RUN_ID" --session-handle "$HANDLE")
  echo "$REAPER_ALIVE" | tee "$EVIDENCE_DIR/${HOST}-reaper-alive.json" | jq -e --arg handle "$HANDLE" '.session_handle == $handle and .classification == "alive" and .action == "heartbeat"'
  STOP=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh stop --request-id "${REQUEST_ID}-stop" --session-handle "$HANDLE")
  echo "$STOP" | tee "$EVIDENCE_DIR/${HOST}-stop.json" | jq -e --arg handle "$HANDLE" '.operation == "stop" and .session_handle == $handle and .state == "stopped" and .lease_state == "active"'
  REAPER_STOPPED=$(node packages/brain/src/codex-slot/cli.js reaper-once --run-id "$RUN_ID" --session-handle "$HANDLE")
  echo "$REAPER_STOPPED" | tee "$EVIDENCE_DIR/${HOST}-reaper-stopped.json" | jq -e --arg handle "$HANDLE" '.session_handle == $handle and .classification == "stopped" and .action == "released"'
  RELEASE=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh release --request-id "${REQUEST_ID}-release" --session-handle "$HANDLE")
  echo "$RELEASE" | tee "$EVIDENCE_DIR/${HOST}-release.json" | jq -e --arg handle "$HANDLE" '.operation == "release" and .session_handle == $handle and .state == "released" and .lease_state == "released"'

  CLEAN=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" codex-slot-audit cleanup "$HANDLE")
  echo "$CLEAN" | tee "$EVIDENCE_DIR/${HOST}-cleanup-audit.json" | jq -e --arg handle "$HANDLE" '
    .session_handle == $handle and .auth_exists == false and .tmux_alive == false and .process_alive == false and .worktree_exists == false'
  SCAN=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" codex-slot-audit scan "$HANDLE" "$FIXTURE_SHA")
  echo "$SCAN" | tee "$EVIDENCE_DIR/${HOST}-scan.json" | jq -e '.fixture_fingerprint_hits == 0 and .forbidden_key_hits == 0 and .sandbox_residue_count == 0'

  EVENTS=$(psql "$DB_URL" -Atc "SELECT string_agg(event, ',' ORDER BY created_at) FROM codex_slot_audit WHERE run_id='${RUN_ID}' AND session_handle='${HANDLE}' AND agent_id='${HOST}' AND event IN ('prepared','auth_accepted','running','stopped','released') AND created_at > NOW() - interval '5 minutes'")
  [ "$EVENTS" = "prepared,auth_accepted,running,stopped,released" ] || { echo "FAIL: audit events=${EVENTS}"; exit 1; }
  ACTIVE=$(psql "$DB_URL" -Atc "SELECT count(*) FROM codex_account_leases WHERE run_id='${RUN_ID}' AND session_handle='${HANDLE}' AND state IN ('active','blocking','quarantined')")
  [ "$ACTIVE" -eq 0 ] || { echo "FAIL: handle 仍有阻塞租约 ${HANDLE}"; exit 1; }
done

if rg -n '(access_token|refresh_token|auth_json|\"tokens\"|prompt|environment)' "$EVIDENCE_DIR"; then
  echo "FAIL: 本轮证据含禁止键"
  exit 1
fi
DUP=$(psql "$DB_URL" -Atc "SELECT count(*) FROM (SELECT account_key FROM codex_account_leases WHERE run_id='${RUN_ID}' AND state IN ('active','blocking','quarantined') GROUP BY account_key HAVING count(*) > 1) d")
[ "$DUP" -eq 0 ] || { echo "FAIL: 本轮重复租约 count=${DUP}"; exit 1; }

echo "Codex Slot Golden Path E2E PASS run_id=${RUN_ID} evidence=${EVIDENCE_DIR}"
```

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/codex-slot-identity-routing.contract.test.ts` | `受控 SSH key 映射 actor` / `自动选择仅接纳身份` | identity/selector 模块不存在 |
| WS2 | `tests/codex-slot-lifecycle.integration.contract.test.ts` | `单账号并发竞争` / `相同 request_id` / `actor B 对 actor A handle` / `未知投递结果` | migration/registry 模块不存在 |
| WS3 | `tests/codex-slot-protocol-auth.contract.test.ts` | `acquire/status/error JSON` / `受控 credential store` / `snapshot Buffer` / `oversize、nonce replay` | protocol/credential-store/agent 模块不存在 |
| WS4 | `tests/codex-slot-reaper-rollout.integration.contract.test.ts` | `rollout 成功` / `blocking lease` / `reaper 对` / `旧入口` / `Bash 3.2` / `scheduler JOBS` | rollout/reaper 未实现，两个旧入口仍 exit 0 |
