# Sprint Contract Draft (Round 2)

## 合同边界

- 本合同只覆盖 Kernel Harness 派发前能力预检、ExecutionTarget 路由、能力快照、故障分类与结构化证据；不新增 telemetry schema、跨 run contract 继承、Commander Phase 2/3 能力。
- 生产数据库写入、自动 merge、直接 push `main`、真实 provider/GitHub 外呼验证不在本合同内；合同只要求注入依赖回归测试与本地 orchestrator 验收。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。

## Response Schema（推导来源: PRD字面）

N/A — 本任务无新增 HTTP 响应。对外可观测契约是 `initiative_runs` / `harness_attempts` / `orchestrator_decision_log` 的结构化落库、dispatcher 返回的结构化分类，以及测试退出码。

Registry 非空但无本任务专属 HTTP schema；字段命名继续沿现有 orchestrator/dispatcher 约定，包含 `role_assignments`、`logical_cycle`、`failure_class`、`machine_id`、`provider_session_id`。

## 已知约束（来自回归测试）

- `[packages/brain/src/orchestrator/__tests__/dispatcher.test.js]` → `先持久化 attempt，再生成 adapter spec，最后 launch`
- `[packages/brain/src/orchestrator/__tests__/dispatcher.test.js]` → `按 role_assignments 为同一 run 的 generator/evaluator 选择不同 provider 与账户 home`
- `[packages/brain/src/orchestrator/__tests__/derive.test.js]` → `failure_class='contract_invalid' → failed 不入 fix loop（routeAfterEvaluate 语义：责任在 GAN）`
- `[packages/brain/src/orchestrator/__tests__/derive.test.js]` → `judge FAIL（本 sha）且 failure_class 字段缺失 → unknown human review`
- `[packages/brain/src/__tests__/dispatcher-preflight-three-strikes.test.js]` → `第 3 次拒绝（metadata 有 count=2）：置 blocked，blocked_reason=pre_flight_rejected`
- `[packages/brain/src/__tests__/dispatcher-preflight-three-strikes.test.js]` → `第 3 次拒绝后只告警一次（告警自然止血）`
- `[packages/brain/src/__tests__/executor-codex-review-preflight.test.js]` → `codex binary 缺失返回 configError: true（不抛 spawn 也不发 FAIL callback）`
- `[packages/brain/src/__tests__/fleet-heartbeat.test.js]` → `getFleetStatus 每条记录都包含 last_ping_at + offline_reason 字段`
- `[累积FR] context-manifest: unavailable`（`GET /api/brain/line/74d3dbc0-7f36-4422-9f7a-138cc66c0174/context-manifest` 不存在，按不可用登记）

## 真实调用方请求 shape

本任务入口不是新 HTTP API，而是 Brain 内部 `dispatch(action, ctx)` 与 `initiative_runs/tasks.payload`。真实输入 shape 必须逐字保持如下，禁止另造 body/header 双路径：

| 调用方 | 入口 | 关键字段 |
|---|---|---|
| Kernel controller / dispatcher | `createDispatcher(...)(action, ctx)` | `ctx.runId`、`ctx.hop`、`ctx.observed.task.payload.role_assignments`、`ctx.observed.task.payload.executor(_account)`、`ctx.decision.phase` |
| task bundle | `observed.task.payload` | `logical_cycle`、`role_assignments.<role>.provider/account`、`sprint_dir`、`worktree_path`、冻结合同要求的 capability requirements |
| attempt 落库 | `attemptStore.createAttempt` | `id`、`runId`、`hop`、`phase`、`role`、`provider`、`accountId`、`machineId`、`bundle` |
| 结构化证据 | `orchestrator_decision_log.detail` / attempt result | `failure_class`、`capability_snapshot_id`、`from_target`、`to_target`、`fallback_reason`、`logical_cycle` |

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | attempt 创建前解析冻结合同要求并执行 server-owned preflight；结构化区分 product failure 与 infrastructure/contract capability mismatch；按矩阵与 logical cycle 规则做账号/机器故障转移。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | provider auth/network preflight 有有界超时；同签名 transient failure 每账号每 logical cycle 最多一次恢复重试；未知 machine / 未验证组合 fail-closed。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不创建白跑 attempt；不使用 `os.hostname()` 充当 canonical machine_id；不把 infrastructure mismatch 送入 generator-fix；不修改 telemetry schema 与跨 run contract 继承。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | capability snapshot 只对单次 attempt / logical cycle 有效；host capacity/auth 状态过期后必须重建 snapshot，不可跨 run 复用。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | infrastructure_blocked / contract capability mismatch 必须写 decision log 并触发既有 human review/告警链；第三次同类 preflight 拒绝仍只告警一次。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | auth/GitHub/PG/model/机器身份任一缺失即 fail-closed，不创建 attempt；transient provider failure 先一次恢复重试，再同 provider 换账号，再按矩阵迁机/跨厂商；重复同签名受收敛闸约束。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 通过注入依赖的 preflight 结果、`harness_attempts`/`orchestrator_decision_log` 行、dispatcher 返回值、Vitest 退出码确认；未拿到结构化 evidence 视为失败。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ provider failure 是否属于 transient | A. 读 Agent 自然语言报错；B. 只认结构化 HTTP 500/502/503/504、`high_demand`、`biscuit_baker_*_circuit_open` | B. 只认结构化签名 | PRD 明示“只用结构化证据，不从 Agent 自然语言猜状态” | 把产品 bug 错分成 infra，或把临时抖动错误送进 generator-fix 循环 |
| ⚠️ role_assignments.account 失败后如何轮换 | A. 永久绑定首选账号；B. 同 provider 健康账号确定性轮换 | B. 同 provider 健康账号确定性轮换 | live evidence 指出首选不是永久硬绑定 | 错过健康账号，白跑 attempt 或误触人工阻塞 |
| ⚠️ canonical machine_id 来源 | A. Docker hostname / `os.hostname()`；B. `CECELIA_MACHINE_ID` 或受控 Fleet 注册 | B. `CECELIA_MACHINE_ID` / Fleet | 主理人拍板要求 fail-closed | 容器 hostname 污染 attempt.machine_id，导致错误跨机调度 |
| ⚠️ Codex 是否可跨机 fresh recovery | A. 沿用旧 session resume；B. 从 Git/PR/DB 真相 fresh attempt 恢复同 logical cycle | B. fresh recovery | PRD 明禁伪造跨机 session resume | 复用失效 session，错误继承旧环境状态 |

