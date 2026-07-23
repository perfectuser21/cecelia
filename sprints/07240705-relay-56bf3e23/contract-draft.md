# Sprint Contract Draft（Round 1）— Codex Slot 安全硬切换

## 合同边界

- 基线：`acb49c193e7ea666166df9b9b9c2dc7f4299f3c7`
- 合同分支：`cp-07240705-ws-56bf3e23`
- 交付档位：`segmented`；实现按 `task-plan.json` 的 ws1→ws8 串行推进。
- 在范围内：受控身份、自动 agent/slot、公司账号单租约、broker 唯一发 token、xian-m1/xian-m4 agent、固定 `mmv` 出口校验、durable registry、readback、reaper、rollout gate、旧入口硬禁用、安装和两台真机假 token smoke。
- 不在范围内：真实公司 token smoke、长期双轨、按主机名学习信任根、TTL 自动释放、账号计费策略、直接合并 #4237–#4242。
- `context-manifest: unavailable`：`GET /api/brain/line/codex-slot-company-access/context-manifest` 当前返回 Cannot GET；采用 PRD 的“本 line 暂无历史”字面约束。
- contract-gate：`packages/brain/src/lib/contract-gate.js` 存在，必须通过代码层 Contract Gate。

## 技术上下文与已知约束

- API registry 未发现现成 Codex Slot broker 端点；本 Sprint 不新增 PRD 未要求的 HTTP API，采用本地 client CLI + 受控 SSH forced-command + stdin 协议，标记 `[NEW_PATTERN]`。
- DB registry 未发现 Codex Slot lease/session/account 表；新增表必须使用仓库 migration runner，状态字面值只允许合同定义集合。
- 现有生产入口 `scripts/codex-request.sh` 允许西安主动拉 auth；本 Sprint 进入 `broker_only` 前必须把它改成无条件硬失败，且探针证明不会写 auth。
- 现有 `scripts/codex-remote-launch.sh` 会直接推 auth 并启动 tmux；它同属旧直达入口，必须硬失败或仅转交 broker，不得保留第二个 token issuer。
- 定时任务权威注册表是 `packages/brain/src/scheduler-jobs.js:JOBS`，不是 deprecated tick 路径；reaper 必须在这里以 60 秒周期接线。
- [回归测试] `packages/brain/src/routing/resolve-executor.test.js` → agent 候选必须经过 active/capacity/required tags 筛选，未知 task type 不得误路由到西安。
- [回归测试] `packages/brain/src/__tests__/codex-bridge-token-inject.test.js` → auth 使用隔离临时目录、目录权限 0700、真实持久 auth 不被临时会话回写。
- [回归测试] `scripts/__tests__/codex-request.test.sh` → 旧入口当前是“只读借用”模型；硬切后这些断言必须改为“立即拒绝且零写盘”。
- [历史退役检查] 已执行 `git log --all --diff-filter=D --name-only -- '*codex*'`；删除历史主要是已归档 Sprint 测试/旧 harness 图与文档，没有可直接复活的 Codex Slot broker 实现，故从 main 独立实现。
- [累积 FR] 本 line 暂无已验收能力，不重复旧草稿栈。

## Response Schema（推导来源：PRD 字面 + NEW_PATTERN）

本任务无 HTTP response。以下是 client/broker/agent 内部 JSON 行协议；字段名来自 PRD 字面意图，未被 registry 覆盖。

### `acquire` 成功 stdout

```json
{"ok":true,"operation":"acquire","session_handle":"<opaque>","agent_id":"xian-m1|xian-m4","slot":1,"lease_state":"blocking|active"}
```

- `ok`（boolean，必填）：命令是否成功。
- `operation`（string literal `acquire`，必填）：禁止缩写。
- `session_handle`（string，必填）：可 readback 的不透明句柄，不含 actor/account/token。
- `agent_id`（enum `xian-m1|xian-m4`，必填）：来自 root 配置与 agent 自证。
- `slot`（positive integer，必填）：由新鲜容量自动选择，客户端不能指定。
- `lease_state`（enum `blocking|active`，必填）：durable write 后才可返回。

### `status` 成功 stdout

