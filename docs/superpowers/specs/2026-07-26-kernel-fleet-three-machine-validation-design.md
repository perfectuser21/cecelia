# Kernel Fleet 三机真实派发验证设计

日期：2026-07-26  
状态：设计已确认，待实施计划  
关联规格：`2026-07-25-provider-neutral-harness-commander-fusion-prd.md`

## 1. 目标

在实现 Commander Phase 1–5 前，证明固定运行在 US M4 的 Brain Control Plane
与 Kernel Run Controller，能够把独立 Harness Attempt 真正派发到以下三台机器：

- `us-mac-m4`
- `xian-mac-m4`
- `xian-mac-m1`

验证必须覆盖串行、并行、strict affinity、非 strict fallback、callback 幂等和实际
执行位置对账。只记录 `machine_id`、只证明远端 Codex CLI 可运行，均不算通过。

本轮可用 Provider 只有 Codex 和 Grok。Claude 因额度不可用，不进入候选池，也不得被
静默 fallback 选中。

## 2. 已核实的现状

### 2.1 资源矩阵

| 机器 | Codex | Grok | 当前执行入口 |
|---|---|---|---|
| US M4 | team1–5 凭据与 CLI 可用 | CLI 与凭据可用 | Kernel 本地 Docker launcher |
| xian M4 | team1–5 凭据与 CLI 可用 | 不支持 | Codex Bridge `:3458` 在线 |
| xian M1 | team5 凭据与 CLI 可用 | 不支持 | 尚无 Bridge |

Claude account1/2 即使仍存在配置，也必须在本次 capability snapshot 中标记为
`quota_unavailable`。

### 2.2 当前缺口

`resolveExecutionTarget()` 已允许三台机器上的 Codex 目标，Capability Gate 也能把
选中的机器写入 `harness_attempts.machine_id`。但是 `createDetachedLauncher()` 只调用
US M4 本机的 `spawnDockerDetached()`：

1. 选中的远端机器没有进入 launcher transport 选择；
2. `requested machine` 可能是 xian M4/M1，容器却仍在 US M4 启动；
3. xian M4 Bridge 虽在线，但尚未被 Kernel Dispatcher 调用；
4. xian M1 有 Codex CLI 和 team5 凭据，但没有统一 Bridge；
5. 当前没有不可伪造的 `actual_machine` 回执。

因此当前系统只具备“人工跨机运行”的能力，不具备已经验真的 Kernel 三机自动派发。

## 3. 方案比较

### 方案 A：直接 SSH/One Session 三机并行

最快，能证明每台机器上的 Codex 可运行。但它绕过 Kernel Dispatcher、Attempt lease、
callback、幂等与恢复，不能证明目标架构。

### 方案 B：先完成全部 Commander Phase，再统一验证

可以减少临时接口，但会把远程执行缺陷扩散到 Commander State、Actor Inbox 和
Provider takeover，定位和回滚成本过高。

### 方案 C：先补最小 Execution Transport，再跑三机 Canary

推荐方案。它复用 Phase 0B 的 `ExecutionTarget` 和 Phase 0C 的 Attempt telemetry，
不实现 Commander 业务逻辑。三机真实派发通过后，再让 Commander Phase 1/2 与
Fleet Phase 3/4 按依赖并行。

## 4. 目标架构

```text
US M4
┌──────────────────────────────────────────────────────────┐
│ Brain Control Plane                                      │
│ Kernel Run Controller                                    │
│  ├─ Capability Gate                                      │
│  ├─ Execution Target Resolver                            │
│  └─ Execution Transport Router                           │
│       ├─ local-docker  ───────────────► US M4 Worker     │
│       └─ remote-bridge ─┬─────────────► xian M4 Worker   │
│                         └─────────────► xian M1 Worker   │
└──────────────────────────────────────────────────────────┘
           ▲                         │
           └──── authenticated callback + attestation ────┘
```

Kernel Run Controller 仍固定在 US M4。远端机器只承载 Commander Attempt 或 Role
Attempt，不承载 Brain，也不持有流程裁决权。

### 4.1 Execution Transport

新增统一 transport 边界：

```text
launch(attempt, bundle, providerSpec, executionTarget)
inspect(attempt, executionTarget)
cancel(attempt, executionTarget)
```

首版实现两个 transport：

- `local-docker`：保留现有 US M4 `spawnDockerDetached()` 行为；
- `remote-bridge`：向 machine registry 中登记且健康的 Bridge 提交 Attempt。

Dispatcher 必须把 Capability Gate 返回的完整 `ExecutionTarget` 交给 transport router。
禁止仅把 machine 写入数据库后继续调用本地 launcher。

### 4.2 远端 Bridge 合同

xian M4 与 xian M1 使用同一 Bridge 合同：

- 输入：`attempt_id`、`run_id`、`hop`、role、provider、account、bundle、callback URL、
  callback token、lease generation；
- 启动前验证本机 canonical machine ID、Provider、账号和能力快照；
- 输出：结构化 job ID、canonical machine ID、provider、account；
- callback 携带由服务端 challenge 绑定的 machine attestation；
- 按 `attempt_id + lease_generation` 幂等；
- inspect/cancel 必须作用于相同 Attempt，不按模糊容器名前缀操作。

Bridge 不决定 fallback。Bridge 拒绝或离线后，由 US M4 Kernel 根据 strict affinity 和
Capability Gate 重新裁决。

### 4.3 Requested/Actual 对账