上述四个 ⚠️ 判定点均已由 PRD 在 2026-07-25 拍板，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| provider auth / model / GitHub / PostgreSQL probe 缺失 | 返回 `infrastructure_blocked` 或 `contract_capability_mismatch`，不创建 attempt | 是；同 snapshot 签名重复受收敛闸约束 | 转人工复审并告警 |
| transient provider failure 首次命中 | 同账号同 logical cycle 最多恢复重试一次 | 是；按 failure signature 去重 | 仍失败则熔断该账号并轮换同 provider 健康账号 |
| 同 provider 账号池耗尽 | 若 provider=codex，按矩阵迁机 fresh recovery；USM4 可跨厂商降级 | 是；保持 role/phase/logical_cycle 不变 | 五个账号都不可用才 `wait:human_review/infrastructure_blocked` |
| canonical machine_id 缺失/未知 | fail-closed，不参与路由 | N/A | 人工修复 Fleet 注册或注入 env |
| 容量缓存与宿主凭据不一致 | 以真实凭据/结构化 probe 为准，缓存 mismatch 直接 fail-safe | 是；下轮可重建 snapshot | 不信任缓存，不白跑 attempt |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本任务不新增对外 agent/API，输入只来自 Brain 内部任务 bundle 与受控 Fleet/credential probe。

## Golden Path

覆盖父路 Kernel capability gate：派发前能力预检 第 1-5 步

[读取冻结合同与 role_assignments] → [生成 capability snapshot] → [transient retry/账号轮换/跨机策略] → [mismatch/infra 分流阻断白跑 attempt] → [健康 snapshot 挂 attempt 与决策日志]

### Step 1: 解析冻结合同能力要求与候选 ExecutionTarget

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步、范围限定、预期受影响文件。

**可观测行为**: dispatcher 在创建 attempt 前拿到 server-owned capability requirements、候选 `ExecutionTarget={provider,account,machine,capabilities,verified,health,capacity}`，而不是直接用 payload 默认值派发。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "dispatcher 在 createAttempt 前执行 preflight 并写 capability_snapshot_id"
```

**硬阈值**: exit code = 0；`createAttempt` 之前必须调用 preflight；`capability_snapshot_id` 写入 attempt bundle/result；缺 capability 时 `launcher.launch` 次数 = 0。

### Step 2: 生成 server-owned capability snapshot

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步、验收点 1-2。

**可观测行为**: snapshot 至少覆盖 provider auth/account、GitHub、PostgreSQL/测试依赖、合同要求的外部模型能力、canonical machine_id、health/capacity，并保留 logical_cycle / role / phase 关联。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id"
```

**硬阈值**: exit code = 0；snapshot keys 完整匹配 `["provider","account","machine","capabilities","verified","health","capacity","capability_snapshot_id","logical_cycle"]`；任一 required capability 缺失时返回 mismatch 分类而非成功。

### Step 3: transient provider failure 先重试再确定性轮换

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步、追加铁律、机器亲和性铁律。