```json
{"ok":true,"operation":"status","session_handle":"<opaque>","state":"prepared|auth_accepted|running|stopped|quarantined","lease_state":"blocking|active|quarantined|released","agent_id":"xian-m1|xian-m4","slot":1,"sanitized_reason":null}
```

### 失败 stdout/stderr JSON

```json
{"ok":false,"operation":"<operation>","error_code":"<stable_code>","sanitized_reason":"<non-secret>"}
```

**禁用字段名**：`actor`、`actor_id`、`account_key`、`token`、`auth`、`auth_json`、`environment`、`claimed_host` 不得出现在普通 client stdout；审计和错误不得包含 prompt、完整环境、auth snapshot。

## 真实调用方请求 shape

### 员工设备 → broker

- 认证：受控 SSH key/服务器有效 UID；actor 在 server-side forced-command/root 配置中映射。客户端 body、环境变量、`--actor`、`--host` 一律不是身份源。
- 调用：`scripts/codex-slot-client.sh acquire --repo <absolute-repo>` 或 `resume --session-handle <opaque>`。
- `acquire` 可提交字段仅为 `request_id`、`operation="acquire"`、`repo`；不得提交 actor、agent、host、slot、account 或 token。
- `resume/status/stop` 可提交字段仅为 `request_id`、`operation`、`session_handle`；broker 仍以受控身份核对句柄归属。
- SSH forced-command 必须丢弃危险环境变量，只保留受控 locale/terminal 字段；headed 人工接管与 headless 都走同一身份映射，不以 tty/headed 状态放宽白名单。

### broker → xian agent

- 认证：固定 `/etc/cecelia/codex-slot/ssh_config` 中 broker 专用 key、固定 host key 和 allowlist；agent 从 root-owned 配置声明自身 `agent_id`/`max_slots`，不接收 broker 传入的 host 身份。
- 命令：`ssh -F /etc/cecelia/codex-slot/ssh_config codex-slot@<agent> codex-slot-agent <prepare|accept-auth|launch|status|stop|cleanup> ...`。
- `accept-auth` 参数只含 `session_handle`、`slot`、一次性 `nonce`、`snapshot_bytes`、`snapshot_sha256`；auth snapshot 作为有限长度 stdin 原始字节流传入，不出现在 argv、环境或日志。
- stdout 只允许一行 sanitized JSON：`ok`、`operation`、`session_handle`、`state`、`agent_id`、`slot`、`mmv_verified`、`sanitized_reason`。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 对外承诺 | 完成 PRD 10 步安全生命周期并硬切 broker-only。 |
| **NFR（做得多好）** | 性能/可靠性 | reaper 60 秒；容量/出口只用受控新鲜样本；durable write 为 0600 临时文件+fsync+原子 rename+父目录 fsync；所有未知 fail closed。 |
| **Invariant（永不违反）** | 安全/一致性 | 单账号最多一个 active/quarantined/blocking lease；broker 是唯一 issuer；客户端不能决定身份/agent/slot；未知结果不 release。 |
| **判定点（怎么知道）** | 外部状态判断 | 见下表。 |
| **保质期（何时过期）** | 数据失效 | 容量与 `mmv` 样本新鲜度由 root 配置给出且测试断言 `0 < freshness <= reaper interval`；nonce 单次消费；session 到明确 release 后才退役。 |
| **死亡告警（停了谁知道）** | 停止可见性 | scheduler sentinel 记录每轮 reaper 成败；连续失败触发既有告警通道；agent unreachable 立即形成 quarantine 审计。 |
| **失败语义（挂了怎么办）** | 拦截/重试 | 身份、容量、SSH、出口、写盘、readback 任一未知均拦截或隔离；相同 request id 幂等 readback，不推断成功。 |
| **效果确认（已发≠已生效）** | 真回执 | acquire 以 DB durable row 为准；auth 以 agent sha256+0600+fsync 回执为准；launch 以真 tmux+进程状态为准；release 以 agent 清理和 DB 终态双确认。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ actor 是否可信 | A. 客户端自报；B. 有效 UID/受控 SSH key 映射 | B | PRD 身份法律 | 越权使用公司账号 |
| ⚠️ agent 是否可信且可接单 | A. host 字符串；B. root agent_id + host key + 新鲜容量 | B | host 字符串可伪造 | token 投递到错误主机 |
| ⚠️ `mmv` 是否为固定美国出口 | A. 主机名；B. stable node ID+peer+IP+online+backend+新鲜度全校验 | B | PRD 明确要求全部信号 | auth 泄露或流量走错出口 |
| ⚠️ SSH 丢响应后是否已生效 | A. 推断失败并重试；B. session handle 精确 readback | B | 重试可能双租约/双启动 | 双占账号或误释放活会话 |
| agent/tmux 是否仍活 | A. 单看 tmux；B. broker registry + agent/tmux 双信号 | B | 单信号会漏孤儿/漂移 | 活会话被释放或僵尸不回收 |

