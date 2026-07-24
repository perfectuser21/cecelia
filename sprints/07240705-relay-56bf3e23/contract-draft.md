# Sprint Contract Draft（Round 4）— Codex Slot 安全硬切换

## 合同边界

- 修订基线：`90f3df1ca7634efe1d2a371bb4630a7f59dd1193`；合同分支：`cp-07240705-ws-56bf3e23`。
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
- 已逐行读取 `.github/workflows/ci.yml`、`ci-smoke-glob-runner.yml` 与 `nightly-real-machine.yml`：PR Ubuntu job 不收 `sprints/**` tests，且 `packages/brain/scripts/smoke/*.sh` 会在无 xian SSH 配置的 Ubuntu 无条件运行。
- [回归测试] `packages/brain/src/routing/resolve-executor.test.js`：agent 候选必须经过 active/capacity/tags 筛选。
- [回归测试] `packages/brain/src/__tests__/codex-bridge-token-inject.test.js`：auth 临时目录隔离、0700 目录、真实持久 auth 不得被回写。
- [累积 FR] 本 line 暂无已验收能力。

## 验收宿主矩阵与持续回归

| 宿主 | 只负责 | 持续回归入口 | 明确不负责 |
|------|--------|--------------|------------|
| Ubuntu PR CI | 真 PostgreSQL registry/reaper/rollout、进程级 protocol/auth、隔离 real sshd + production audit forced-command probe、CI-safe security smoke | 既有 `ci.yml` 的 `brain-unit`/`brain-integration` + `ci-smoke-glob-runner.yml`；长期测试与 sshd fixture 落 `packages/brain/src/__tests__/`，不可依赖 sprint tests | 不运行 xian host smoke，不伪造 xian root/`mmv`，不宣称 Bash 3.2 |
| macOS Bash | client/agent/installer 在 `/bin/bash` 3.2 与 Homebrew 现代 Bash 的语法和零参数失败语义 | `[CI_GAP]` 在仓库现有 `.github/workflows/ci.yml` 增加必跑 `codex-slot-bash-compat`（`macos-13`）job，执行 BEH-11；`ci-passed.needs` 必须包含该 job，且 result 为 failure/cancelled/skipped 时均阻断 | 不验证 xian `mmv`/tmux，也不替代 Ubuntu 真 PG |
| xian-m1 + xian-m4 真机 | 固定 host key/root identity、真实 `mmv` trust root、stdin/auth/tmux/worktree/cleanup | `[CI_GAP]` 既有 `nightly-real-machine.yml` 增加 Tailscale 双机 job，运行 `packages/brain/scripts/real-machine/codex-slot-host-smoke.sh` 并上传逐 host evidence；也支持 release 前 `workflow_dispatch` | 不进入 Ubuntu `packages/brain/scripts/smoke/*.sh` glob/allowlist；凭据不可达即 hard fail，不能 skip 当绿 |

批准后四份 `sprints/.../tests/*.test.ts` 只读；Generator 必须把等价长期回归分别落入 task-plan 指定的 `packages/brain/src/__tests__/` owner 文件，避免 PR CI 永久漏跑。

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
- broker 对任意额外 key 固定返回 `invalid_request_fields`；client 不接受 `actor/actor_id/agent_id/host/slot/account_key/token/auth_json` 参数或环境字段。repo 必须是绝对路径，DB 列为 `TEXT`，worktree 派生值存 `TEXT`，不截成 `varchar(n)`。
- 独立 transport audit 必须从 forced-command 实际收包记录每个 operation 的 stdin key 集合；禁止只调用 `assertClientRequest/assertClientResponse` helper 自证。

### broker → xian agent

- transport：固定 `/etc/cecelia/codex-slot/agent_ssh_config`、固定 host key、broker 专用 key；命令仅为 `codex-slot-agent <prepare|accept-auth|launch|status|stop|cleanup>`。
- agent 身份与 `max_slots` 只读 root-owned 配置；broker 不能通过 argv 传入 agent 身份。
- `accept-auth` stdin 是唯一帧：第一段为不超过 1024 bytes、以单个 LF 结束的 UTF-8 JSON metadata；随后恰好读取 `snapshot_bytes` 个 raw bytes，下一次 1-byte read 必须返回 EOF。短读、CR/NUL、重复/额外 key、SHA 不符或 EOF 前任何尾随字节均稳定拒绝 `snapshot_frame_invalid`，且不得写 auth/启动 tmux。
- metadata keys 精确为 `["nonce","operation","session_handle","slot","snapshot_bytes","snapshot_sha256"]`：`operation` 只能是 `"accept-auth"`；`session_handle` 为 1..128-byte string；`slot` 为 `1..root max_slots` integer；`nonce` 为恰 32 个 lowercase hex（128 bit）；`snapshot_bytes` 为 `1..262144` integer；`snapshot_sha256` 为恰 64 个 lowercase hex。snapshot 原始字节只走 stdin，绝不进 argv/env/stdout/audit。
- agent forced-command 进程以 `env -i` 启动，实际 env keys 必须精确等于 `["LANG","LC_ALL","PATH"]`，值固定为 `LANG=C`、`LC_ALL=C`、`PATH=/usr/bin:/bin`；metadata、nonce、hash、handle 与 snapshot 不得复制到 env。
- 独立验收 principal 使用 `/etc/cecelia/codex-slot/audit_ssh_config` 与 forced `codex-slot-audit`，只允许按 handle 读取 `stat/tmux/process/mmv/cleanup` 非秘密事实，不能读取 auth 内容。
- `codex-slot-audit transport-capture <handle>` 必须从 agent ingress 的 root-owned capture 读取实际 argv/env keys/framing counters/SHA，返回 `source="agent_ingress_capture"`；broker 自己的 `audit-transport` 输出不算 oracle。capture 必须证明 metadata line 长度、raw byte 数、metadata SHA=raw SHA、EOF=true、trailing_bytes=0，且 `argv/env/stdout/audit` 的 fixture fingerprint 命中数全部为 0。