Attempt 至少记录：

- `requested_machine_id`
- `actual_machine_id`
- `execution_transport`
- `remote_job_id`
- `capability_snapshot_id`
- `machine_attestation_status`

`actual_machine_id` 只能来自认证后的 Bridge 回执或本地 launcher 的服务端事实，不能由
LLM 输出、summary、artifact 自报。

当 requested 与 actual 不一致：

- strict affinity：Attempt 终止为 `infrastructure_blocked`，不得继续执行；
- non-strict fallback：原 Attempt 结构化终结，创建新 Attempt；不得原地改写机器。

## 5. 三机 Canary

Canary 使用同一个 Kernel Run 和三个唯一 Attempt，不修改业务仓库内容。每个 Worker
仅返回结构化证据：

```json
{
  "attempt_id": "uuid",
  "run_id": "uuid",
  "hostname": "canonical-hostname",
  "provider": "codex",
  "account": "teamN",
  "git_sha": "40-char-sha",
  "started_at": "timestamp",
  "finished_at": "timestamp"
}
```

### 5.1 串行验证

按 US M4 → xian M4 → xian M1 顺序执行，验证每个 callback 后才产生下一 Attempt。

### 5.2 并行验证

同一 Run 同时创建三个不同 workstream 的 Attempt，验证：

- 三台机器的执行时间窗口真实重叠；
- 三个 Attempt ID、job ID、lease 独立；
- 每个 Attempt 恰好一个终态 callback；
- 任一机器故障不篡改其他 workstream。

### 5.3 故障注入

1. strict-pin xian M4 后让 Bridge 拒绝：必须阻断，不得落到 US M4；
2. non-strict xian M4 故障：原 Attempt 终结，新 Attempt 才可落到候选机器；
3. 重放同一 callback：只能保留一份终态；
4. 回调伪造错误 machine ID：服务端拒绝；
5. Bridge 启动后 Kernel/Brain 重启：从 DB、Bridge inspect 和 lease 恢复，不重复启动；
6. Claude 被配置为 fallback：因 `quota_unavailable` 必须在派发前被排除。

## 6. Commander Phase 1–5 的执行拓扑

三机 Canary 通过后，建设 Lane 如下：

| Lane | 位置/Provider | 主责 |
|---|---|---|
| A | US M4 / Codex | Phase 1：契约、状态、事件游标、Actor Inbox |
| B | xian M4 / Codex | Phase 3：Attempt Fleet Routing |
| C | xian M1 / Codex | Phase 4 的 Runner Contract 与恢复测试 |
| D | US M4 / Grok | 规格和实现的独立对抗复审，不持有写分支 |

依赖关系：

```text
Phase 0A 修复 ──► Phase 1 ──► Phase 2 ──┐
Phase 0B 已完成 ─► Phase 3 ──► Phase 4 ──┼─► Phase 5
Phase 0C 已完成 ─────────────────────────┘
```

Phase 1 与 Phase 3 可以在不同分支并行。Phase 2 必须等待 Phase 1 的 schema 和持久状态；
Phase 4 的统一收口必须等待 Phase 3 transport；Phase 5 必须等待前四个 Phase 合入并
重新同步 main。

不同 Lane 不共享工作分支，不互相 cherry-pick 未复审提交。公共接口先由独立契约 PR
冻结，再由各 Lane 消费。

## 7. Provider 策略

本轮默认策略：

1. Commander/Role 首选 Codex；
2. US M4 可使用 Grok 做独立复审与 Commander 故障接管实验；
3. xian M4、xian M1 只允许 Codex；
4. Claude 全部标记为 quota unavailable，不探测、不重试、不占用 Attempt；
5. 账号轮换由 Capability Gate 确定性执行，LLM Commander 只能提出建议，不能指定凭据。

Phase 5 至少证明 Codex Commander 的持久状态可由 Grok Commander 在 US M4 恢复。
由于 Claude 无额度，本轮不声称三 Provider canary 完成；Claude 验收保留为后续增量门。

## 8. 安全与回滚

- Brain、Kernel Controller 和数据库仍固定在 US M4；
- callback token、Provider 凭据不写入日志和 CommanderBundle；
- remote Bridge 只接受 US M4 Brain 的认证请求；
- strict affinity 默认 fail closed；
- 远端 transport 可按 feature flag 单机关闭；
- xian M1 Bridge、xian M4 transport、US M4 local transport 可独立回滚；
- Canary 不执行 merge、不写生产业务数据、不修改目标仓库文件。

## 9. 完成定义

以下条件全部满足才可声称“Kernel 已具备三机串行/并行派发”：

1. US M4、xian M4、xian M1 均由 Kernel 创建并启动真实 Attempt；
2. requested/actual machine 三机逐项相等且 attestation verified；
3. 串行与并行 Canary 全绿；
4. strict affinity 不发生静默换机；
5. non-strict fallback 使用新 Attempt；
6. callback 重放、Brain 重启、Bridge 故障不产生重复 Worker；
7. telemetry 能按机器、Provider、账号、logical cycle 查询耗时；
8. Claude 在额度不可用时不被调用；
9. Red→Green 回归测试、真实 PostgreSQL 集成测试和 DevGate 全绿；
10. 独立复审 PASS，保持未 merge，等待人类批准。

完成这项验证不代表 Commander Phase 1–5 已完成。它只证明 Commander 与 Role Attempt
后续可以建立在真实、可对账、可恢复的三机执行底座上。