notes:
- `judgment-pending-user: actor 是否可信`
- `judgment-pending-user: agent 是否可信且可接单`
- `judgment-pending-user: mmv 是否为固定美国出口`
- `judgment-pending-user: SSH 丢响应后是否已生效`

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 身份/容量/host key/`mmv` 无效或过期 | 拒绝 acquire/launch，不写 active | 是，request_id 定点 readback | 无自动降级 |
| durable write 任一步失败 | 不确认 acquire，不开放 rollout | 是，事务+唯一约束 | 保持 frozen/blocking |
| SSH/agent 回应丢失或不完整 | lease 置 quarantined | 是，只允许 status/readback | 人工核查后明确 release |
| reaper unreachable/mismatch/unknown | quarantine + sanitized audit | 是，多轮重复不振荡 | 不按 TTL release |
| 旧入口调用 | 非零退出并指向新 client | N/A | 绝不写 auth |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| 员工 CLI 参数/环境 | 不可信 | 不把参数拼入 prompt；repo/session 结构校验和 shell 安全传参 | actor/agent/slot/account/token 字段拒绝；身份只取 server context |
| SSH agent stdout | 半可信远端 | 只解析有长度上限的单行 JSON schema，不执行返回文本 | agent_id/slot 必须与 registry 匹配，否则 quarantine |
| auth snapshot | 高敏感、不可信结构 | 限长、JSON shape 校验、禁止日志 | 仅 broker→agent stdin；nonce/sha256/0600 验证失败即删除 |

## 禁 mock 边清单

- 员工 client ↔ broker forced-command（身份、请求 shape、session readback 均须真调用）。
- broker ↔ PostgreSQL `codex_company_accounts` / `codex_account_leases` / `codex_slot_sessions` / `codex_slot_audit`（租约、状态、幂等须真 Postgres）。
- broker ↔ xian agent SSH/stdin（auth 投递与 unknown result 须真 SSH；只允许在纯逻辑单测 mock 与本边无关的通知）。
- agent ↔ root 配置 / 私有文件 / tmux / Codex 进程（prepare、0600 durable auth、launch/cleanup 须真文件系统与真进程）。
- reaper ↔ broker registry ↔ agent/tmux（真实多轮扫描，不得 mock registry 或 agent 状态边）。
- rollout gate ↔ legacy 入口（必须真运行旧脚本并证明非零退出与零 auth 写入）。

## 未覆盖真实链路清单

- 真实公司 token：PRD 明确排除；真机 smoke 使用两台各自独立、明显无效且不含秘密的 auth fixture。补位：本 Sprint 只证明投递/权限/进程/清理链，真实账号登录效果不宣称 done。
- xian-m1/xian-m4 真机接缝在 GAN 阶段尚未执行：Generator 完成逻辑后状态只能 `logic-done-pending`；Evaluator 必须分别留存真机 smoke JSON/日志，均通过后才可 done。
- 本合同无 `force_*`、stub、假 host/假 `mmv` 值豁免；专用假 auth fixture 是 PRD 指定的非秘密验收输入，不替代真实主机/SSH/tmux/文件系统。

## 接缝清单

1. client/broker 身份与 forced-command：在真实受控 SSH 配置下，MacBook Air key 可映射，伪造 actor/host 不可改变身份。
2. broker/agent/`mmv`：在 xian-m1、xian-m4 分别真 SSH，读取 root agent 身份与实时 `mmv` stable node ID/peer/IP/online/backend；任何一项错均 fail closed。
3. agent/tmux/filesystem/DB：两台真机分别用专用假 auth 完成 prepare→deliver→launch→status→stop→release，并在真 Postgres 和远端目录核对零残留。