## Auth snapshot 安全合同

- 受控来源：`/var/lib/cecelia/codex-slot/accounts/<account_key>/auth.json`；父目录 `0710 root:codex-slot-broker`，文件 `0600 codex-slot-broker:codex-slot-broker`。测试的 expected UID/GID 必须来自 root 配置，不得从被测文件 `stat` 结果反推。broker service account 只能读取已租账号文件，员工/agent 无源 store 权限。
- 最大长度：`MAX_AUTH_SNAPSHOT_BYTES=262144`；读取前先 `lstat` 拒绝 symlink/非 regular/非 0600/owner/group 不符，再以限长 read 拒绝竞态放大的 oversize。超限稳定拒绝 `snapshot_too_large`。
- 内存生命周期：每次读取复制到独立 Buffer；完成、失败、timeout 均在 `finally` 以 `buffer.fill(0)` 清零，不缓存、不入 DB。
- 完整性与重放：SHA-256 在 broker 计算、agent 写盘前复算；不一致拒绝 `snapshot_hash_mismatch`。oversize/hash/frame 失败后立即由独立 stat/tmux oracle 证明零 auth/零 tmux，不能被后续成功写入掩盖。目标 auth owner=`codex-slot-agent`、mode=`0600`。nonce 为 128 bit lowercase hex、与 session 绑定、durable 单次消费；合同测试必须由两个不同 PID 的真实 Node OS 进程共享 nonce store，第二进程模拟 agent restart 并稳定拒绝 `nonce_replayed`，禁止用 `vi.resetModules()` 代替。
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
| snapshot 帧超限、短读/尾随、hash 被换或 nonce 重放 | 内存/写盘滥用、metadata 与 raw 错配、重复授权 | 1024-byte metadata + 262144-byte snapshot 双上限；精确 EOF；跨 PID nonce；失败前无 auth/tmux。 |
| smoke 自报成功但远端事实错误 | 假绿 | evaluator 直接用独立 audit SSH 查 owner/mode/tmux/process/mmv/cleanup，不采信 smoke 布尔值。 |
| 并发/历史 audit 冒充本轮 | 假绿或串会话 | 所有查询同时绑定 `run_id + session_handle + agent_id`，时间仅作附加约束。 |
| 旧入口或 rollout 非原子 | 第二 issuer/部分开放 | inventory evidence 必须含跨 run registry 扫描内容；legacy evidence 必须含两次真实 argv/exit/residue；真 PG 读回原子状态。 |
| E2E 中途失败 | broker source fixture、nonce、远端 auth/tmux/process/worktree 或 lease 遗留 | provision 前注册幂等 EXIT trap；成功/失败都执行双机 audit cleanup、broker deprovision 与独立 stat/PG/audit 零残留复核，仅保留无秘密 evidence。 |
| Mac 回归未进 required gate | Bash 3.2 失败仍可 merge | Mac job 直接定义在 `ci.yml`，由 `ci-passed.needs` 依赖；failure/cancelled/skipped 全部阻断，并回读同一 SHA 的真实 job/step conclusion。 |
| 真机不可达 | 无法证明接缝 | 保持 `logic-done-pending`，不得将本地绿标 done。 |

## 禁 mock 边清单

- client ↔ broker forced-command（真实 SSH key/UID、stdin shape、跨 actor handle）。
- broker ↔ 真 PostgreSQL 五张 Codex Slot 表（租约、session、audit、rollout、observation）。
- broker ↔ agent SSH/stdin 与 agent ↔ root 配置/filesystem/tmux/process/`mmv`。
- reaper classifier ↔ 独立 agent/tmux/process/identity facts ↔ client status readback；rollout ↔ evidence 真值行/blocking lease/旧入口。
- GitHub workflow ↔ Ubuntu/Mac/xian 实际宿主（CI 配置是本单持续回归边，合同要求对应 job 真运行）。

## 未覆盖真实链路清单

- 真实公司 token/真实 Codex 登录效果由 PRD 排除；只用非秘密 fixture 证明投递、权限、进程与清理，不宣称登录有效。
- GAN 阶段尚未执行 xian-m1/xian-m4 接缝，状态为 `logic-done-pending`；final evaluator 双机留证后才可 done。
- 本合同无 `force_*`/stub/mock 边豁免；非秘密 fixture 是 PRD 指定输入，不替代真 SSH、tmux、filesystem 或 PG。

## 接缝清单

1. 员工 client→broker forced-command：actor A 成功，actor B 对 A handle 的 status/stop/release 均稳定拒绝；raw stdin 额外身份 key 固定拒绝。
2. broker→xian agent→`mmv`：两台分别经固定 host key/stdin，独立 audit principal 将实时信号逐项对比 root-owned trust root，并观察 snapshot 仅 stdin。
3. agent/tmux/filesystem↔PG：同一 handle 的进程、0600 文件、audit 与清理相互对账；未真验即 `logic-done-pending`。

## Golden Path

[受控身份] → [自动 slot] → [durable acquire] → [prepare] → [有限 snapshot stdin] → [`mmv` 双检 launch] → [handle readback] → [reaper] → [rollout/双旧入口硬切] → [双机 release 零残留] → [独立安全复核]

### Step 1：服务器映射可信 actor

**来源**：`[FROM_PRD]` — Golden Path 1。

**可观测行为**：key/UID 固定映射 actor；client 自报/额外请求字段无效；跨 actor handle 的 status/stop/release 全拒绝。

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