**可观测行为**: 结构化命中 500/502/503/504、`high_demand`、`biscuit_baker_*_circuit_open` 时，同账号当前 logical cycle 最多一次恢复重试；仍失败则短时熔断该账号，并按“同机同 provider 健康账号 → Codex 已验证跨机 fresh recovery → USM4 跨厂商降级”顺序轮换。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1" -t "USM4 才允许跨厂商降级，CM4/CM1 禁止本地 Claude 或 Grok"
```

**硬阈值**: exit code = 0；`team4 -> team1` 顺序固定；同签名重复第二次不再对同账号重试；CM4/CM1 永不选择 Claude/Grok；跨机 recovery 保持原 role、phase、logical_cycle。

### Step 4: mismatch / infra 故障阻断 attempt 并转人工

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步、验收点 1/3/4、范围限定。

**可观测行为**: snapshot 与合同不匹配、全池不可用、machine_id 缺失/未知、未验证 provider×account×machine 组合、容量缓存与真实凭据冲突时，不创建白跑 attempt，返回 `infrastructure_blocked` 或 `contract_capability_mismatch`，并把结构化 evidence 写入决策日志/告警。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "全池失败或 contract capability mismatch 返回 infrastructure_blocked 且不创建 attempt" -t "capacity cache 误报与宿主真实凭据不一致时 fail-safe" -t "未验证 provider-account-machine 组合与未知 machine_id fail-closed"
```

**硬阈值**: exit code = 0；`attemptStore.createAttempt` 调用次数 = 0；decision detail 含 `failure_class`、`capability_snapshot_id`、`fallback_reason`；相同 failure signature 不进入 generator-fix。

### Step 5: 健康 snapshot 才允许落 attempt 与 decision log

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步、验收点 2/3/4/6。

**可观测行为**: 只有在能力匹配时才创建 attempt；attempt/decision log 记录 `capability_snapshot_id`、`from_target`、`to_target`、`fallback_reason`、canonical `machine_id`；容器 hostname 不会污染落库 machine_id。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "同签名 transient retry 受 logical_cycle 收敛闸约束" -t "container hostname 不会污染 attempt machine_id"
```

**硬阈值**: exit code = 0；健康路径 `createAttempt` 恰好 1 次；`machine_id` 只允许 `us-mac-m4|xian-mac-m4|xian-mac-m1`；重复 signature 进入 wait/human_review 而非再次派发。

## 接缝清单

1. dispatcher ↔ preflight/capability-gate ↔ attempt-store：必须先完成 preflight，再决定是否创建 `harness_attempts`。
2. capability snapshot ↔ provider/GitHub/PostgreSQL/model probes：虽然测试用注入依赖，但结构化 probe 结果 shape 必须与生产调用保持一致。
3. canonical machine identity ↔ Fleet 注册 / `CECELIA_MACHINE_ID`：machine 选择必须来源于受控真相，不得读 Docker hostname。

## 禁 mock 边清单

- `packages/brain/src/orchestrator/dispatcher.js` ↔ `packages/brain/src/orchestrator/preflight/*`（本单要把 preflight 接入 dispatcher，测试必须真调相邻模块，而不是直接 stub 掉返回结果）
- preflight capability gate ↔ 结构化 `ExecutionTarget` 路由决策（本单改账号/机器轮换规则，测试必须真跑路由函数）
- 代码 ↔ `harness_attempts` / `orchestrator_decision_log` 写入形状（本单改落库字段，测试必须真检查传入 payload/detail shape）
- canonical machine resolver ↔ Fleet 注册 / `CECELIA_MACHINE_ID` 输入（本单改机器身份来源，测试必须真跑 resolver，不能 mock 最终 machine_id 字符串）

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| provider 真登录状态 / GitHub 真凭据 / 真 PostgreSQL 外呼 | PRD 明确要求永久回归测试只用注入依赖，不调用真实外部服务 | 本 sprint 以结构化 probe shape 和 fail-safe 路由固化；后续人工演练/运维 smoke 单独验证凭据 |
| 真机跨机 fresh recovery | 合同阶段只验证路由决策与证据 shape，不真实迁移 worker | generator 完成后由独立复审在受控环境演练 CM4/CM1→USM4 路由 |
| 告警发送链真实通知回执 | 本 sprint 不改 alerting 基础设施 | 仅断言 alert handler 收到结构化 payload；通知链沿既有回归池验证 |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

npx vitest run \
  sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts \
  sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  packages/brain/src/orchestrator/__tests__/derive.test.js \
  packages/brain/src/__tests__/dispatcher-preflight-three-strikes.test.js \
  packages/brain/src/__tests__/executor-codex-review-preflight.test.js \
  packages/brain/src/__tests__/fleet-heartbeat.test.js

bash scripts/check-version-sync.sh
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| capability snapshot / ExecutionTarget 路由 | `sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts` | `capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id` / `team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1` / `全池失败或 contract capability mismatch 返回 infrastructure_blocked 且不创建 attempt` / `capacity cache 误报与宿主真实凭据不一致时 fail-safe` / `未验证 provider-account-machine 组合与未知 machine_id fail-closed` / `USM4 才允许跨厂商降级，CM4/CM1 禁止本地 Claude 或 Grok` | 模块 `packages/brain/src/orchestrator/preflight/*.js` 尚不存在，import 失败或断言失败 |
| dispatcher 接线 / 收敛 / machine_id | `sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts` | `dispatcher 在 createAttempt 前执行 preflight 并写 capability_snapshot_id` / `同签名 transient retry 受 logical_cycle 收敛闸约束` / `container hostname 不会污染 attempt machine_id` | 当前 dispatcher 尚未调用 preflight，也默认回退 `os.hostname()`，测试应红 |