未完成上述接缝真验时统一标记 `logic-done-pending`。

## Golden Path

[受控身份进入] → [安全 agent/slot 自动选择] → [durable acquire] → [agent prepare] → [broker stdin 投递] → [`mmv` 双检后 launch] → [status/readback] → [reaper] → [rollout 硬切] → [双真机 smoke 零残留]

### Step 1：服务器映射可信 actor

**来源**：`[FROM_PRD]` — Golden Path 1、NFR“身份与授权”。

**可观测行为**：有效 UID/受控 SSH key 映射固定 actor；`--actor`、环境 actor 与 claimed host 不能改变结果，无映射立即失败。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts -t '受控 SSH key 映射 actor 且忽略客户端 actor/host 自报|无 UID/SSH key 映射时 fail closed' --reporter=verbose
```

**硬阈值**：两条身份断言 exit 0；伪造字段不进入输出。

### Step 2：自动选择安全可用 agent/slot

**来源**：`[FROM_PRD]` — Golden Path 2、边界“容量缺失/为零/过期不可选”。

**可观测行为**：只在 xian-m1/xian-m4 同级候选中选择 root 身份、host key、`mmv`、健康和新鲜容量全部通过且有余量的 slot；客户端不能指定。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts -t '自动选择仅接纳身份、mmv、容量与新鲜度全部有效的 agent slot|容量缺失、零容量或过期时不选择任何 agent' --reporter=verbose
```

**硬阈值**：有效候选唯一确定；全部无效时非零失败，无 fallback host。

### Step 3：broker 先 durable write 再确认 acquire

**来源**：`[FROM_PRD]` — Golden Path 3、NFR“一致性”。

**可观测行为**：rollout gate 允许后，broker 在真 Postgres 事务内选择唯一未占账号，写 lease/session 后返回 handle；同一账号不会出现两个 blocking/active/quarantined lease。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t 'durable acquire 对同一公司账号只产生一个 blocking lease|相同 idempotency key 重放返回同一 session handle' --reporter=verbose
```

**硬阈值**：真 Postgres 中重复 blocking lease 行数为 0；幂等重放 lease 行数为 1。

### Step 4：agent 在主机锁内 prepare

**来源**：`[FROM_PRD]` — Golden Path 4。

**可观测行为**：agent 从 root 配置读取真实 agent_id/max_slots；持有主机锁后准备独立 worktree、0700 私有目录和一次性 nonce，slot 内不并发。

**验证命令**：

```bash
for HOST in xian-m1 xian-m4; do
  RESP=$(ssh -F /etc/cecelia/codex-slot/ssh_config "codex-slot@${HOST}" codex-slot-agent prepare-smoke)
  echo "$RESP" | jq -e --arg host "$HOST" '.ok == true and .operation == "prepare" and .agent_id == $host and (.slot | type == "number") and .lock_held == true and .private_mode == "0700" and (.nonce_id | type == "string")'
done
```

**硬阈值**：两台均 exit 0；`lock_held=true`、`private_mode="0700"`、nonce 非空；任一 SSH/shape 异常即失败。

### Step 5：broker 唯一投递有限 auth snapshot

**来源**：`[FROM_PRD]` — Golden Path 5、NFR“安全”。

**可观测行为**：broker 经固定 SSH config 与 stdin 投递有限长度 snapshot；argv/env/stdout/audit 无 auth；agent 消费一次性 nonce 并在写盘前实时校验 `mmv` 全信号。

**验证命令**：

```bash
for HOST in xian-m1 xian-m4; do
  OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --phase deliver-only)
  echo "$OUT" | jq -e --arg host "$HOST" '.ok == true and .agent_id == $host and .stdin_delivery == true and .nonce_consumed == true and .mmv_verified == true and .auth_logged == false'