**可观测行为**：snapshot 只从 0710 root/service-group store 的 0600 固定 owner regular file 读；accept-auth 采用“≤1024-byte JSON+LF、恰 `snapshot_bytes` raw bytes、立即 EOF”帧；agent env 精确三 key；最大 262144 bytes；nonce 跨两个真实 OS 进程重启只消费一次；hash 匹配、Buffer 清零。

**验证命令**：

```bash
npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-protocol-auth.contract.test.ts -t 'accept-auth framing|受控 credential store|snapshot Buffer|snapshot oversize/hash mismatch|nonce durable 消费跨两个真实 OS 进程' --reporter=verbose
```

**硬阈值**：metadata keys/types/length、raw byte count/SHA/EOF 精确；尾随或短读拒绝；symlink/non-regular/read-side oversize 拒绝；目标 0600；两个 PID 不同且 replay 文件不存在；每个失败当场零 auth/tmux。

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

**可观测行为**：未知投递 quarantine；重启后同 handle 可读；actor B 不可 status/stop/release。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t '未知投递结果|重建实例|actor B' --reporter=verbose
```

**硬阈值**：lease=`quarantined`；handle 不变；跨 actor 两操作均拒绝。

### Step 8：reaper 五分支两轮幂等

**来源**：`[FROM_PRD]` — Golden Path 8。

**可观测行为**：production reaper 通过真实 SSH forced `codex-slot-audit` 主动采样，每轮先新写 `source=production_ssh_audit` 且 `observed_at >= trigger_time` 的 raw reachability/identity/tmux/process/agent-state observation；合同测试另用 `/usr/bin/ssh` 直连同一 audit principal 对账 raw facts，再验证 alive/stopped/unreachable/mismatch/unknown 分类、client readback 与终态第二轮 no-op。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t 'reaper 经 production SSH/audit probe 新写 raw observation' --reporter=verbose
```

**硬阈值**：五分支各有本轮新 observation，source/raw facts 与真实 probe 回执一致；alive 两轮 heartbeat；其余首轮 release/quarantine、次轮 no-op；client readback 与 lease 终态一致；JOBS=60000 ms。

### Step 9：rollout 原子硬切并禁用双旧入口

**来源**：`[FROM_PRD]` — Golden Path 9。

**可观测行为**：成功链 frozen→inventory_complete→broker_only。inventory evidence 必须由 `source=registry_scan` 扫描 leases/sessions/observations 的跨 run 内容并记录 counts、observed run ids 与 blocker handles；历史 alive/unknown/blocking 任一存在只能 failed。legacy evidence 必须由 `source=isolated_process_exec` 逐条记录两个真实历史 argv、非零 exit、`broker_only` error 与 auth/tmux residue=0；只有同 run、5 分钟内、passed、内容完整的两类 evidence 可推进。