done
```

**硬阈值**：两台均 stdin 投递、nonce 单次消费、`mmv_verified=true`、`auth_logged=false`。

### Step 6：0600 durable auth 与 launch 前二次 `mmv` 校验

**来源**：`[FROM_PRD]` — Golden Path 6。

**可观测行为**：第一次 `mmv` 全校验后才以 0600+fsync+rename+parent fsync 写 auth；launch 前二次校验。出口切换时删除暂存 auth且不创建 tmux。

**验证命令**：

```bash
for HOST in xian-m1 xian-m4; do
  OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --phase launch-fail-closed)
  echo "$OUT" | jq -e --arg host "$HOST" '.ok == true and .agent_id == $host and .auth_mode == "0600" and .durable_write == true and .mmv_checks == 2 and .bad_exit_rejected == true and .bad_exit_auth_removed == true and .bad_exit_tmux_created == false'
done
```

**硬阈值**：两台双检恰为 2；坏出口分支 auth 删除且 tmux 未创建。

### Step 7：未知结果精确 readback

**来源**：`[FROM_PRD]` — Golden Path 7、边界“丢响应只隔离”。

**可观测行为**：resume/status 只接受 session handle 并核对 actor；SSH 未知结果进入 quarantine，重放只 readback，不自行 stop/release。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t '未知投递结果只 quarantine|durable store 重建实例后仍可按 session handle readback' --reporter=verbose
```

**硬阈值**：未知结果最终 lease_state=`quarantined`；重建实例仍返回同一 handle。

### Step 8：reaper 每分钟按 registry 收敛

**来源**：`[FROM_PRD]` — Golden Path 8、边界“重跑幂等”。

**可观测行为**：reaper 以 broker registry 为唯一状态源，对 alive/stopped/unreachable/mismatch/unknown 分别 heartbeat/release/quarantine/quarantine；跨真实两轮不振荡。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t 'reaper 两轮真实时间流逝不重置状态|scheduler JOBS 真实接线' --reporter=verbose
```

**硬阈值**：JOBS intervalMs=60000；两轮间真实等待≥1秒且 quarantine 不回退/release。

### Step 9：rollout 原子硬切并禁用旧入口

**来源**：`[FROM_PRD]` — Golden Path 9。

**可观测行为**：`frozen→inventory_complete→broker_only` 仅在存量盘点、blocking lease 收敛和所有旧入口“不可写 auth”探针通过后原子切换；旧 `codex-request` / `codex-remote-launch` 立即非零失败或转 broker。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t 'rollout 在 inventory_complete|旧 codex-request 入口硬失败' --reporter=verbose
```

**硬阈值**：越级 transition 被拒；旧入口 exit≠0 且测试 HOME 内 auth.json 不存在。

### Step 10：xian-m1/xian-m4 真机假 token 全生命周期

**来源**：`[FROM_PRD]` — Golden Path 10、E2E 验收。

**可观测行为**：两台主机各用不同的非秘密 fixture 经真实 SSH/stdin/tmux/worktree 完成 prepare→deliver→launch→status→stop→release，结束无 auth/tmux/worktree/lease 残留。

**验证命令**：

```bash
START_EPOCH=$(date +%s)
for HOST in xian-m1 xian-m4; do
  OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --full)
  echo "$OUT" | jq -e --arg host "$HOST" --argjson start "$START_EPOCH" '.ok == true and .agent_id == $host and .fixture_is_secret == false and .mmv_verified == true and .lifecycle == ["prepared","auth_accepted","running","stopped","released"] and .residue_count == 0 and .finished_at_epoch >= $start'
done
```

**硬阈值**：两台均 exit 0、完整 5 状态序列、`residue_count=0`、证据时间不早于本轮开始。

### Step 11：防造假与安全回归

**来源**：`[AI_ADDED]` — 防止只跑冷启动、文本自证或历史 smoke 产物冒充本轮。

**可观测行为**：所有合同测试真红→实现后真绿；日志/审计扫描无 auth/token/prompt/完整环境；多轮 reaper 与 broker restart 仍满足不变量。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests --reporter=verbose
bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh | jq -e '.ok == true and .secret_hits == 0 and .duplicate_blocking_leases == 0 and .state_oscillations == 0'
```

**硬阈值**：Vitest exit 0；security smoke 三个计数均为 0。

## E2E 验收

**journey_type**：`agent_remote`

**target_environment**：`local_api`（本地 evaluator 编排 xian-m1/xian-m4 真实 SSH 接缝）

```bash
#!/usr/bin/env bash
set -euo pipefail