**验证命令**：

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t 'rollout|旧入口' --reporter=verbose
```

**硬阈值**：成功 evidence 含真实 source/details；跨 run alive/unknown/blocking 的 inventory result=failed 且 blocker handle 逐项可回读；缺失/垃圾/跨 run/过期/failed evidence 均保持 frozen；两个入口 argv 精确、非零且 `error_code=broker_only`、residue 均为 0。

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

**可观测行为**：精确 request/response/transport schema、真实 task payload、Ubuntu 长期回归、`ci.yml:codex-slot-bash-compat → ci-passed` required Mac Bash 双版本、xian nightly 真机与合同测试只读均通过。

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
E2E_FAIL_AFTER="${CODEX_SLOT_E2E_FAIL_AFTER:-}"
HANDLE_XIAN_M1=""
HANDLE_XIAN_M4=""
FIXTURE_SHA=""
SOURCE_FIXTURE_PATH=""
NONCE_STORE_PATH=""
SANDBOX_PATH=""
LEGACY_HOME=""
E2E_OPERATIONS_COMPLETE=0
mkdir -p "$EVIDENCE_DIR"
exec > >(tee "$EVIDENCE_DIR/e2e.stdout") 2> >(tee "$EVIDENCE_DIR/e2e.stderr" >&2)
export DB_URL

command -v jq >/dev/null
command -v psql >/dev/null
command -v ssh >/dev/null
for FILE in "$ACTOR_A_CONFIG" "$ACTOR_B_CONFIG" "$AUDIT_CONFIG"; do
  [ -r "$FILE" ] || { echo "FAIL: 缺受控 SSH 配置 $FILE"; exit 1; }
done

cleanup_e2e() {
  ORIGINAL_RC=$?
  trap - EXIT INT TERM
  set +e
  CLEANUP_FAILED=0

  for HOST in xian-m1 xian-m4; do
    if [ "$HOST" = "xian-m1" ]; then
      CLEAN_HANDLE="$HANDLE_XIAN_M1"
    else
      CLEAN_HANDLE="$HANDLE_XIAN_M4"
    fi
    if [ -n "$CLEAN_HANDLE" ]; then
      CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh stop \
        --request-id "${RUN_ID}-${HOST}-trap-stop" --session-handle "$CLEAN_HANDLE" >/dev/null 2>&1
      CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh release \
        --request-id "${RUN_ID}-${HOST}-trap-release" --session-handle "$CLEAN_HANDLE" >/dev/null 2>&1
    fi
    REMOTE_CLEAN=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" \
      codex-slot-audit cleanup-run "$RUN_ID" 2>&1)
    REMOTE_CLEAN_RC=$?
    printf '%s\n' "$REMOTE_CLEAN" > "$EVIDENCE_DIR/${HOST}-trap-cleanup.json"
    if [ "$REMOTE_CLEAN_RC" -ne 0 ] || ! printf '%s\n' "$REMOTE_CLEAN" | jq -e --arg run "$RUN_ID" '
      .source == "audit_principal" and .run_id == $run and .cleanup_idempotent == true' >/dev/null; then
      CLEANUP_FAILED=1
    fi
    REMOTE_RESIDUE=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" \
      codex-slot-audit scan-run "$RUN_ID" "$FIXTURE_SHA" 2>&1)
    REMOTE_RESIDUE_RC=$?
    printf '%s\n' "$REMOTE_RESIDUE" > "$EVIDENCE_DIR/${HOST}-trap-residue.json"
    if [ "$REMOTE_RESIDUE_RC" -ne 0 ] || ! printf '%s\n' "$REMOTE_RESIDUE" | jq -e --arg run "$RUN_ID" '
      .source == "audit_principal" and .run_id == $run and
      .auth_files == 0 and .tmux_sessions == 0 and .processes == 0 and
      .worktrees == 0 and .nonce_entries == 0 and .sandbox_residue_count == 0 and
      .fixture_fingerprint_hits == 0' >/dev/null; then
      CLEANUP_FAILED=1
    fi
  done

  DEPROVISION=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh \
    deprovision-e2e --run-id "$RUN_ID" 2>&1)
  DEPROVISION_RC=$?
  printf '%s\n' "$DEPROVISION" > "$EVIDENCE_DIR/deprovision.json"
  if [ "$DEPROVISION_RC" -ne 0 ] || ! printf '%s\n' "$DEPROVISION" | jq -e --arg run "$RUN_ID" '
    .ok == true and .run_id == $run and .idempotent == true' >/dev/null; then
    CLEANUP_FAILED=1
  fi
  for FIXTURE_PATH in "$SOURCE_FIXTURE_PATH" "$NONCE_STORE_PATH" "$SANDBOX_PATH"; do
    if [ -n "$FIXTURE_PATH" ] && [ -e "$FIXTURE_PATH" ]; then
      echo "FAIL: broker fixture residue $FIXTURE_PATH"
      CLEANUP_FAILED=1
    fi
  done

  DB_RESIDUE=$(psql "$DB_URL" -Atc "SELECT json_build_object(
    'accounts',(SELECT count(*) FROM codex_company_accounts WHERE run_id='${RUN_ID}'),
    'leases',(SELECT count(*) FROM codex_account_leases WHERE run_id='${RUN_ID}'),
    'sessions',(SELECT count(*) FROM codex_slot_sessions WHERE run_id='${RUN_ID}'),
    'nonterminal_leases',(SELECT count(*) FROM codex_account_leases WHERE run_id='${RUN_ID}' AND state IN ('active','blocking','quarantined')),
    'audit_evidence',(SELECT count(*) FROM codex_slot_audit WHERE run_id='${RUN_ID}')
  )" 2>&1)
  DB_RESIDUE_RC=$?
  printf '%s\n' "$DB_RESIDUE" > "$EVIDENCE_DIR/db-residue.json"
  REQUIRE_AUDIT=0
  if [ -n "$HANDLE_XIAN_M1" ] || [ -n "$HANDLE_XIAN_M4" ]; then
    REQUIRE_AUDIT=1
  fi
  if [ "$DB_RESIDUE_RC" -ne 0 ] || ! printf '%s\n' "$DB_RESIDUE" | jq -e --argjson require_audit "$REQUIRE_AUDIT" '
    .accounts == 0 and .leases == 0 and .sessions == 0 and .nonterminal_leases == 0 and
    ($require_audit == 0 or .audit_evidence >= 1)' >/dev/null; then
    CLEANUP_FAILED=1
  fi

  if [ -n "$LEGACY_HOME" ]; then
    rm -rf -- "$LEGACY_HOME"
  fi
  if rg -n '(access_token|refresh_token|auth_json|"tokens"|prompt|environment)' "$EVIDENCE_DIR"; then
    echo "FAIL: 本轮 evidence 含禁止键"
    CLEANUP_FAILED=1
  fi

  FINAL_RC=$ORIGINAL_RC
  if [ "$CLEANUP_FAILED" -ne 0 ] && [ "$FINAL_RC" -eq 0 ]; then
    FINAL_RC=1
  fi
  if [ "$FINAL_RC" -eq 0 ] && [ "$E2E_OPERATIONS_COMPLETE" -eq 1 ]; then
    echo "Codex Slot Golden Path E2E PASS run_id=${RUN_ID} evidence=${EVIDENCE_DIR}"
  fi
  exit "$FINAL_RC"
}
trap cleanup_e2e EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

assert_session_response() {
  OP="$1"
  BODY="$2"
  REQUEST="$3"
  HANDLE_EXPECTED="$4"
  HOST_EXPECTED="$5"
  STATE_EXPECTED="$6"
  LEASE_EXPECTED="$7"
  echo "$BODY" | jq -e --arg op "$OP" --arg req "$REQUEST" --arg handle "$HANDLE_EXPECTED" --arg host "$HOST_EXPECTED" --arg state "$STATE_EXPECTED" --arg lease "$LEASE_EXPECTED" '
    keys == ["agent_id","lease_state","ok","operation","request_id","sanitized_reason","session_handle","slot","state"] and
    .ok == true and .operation == $op and .request_id == $req and .session_handle == $handle and
    .agent_id == $host and (.slot | type == "number") and .slot > 0 and
    .state == $state and .lease_state == $lease and
    (. as $o | ["actor","actor_id","account_key","token","access_token","refresh_token","auth","auth_json","environment","claimed_host","debug"] | all(. as $k | $o | has($k) | not))'
}

TASK_JSON=$(curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}")
echo "$TASK_JSON" | jq -e '.payload.target_environment == "local_api"'

npx vitest run "$SPRINT_DIR/tests" --reporter=verbose

PROVISION=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh provision-e2e --run-id "$RUN_ID")
echo "$PROVISION" | tee "$EVIDENCE_DIR/provision.json" | jq -e --arg run "$RUN_ID" '
  keys == ["fixture_sha256","nonce_store_path","ok","rollout_state","run_id","sandbox_path","source_fixture_path"] and
  .ok == true and .run_id == $run and .rollout_state == "broker_only" and
  (.fixture_sha256 | test("^[0-9a-f]{64}$")) and
  (.source_fixture_path | type == "string" and startswith("/")) and
  (.nonce_store_path | type == "string" and startswith("/")) and
  (.sandbox_path | type == "string" and startswith("/"))'
FIXTURE_SHA=$(echo "$PROVISION" | jq -r '.fixture_sha256')
SOURCE_FIXTURE_PATH=$(echo "$PROVISION" | jq -r '.source_fixture_path')
NONCE_STORE_PATH=$(echo "$PROVISION" | jq -r '.nonce_store_path')
SANDBOX_PATH=$(echo "$PROVISION" | jq -r '.sandbox_path')
SOURCE_STORE=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh source-store-stat --run-id "$RUN_ID")
echo "$SOURCE_STORE" | tee "$EVIDENCE_DIR/source-store.json" | jq -e '
  .parent_owner == "root" and .parent_group == "codex-slot-broker" and .parent_mode == "0710" and
  .file_owner == "codex-slot-broker" and .file_group == "codex-slot-broker" and .file_mode == "0600" and
  .regular_file == true and .symlink == false and .service_readable == true and .actor_readable == false and .agent_readable == false'
FAIL_CLEANUP=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh snapshot-failures --run-id "$RUN_ID")
echo "$FAIL_CLEANUP" | tee "$EVIDENCE_DIR/snapshot-failures.json" | jq -e '
  [.cases[] | select((.error_code == "snapshot_too_large" or .error_code == "snapshot_hash_mismatch") and .auth_exists == false and .tmux_alive == false)] | length == 2 and
  .restart_nonce_replay.error_code == "nonce_replayed" and
  (.restart_nonce_replay.first_pid | type == "number") and
  (.restart_nonce_replay.replay_pid | type == "number") and
  .restart_nonce_replay.first_pid != .restart_nonce_replay.replay_pid and
  .restart_nonce_replay.replay_auth_exists == false and .fixture_fingerprint_hits == 0'

ROLLOUT_ROW=$(psql "$DB_URL" -Atc "SELECT json_build_object(
  'state',r.state,
  'inventory_run',i.run_id,'inventory_kind',i.evidence_kind,'inventory_result',i.result,
  'inventory_source',i.source,'inventory_details',i.details,'inventory_created_at',extract(epoch FROM i.created_at),
  'legacy_run',l.run_id,'legacy_kind',l.evidence_kind,'legacy_result',l.result,
  'legacy_source',l.source,'legacy_details',l.details,'legacy_created_at',extract(epoch FROM l.created_at)
) FROM codex_slot_rollout r JOIN codex_slot_audit i ON i.evidence_id=r.inventory_evidence_id JOIN codex_slot_audit l ON l.evidence_id=r.legacy_probe_evidence_id WHERE r.run_id='${RUN_ID}'")
echo "$ROLLOUT_ROW" | tee "$EVIDENCE_DIR/rollout-evidence.json" | jq -e --arg run "$RUN_ID" '
  .state == "broker_only" and .inventory_run == $run and .legacy_run == $run and
  .inventory_kind == "inventory" and .legacy_kind == "legacy_probe" and
  .inventory_result == "passed" and .legacy_result == "passed" and
  .inventory_source == "registry_scan" and .legacy_source == "isolated_process_exec" and
  .inventory_details.scan_scope == "all_runs" and
  .inventory_details.scanned_tables == ["codex_account_leases","codex_slot_sessions","codex_slot_agent_observations"] and
  .inventory_details.blockers == [] and
  (.legacy_details.probes | length == 2) and
  .legacy_details.probes[0].argv == ["scripts/codex-request.sh","--team","team1"] and
  .legacy_details.probes[0].exit_code != 0 and .legacy_details.probes[0].error_code == "broker_only" and
  .legacy_details.probes[0].auth_residue_count == 0 and .legacy_details.probes[0].tmux_residue_count == 0 and
  .legacy_details.probes[1].argv[0:3] == ["scripts/codex-remote-launch.sh","--team","team3"] and
  .legacy_details.probes[1].argv[3] == "--brief" and .legacy_details.probes[1].exit_code != 0 and
  .legacy_details.probes[1].error_code == "broker_only" and
  .legacy_details.probes[1].auth_residue_count == 0 and .legacy_details.probes[1].tmux_residue_count == 0 and
  .inventory_created_at >= (now - 300) and .legacy_created_at >= (now - 300)'

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
  if [ "$HOST" = "xian-m1" ]; then
    HANDLE_XIAN_M1="$HANDLE"
  else
    HANDLE_XIAN_M4="$HANDLE"
  fi
  if [ "$E2E_FAIL_AFTER" = "${HOST}-acquire" ]; then
    echo "INTENTIONAL FAIL: 验证 provision/acquire 后 EXIT trap，host=${HOST}"
    exit 97
  fi

  set +e
  RAW_EXTRA=$(printf '%s\n' "{\"operation\":\"status\",\"request_id\":\"${REQUEST_ID}-raw-extra\",\"session_handle\":\"${HANDLE}\",\"actor_id\":\"forged\"}" | ssh -F "$ACTOR_A_CONFIG" codex-slot@broker codex-slot-broker 2>&1)
  RAW_EXTRA_RC=$?
  set -e
  [ "$RAW_EXTRA_RC" -ne 0 ]
  echo "$RAW_EXTRA" | tee "$EVIDENCE_DIR/${HOST}-raw-extra.json" | jq -e --arg req "${REQUEST_ID}-raw-extra" '
    keys == ["error_code","ok","operation","request_id","sanitized_reason"] and
    .ok == false and .operation == "status" and .request_id == $req and
    .error_code == "invalid_request_fields" and (.sanitized_reason | type == "string")'

  set +e
  FORBIDDEN_STATUS=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_B_CONFIG" scripts/codex-slot-client.sh status --request-id "${REQUEST_ID}-b-status" --session-handle "$HANDLE" 2>&1)
  STATUS_RC=$?
  FORBIDDEN_STOP=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_B_CONFIG" scripts/codex-slot-client.sh stop --request-id "${REQUEST_ID}-b-stop" --session-handle "$HANDLE" 2>&1)
  STOP_RC=$?
  FORBIDDEN_RELEASE=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_B_CONFIG" scripts/codex-slot-client.sh release --request-id "${REQUEST_ID}-b-release" --session-handle "$HANDLE" 2>&1)
  RELEASE_RC=$?
  set -e
  [ "$STATUS_RC" -ne 0 ] && [ "$STOP_RC" -ne 0 ] && [ "$RELEASE_RC" -ne 0 ]
  printf '%s\n' "$FORBIDDEN_STATUS" > "$EVIDENCE_DIR/${HOST}-actor-b-status.json"
  printf '%s\n' "$FORBIDDEN_STOP" > "$EVIDENCE_DIR/${HOST}-actor-b-stop.json"
  printf '%s\n' "$FORBIDDEN_RELEASE" > "$EVIDENCE_DIR/${HOST}-actor-b-release.json"
  echo "$FORBIDDEN_STATUS" | jq -e --arg req "${REQUEST_ID}-b-status" 'keys == ["error_code","ok","operation","request_id","sanitized_reason"] and .ok == false and .operation == "status" and .request_id == $req and .error_code == "handle_forbidden" and (.sanitized_reason | type == "string")'
  echo "$FORBIDDEN_STOP" | jq -e --arg req "${REQUEST_ID}-b-stop" 'keys == ["error_code","ok","operation","request_id","sanitized_reason"] and .ok == false and .operation == "stop" and .request_id == $req and .error_code == "handle_forbidden" and (.sanitized_reason | type == "string")'
  echo "$FORBIDDEN_RELEASE" | jq -e --arg req "${REQUEST_ID}-b-release" 'keys == ["error_code","ok","operation","request_id","sanitized_reason"] and .ok == false and .operation == "release" and .request_id == $req and .error_code == "handle_forbidden" and (.sanitized_reason | type == "string")'

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
  echo "$STATUS" | tee "$EVIDENCE_DIR/${HOST}-status.json" >/dev/null
  assert_session_response status "$STATUS" "${REQUEST_ID}-status-${ATTEMPT}" "$HANDLE" "$HOST" running active

  TRUST=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" codex-slot-audit trust-root)
  echo "$TRUST" | tee "$EVIDENCE_DIR/${HOST}-trust-root.json" | jq -e '
    keys == ["allowed_ip","backend","config_group","config_mode","config_owner","peer","stable_node_id"] and
    .config_owner == "root" and .config_mode == "0600" and
    (.stable_node_id | type == "string" and length > 0) and (.peer | type == "string" and length > 0) and
    (.allowed_ip | type == "string" and length > 0) and (.backend | type == "string" and length > 0)'
  LIVE=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" codex-slot-audit status "$HANDLE")
  echo "$LIVE" | tee "$EVIDENCE_DIR/${HOST}-live-audit.json" | jq -e --arg handle "$HANDLE" --arg host "$HOST" '
    keys == ["agent_id","auth_exists","auth_mode","auth_owner","backend","mmv_ip","mmv_online","peer","process_alive","sampled_at_epoch","session_handle","stable_node_id","tmux_alive","worktree_exists"] and
    .agent_id == $host and .session_handle == $handle and .auth_exists == true and
    .auth_mode == "0600" and .auth_owner == "codex-slot-agent" and
    .tmux_alive == true and .process_alive == true and .worktree_exists == true and
    .mmv_online == true and (.stable_node_id | type == "string" and length > 0) and
    (.peer | type == "string" and length > 0) and (.mmv_ip | type == "string" and length > 0) and
    (.backend | type == "string" and length > 0) and .sampled_at_epoch >= (now - 60)'
  jq -n --argjson trust "$TRUST" --argjson live "$LIVE" '
    $live.stable_node_id == $trust.stable_node_id and $live.peer == $trust.peer and
    $live.mmv_ip == $trust.allowed_ip and $live.backend == $trust.backend' | jq -e '. == true'

  REAPER_ALIVE_TRIGGER=$(date +%s)
  REAPER_ALIVE=$(node packages/brain/src/codex-slot/cli.js reaper-once --run-id "$RUN_ID" --session-handle "$HANDLE" --audit-ssh-config "$AUDIT_CONFIG")
  echo "$REAPER_ALIVE" | tee "$EVIDENCE_DIR/${HOST}-reaper-alive.json" | jq -e --arg handle "$HANDLE" '
    .session_handle == $handle and .classification == "alive" and .action == "heartbeat" and
    .observation_source == "production_ssh_audit"'
  ALIVE_OBSERVATION=$(psql "$DB_URL" -Atc "SELECT json_build_object(
    'source',source,'session_handle',session_handle,'expected_agent_id',expected_agent_id,
    'reported_agent_id',reported_agent_id,'reachable',reachable,'response_complete',response_complete,
    'tmux_alive',tmux_alive,'process_alive',process_alive,'agent_state',agent_state,
    'observed_at_epoch',extract(epoch FROM observed_at)
  ) FROM codex_slot_agent_observations WHERE run_id='${RUN_ID}' AND session_handle='${HANDLE}' AND observed_at >= to_timestamp(${REAPER_ALIVE_TRIGGER}) ORDER BY observed_at DESC LIMIT 1")
  echo "$ALIVE_OBSERVATION" | tee "$EVIDENCE_DIR/${HOST}-reaper-alive-observation.json" | jq -e --arg handle "$HANDLE" --arg host "$HOST" --argjson trigger "$REAPER_ALIVE_TRIGGER" '
    keys == ["agent_state","expected_agent_id","observed_at_epoch","process_alive","reachable","reported_agent_id","response_complete","session_handle","source","tmux_alive"] and
    .source == "production_ssh_audit" and .session_handle == $handle and
    .expected_agent_id == $host and .reported_agent_id == $host and
    .reachable == true and .response_complete == true and
    .tmux_alive == true and .process_alive == true and .agent_state == "running" and
    .observed_at_epoch >= $trigger'
  jq -n --argjson audit "$LIVE" --argjson observation "$ALIVE_OBSERVATION" '
    $observation.reported_agent_id == $audit.agent_id and
    $observation.tmux_alive == $audit.tmux_alive and
    $observation.process_alive == $audit.process_alive' | jq -e '. == true'
  READBACK_ALIVE=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh status --request-id "${REQUEST_ID}-readback-alive" --session-handle "$HANDLE")
  assert_session_response status "$READBACK_ALIVE" "${REQUEST_ID}-readback-alive" "$HANDLE" "$HOST" running active
  STOP=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh stop --request-id "${REQUEST_ID}-stop" --session-handle "$HANDLE")
  echo "$STOP" | tee "$EVIDENCE_DIR/${HOST}-stop.json" >/dev/null
  assert_session_response stop "$STOP" "${REQUEST_ID}-stop" "$HANDLE" "$HOST" stopped active
  STOPPED_AUDIT=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" codex-slot-audit status "$HANDLE")
  REAPER_STOPPED_TRIGGER=$(date +%s)
  REAPER_STOPPED=$(node packages/brain/src/codex-slot/cli.js reaper-once --run-id "$RUN_ID" --session-handle "$HANDLE" --audit-ssh-config "$AUDIT_CONFIG")
  echo "$REAPER_STOPPED" | tee "$EVIDENCE_DIR/${HOST}-reaper-stopped.json" | jq -e --arg handle "$HANDLE" '
    .session_handle == $handle and .classification == "stopped" and .action == "released" and
    .observation_source == "production_ssh_audit"'
  STOPPED_OBSERVATION=$(psql "$DB_URL" -Atc "SELECT json_build_object(
    'source',source,'session_handle',session_handle,'expected_agent_id',expected_agent_id,
    'reported_agent_id',reported_agent_id,'reachable',reachable,'response_complete',response_complete,
    'tmux_alive',tmux_alive,'process_alive',process_alive,'agent_state',agent_state,
    'observed_at_epoch',extract(epoch FROM observed_at)
  ) FROM codex_slot_agent_observations WHERE run_id='${RUN_ID}' AND session_handle='${HANDLE}' AND observed_at >= to_timestamp(${REAPER_STOPPED_TRIGGER}) ORDER BY observed_at DESC LIMIT 1")
  echo "$STOPPED_OBSERVATION" | tee "$EVIDENCE_DIR/${HOST}-reaper-stopped-observation.json" | jq -e --arg handle "$HANDLE" --arg host "$HOST" --argjson trigger "$REAPER_STOPPED_TRIGGER" '
    .source == "production_ssh_audit" and .session_handle == $handle and
    .expected_agent_id == $host and .reported_agent_id == $host and
    .reachable == true and .response_complete == true and
    .tmux_alive == false and .process_alive == false and .agent_state == "stopped" and
    .observed_at_epoch >= $trigger'
  jq -n --argjson audit "$STOPPED_AUDIT" --argjson observation "$STOPPED_OBSERVATION" '
    $observation.reported_agent_id == $audit.agent_id and
    $observation.tmux_alive == $audit.tmux_alive and
    $observation.process_alive == $audit.process_alive' | jq -e '. == true'
  READBACK_RELEASED=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh status --request-id "${REQUEST_ID}-readback-released" --session-handle "$HANDLE")
  assert_session_response status "$READBACK_RELEASED" "${REQUEST_ID}-readback-released" "$HANDLE" "$HOST" released released
  RELEASE=$(CODEX_SLOT_SSH_CONFIG="$ACTOR_A_CONFIG" scripts/codex-slot-client.sh release --request-id "${REQUEST_ID}-release" --session-handle "$HANDLE")
  echo "$RELEASE" | tee "$EVIDENCE_DIR/${HOST}-release.json" >/dev/null
  assert_session_response release "$RELEASE" "${REQUEST_ID}-release" "$HANDLE" "$HOST" released released
  TRANSPORT=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" codex-slot-audit transport-capture "$HANDLE")
  echo "$TRANSPORT" | tee "$EVIDENCE_DIR/${HOST}-transport.json" | jq -e --arg handle "$HANDLE" --argjson slot "$(echo "$ACQUIRE" | jq '.slot')" --arg fixture_sha "$FIXTURE_SHA" '
    keys == ["accept_auth","argv_fixture_hits","audit_fixture_hits","env_fixture_hits","source","stdout_fixture_hits"] and
    .source == "agent_ingress_capture" and
    (.accept_auth | keys) == ["argv","env","env_keys","eof_seen","frame_format","metadata","metadata_line_bytes","raw_snapshot_bytes","raw_snapshot_sha256","stdin_bytes","trailing_bytes"] and
    .accept_auth.argv == ["codex-slot-agent","accept-auth"] and
    .accept_auth.env_keys == ["LANG","LC_ALL","PATH"] and
    .accept_auth.env == {"LANG":"C","LC_ALL":"C","PATH":"/usr/bin:/bin"} and
    .accept_auth.frame_format == "json-line+raw+eof" and
    (.accept_auth.metadata_line_bytes | type == "number") and
    .accept_auth.metadata_line_bytes > 0 and .accept_auth.metadata_line_bytes <= 1024 and
    (.accept_auth.metadata | keys) == ["nonce","operation","session_handle","slot","snapshot_bytes","snapshot_sha256"] and
    .accept_auth.metadata.operation == "accept-auth" and
    .accept_auth.metadata.session_handle == $handle and
    (.accept_auth.metadata.session_handle | utf8bytelength) >= 1 and
    (.accept_auth.metadata.session_handle | utf8bytelength) <= 128 and
    .accept_auth.metadata.slot == $slot and (.accept_auth.metadata.slot | type == "number") and
    (.accept_auth.metadata.nonce | type == "string" and test("^[0-9a-f]{32}$")) and
    (.accept_auth.metadata.snapshot_bytes | type == "number") and
    .accept_auth.metadata.snapshot_bytes >= 1 and .accept_auth.metadata.snapshot_bytes <= 262144 and
    (.accept_auth.metadata.snapshot_sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    .accept_auth.raw_snapshot_bytes == .accept_auth.metadata.snapshot_bytes and
    .accept_auth.raw_snapshot_sha256 == .accept_auth.metadata.snapshot_sha256 and
    .accept_auth.raw_snapshot_sha256 == $fixture_sha and
    .accept_auth.stdin_bytes == (.accept_auth.metadata_line_bytes + 1 + .accept_auth.raw_snapshot_bytes) and
    .accept_auth.eof_seen == true and .accept_auth.trailing_bytes == 0 and
    .argv_fixture_hits == 0 and .env_fixture_hits == 0 and .stdout_fixture_hits == 0 and .audit_fixture_hits == 0'

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

LEGACY_HOME=$(mktemp -d "${TMPDIR:-/tmp}/codex-slot-legacy.XXXXXX")
mkdir -p "$LEGACY_HOME/tmp"
printf '%s\n' "non-secret contract fixture" > "$LEGACY_HOME/task.md"
for LEGACY_CASE in request remote-launch; do
  set +e
  if [ "$LEGACY_CASE" = "request" ]; then
    LEGACY_OUTPUT=$(env -i HOME="$LEGACY_HOME" TMPDIR="$LEGACY_HOME/tmp" PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" LC_ALL=C LANG=C /bin/bash scripts/codex-request.sh --team team1 2>&1)
  else
    LEGACY_OUTPUT=$(env -i HOME="$LEGACY_HOME" TMPDIR="$LEGACY_HOME/tmp" PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" LC_ALL=C LANG=C /bin/bash scripts/codex-remote-launch.sh --team team3 --brief "$LEGACY_HOME/task.md" 2>&1)
  fi
  LEGACY_RC=$?
  set -e
  [ "$LEGACY_RC" -ne 0 ]
  printf '%s\n' "$LEGACY_OUTPUT" | tee "$EVIDENCE_DIR/legacy-${LEGACY_CASE}.log" | grep -qi 'broker-only'
  printf '%s\n' "$LEGACY_OUTPUT" | grep -qi 'codex-slot-client'
done
[ "$(find "$LEGACY_HOME" -name auth.json -o -name '.codex-*' | wc -l | tr -d ' ')" -eq 0 ]
for HOST in xian-m1 xian-m4; do
  LEGACY_REMOTE=$(ssh -F "$AUDIT_CONFIG" "codex-slot-audit@${HOST}" codex-slot-audit legacy-residue team1 team3)
  echo "$LEGACY_REMOTE" | tee "$EVIDENCE_DIR/${HOST}-legacy-residue.json" | jq -e '
    .legacy_auth_files == 0 and .legacy_tmux_sessions == 0 and .legacy_launcher_files == 0'
done
DUP=$(psql "$DB_URL" -Atc "SELECT count(*) FROM (SELECT account_key FROM codex_account_leases WHERE run_id='${RUN_ID}' AND state IN ('active','blocking','quarantined') GROUP BY account_key HAVING count(*) > 1) d")
[ "$DUP" -eq 0 ] || { echo "FAIL: 本轮重复租约 count=${DUP}"; exit 1; }

E2E_OPERATIONS_COMPLETE=1
echo "Golden Path 操作完成，等待 EXIT trap 独立清理复核"
```

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/codex-slot-identity-routing.contract.test.ts` | `受控 SSH key 映射 actor` / `自动选择仅接纳身份` | identity/selector 模块不存在 |
| WS2 | `tests/codex-slot-lifecycle.integration.contract.test.ts` | `单账号并发竞争` / `相同 request_id` / `actor B 对 actor A handle` / `未知投递结果` | migration/registry 模块不存在 |
| WS3 | `tests/codex-slot-protocol-auth.contract.test.ts` | `acquire/status/stop/release/error JSON` / `accept-auth framing` / `受控 credential store` / `snapshot Buffer` / `snapshot oversize/hash mismatch` / `nonce durable 消费跨两个真实 OS 进程` | protocol/credential-store/agent 模块不存在 |
| WS4 | `tests/codex-slot-reaper-rollout.integration.contract.test.ts` | `rollout 只接受本 run` / `inventory 真实扫描跨 run` / `reaper 经 production SSH/audit probe` / `旧入口` / `Bash 3.2` / `scheduler JOBS` | rollout/reaper 未实现，两个旧入口仍执行旧 token 路径 |