SPRINT_DIR="sprints/07240705-relay-56bf3e23"
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"
export DB_URL
START_EPOCH=$(date +%s)

command -v jq >/dev/null
command -v psql >/dev/null
command -v ssh >/dev/null
command -v tmux >/dev/null

# 模式 A：真 Postgres + 真模块，不 mock 被改边。
npx vitest run "${SPRINT_DIR}/tests" --reporter=verbose

# 身份伪造、错误 host/容量/出口/SSH 未知结果 fail closed。
SECURITY=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh)
echo "$SECURITY" | jq -e '.ok == true and .actor_spoof_rejected == true and .host_spoof_rejected == true and .missing_capacity_rejected == true and .bad_mmv_rejected == true and .unknown_ssh_quarantined == true and .secret_hits == 0'

# rollout 必须已按 inventory_complete + legacy probe 原子切到 broker_only。
ROLLOUT=$(node packages/brain/src/codex-slot/cli.js rollout-status)
echo "$ROLLOUT" | jq -e '.ok == true and .operation == "rollout-status" and .state == "broker_only" and .inventory_complete == true and .legacy_write_probe_passed == true'

# 两台分别生成专用非秘密 fixture，走真实 SSH/stdin/tmux/worktree。
for HOST in xian-m1 xian-m4; do
  OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --full)
  echo "$OUT" | jq -e --arg host "$HOST" --argjson start "$START_EPOCH" '.ok == true and .agent_id == $host and .fixture_is_secret == false and .stdin_delivery == true and .mmv_verified == true and .lifecycle == ["prepared","auth_accepted","running","stopped","released"] and .residue_count == 0 and .finished_at_epoch >= $start'
done

# 本轮审计须新鲜、sanitized，且不存在重复阻塞租约。
AUDIT_COUNT=$(psql "$DB_URL" -Atc "SELECT count(*) FROM codex_slot_audit WHERE event IN ('prepared','auth_accepted','running','stopped','released') AND created_at > NOW() - interval '5 minutes'")
[ "$AUDIT_COUNT" -ge 10 ] || { echo "FAIL: 本轮双机审计不足 count=${AUDIT_COUNT}"; exit 1; }
DUP_COUNT=$(psql "$DB_URL" -Atc "SELECT count(*) FROM (SELECT account_key FROM codex_account_leases WHERE state IN ('active','quarantined','blocking') GROUP BY account_key HAVING count(*) > 1) d")
[ "$DUP_COUNT" -eq 0 ] || { echo "FAIL: 存在重复 blocking lease count=${DUP_COUNT}"; exit 1; }
SECRET_COUNT=$(psql "$DB_URL" -Atc "SELECT count(*) FROM codex_slot_audit WHERE created_at > NOW() - interval '5 minutes' AND metadata::text ~* '(access_token|refresh_token|auth_json|prompt|environment)'")
[ "$SECRET_COUNT" -eq 0 ] || { echo "FAIL: 审计疑似泄密 count=${SECRET_COUNT}"; exit 1; }

echo "Codex Slot Golden Path E2E PASS"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 受控身份与自动 slot | `sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts` | `受控 SSH key 映射 actor 且忽略客户端 actor/host 自报`；`自动选择仅接纳身份、mmv、容量与新鲜度全部有效的 agent slot` | identity/selector 模块不存在，4 tests fail |
| durable lease/session | `sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts` | `durable acquire 对同一公司账号只产生一个 blocking lease`；`未知投递结果只 quarantine`；`durable store 重建实例后仍可按 session handle readback` | 真 PG 表/registry 模块不存在，4 tests fail |
| rollout/reaper/旧入口 | `sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts` | `rollout 在 inventory_complete 与旧入口禁写证据前拒绝 broker_only`；`旧 codex-request 入口硬失败且不创建 auth.json`；`reaper 两轮真实时间流逝不重置状态`；`scheduler JOBS 真实接线 codex-slot-reaper 且周期为 60 秒` | rollout/reaper 模块和 JOBS 接线不存在，旧入口 `--help` 仍 exit 0，4 tests fail |
