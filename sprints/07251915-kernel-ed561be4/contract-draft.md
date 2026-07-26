# Sprint Contract Draft (Round 3)

## 合同边界

- 本合同只覆盖 Kernel Harness 派发前能力预检、ExecutionTarget 路由、能力快照、故障分类与结构化证据；对 Commander 只提供 `parseCapabilityRequirements` / `resolveExecutionTarget` / `buildCapabilityEvidence` 三个稳定纯函数接口，不实现或依赖 Commander、Commander Memory、CommanderDirective、Actor Inbox、新事件账本。
- telemetry schema 与跨 run contract inheritance 保持不变，不在本 sprint 修改。
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
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 每个 probe 有可配置有界超时；snapshot 带 server-owned `created_at/expires_at`，创建 attempt 前二次验鲜，过期/竞态 fail-closed；同签名 transient failure 每账号每 logical cycle 最多一次恢复重试；未知 machine / 未验证组合 fail-closed；evidence 对凭据字段递归脱敏。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 不创建白跑 attempt；不使用 `os.hostname()` 充当 canonical machine_id；不把 infrastructure mismatch 送入 generator-fix；不修改 telemetry schema 与跨 run contract 继承。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | capability snapshot 只对单次 attempt / logical cycle 有效；host capacity/auth 状态过期后必须重建 snapshot，不可跨 run 复用。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | infrastructure_blocked / contract capability mismatch 必须同步产生结构化 alert payload 与 `wait:human_review` 动作；第三次同类 preflight 拒绝仍只告警一次。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | auth/GitHub/PG/model/机器身份任一缺失即 fail-closed，不创建 attempt；transient provider failure 先一次恢复重试，再同 provider 换账号，再按矩阵迁机/跨厂商；重复同签名受收敛闸约束。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 通过真实 gate↔dispatcher 接缝、attemptStore/decision/alert handler 收到的结构化 payload、dispatcher 返回值、Vitest 退出码确认；local_api E2E 只读拉取本 task 验证关联上下文，绝不写生产 DB。 |

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
| 五个 Codex 账号全不可用 | 不创建 attempt，`wait:human_review/infrastructure_blocked`，结构化告警 | 是；证据按 logical_cycle/failure signature 去重 | 不进入 generator-fix |
| 能力已匹配后的实现/测试失败 | 分类 `product_failure` | 由 generator fix loop 负责 | 进入 `generator-fix`，不得伪装成 infra |
| probe 超时或 snapshot 在 createAttempt 前过期 | `preflight_timeout` / `capability_snapshot_expired`，fail-closed | 可在下一次新 snapshot 重试 | 当前 snapshot 作废，不落 attempt |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本任务不新增对外 agent/API，输入只来自 Brain 内部任务 bundle 与受控 Fleet/credential probe。

## Golden Path

覆盖父路 Kernel capability gate：派发前能力预检 第 1-5 步

[读取冻结合同与 role_assignments] → [生成 capability snapshot] → [transient retry/账号轮换/跨机策略] → [mismatch/infra 分流阻断白跑 attempt] → [健康 snapshot 挂 attempt 与决策日志]

### Step 1: 解析冻结合同能力要求与候选 ExecutionTarget

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步、范围限定、预期受影响文件。

**可观测行为**: dispatcher 在创建 attempt 前通过稳定纯函数接口拿到 server-owned capability requirements、候选 `ExecutionTarget={provider,account,machine}` 与 evidence；这些接口不接收 Commander 对象，也不改变 telemetry schema/跨 run inheritance。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "capability parsing routing evidence 是 Commander 可消费的稳定导出且不依赖 Commander"
```

**硬阈值**: exit code = 0；三个稳定接口可直接 import；路由保持 role/phase/logical_cycle/task bundle；结果无 `commander_directive`/`actor_inbox`。

### Step 2: 生成 server-owned capability snapshot

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步、验收点 1-2。

**可观测行为**: snapshot 至少覆盖 provider auth/account、GitHub、PostgreSQL/测试依赖、合同要求的外部模型能力、canonical machine_id、health/capacity，并保留 logical_cycle 与 server-owned `created_at/expires_at`。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id"
```

**硬阈值**: exit code = 0；snapshot 含 `provider/account/machine/capabilities/verified/health/capacity/capability_snapshot_id/logical_cycle/created_at/expires_at`；任一 required capability 缺失、probe 超时或 dispatch 前过期时 fail-closed。

### Step 3: transient provider failure 先重试再确定性轮换

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步、追加铁律、机器亲和性铁律。

**可观测行为**: 结构化命中 500/502/503/504、`high_demand`、`biscuit_baker_*_circuit_open` 时，同账号当前 logical cycle 最多一次恢复重试；仍失败则短时熔断该账号。表驱动矩阵只放行 Codex team1..team5×三台 canonical machine、Claude account1/account2×USM4、Grok grok×USM4；未列组合 fail-closed。Codex 跨机必须 fresh attempt，从 Git/PR/DB 真相恢复并保持 task bundle，禁止伪造 session resume。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1" -t "ExecutionTarget 完整矩阵逐项放行且未列组合 fail-closed" -t "CM1 CM4 禁 Claude Grok 且 USM4 Claude Grok 可确定性降级" -t "Codex 跨机 fresh recovery 保持 task bundle 并从 Git PR DB 真相恢复"
```

**硬阈值**: exit code = 0；矩阵恰好 18 项；`team4 -> team1` 顺序固定；CM4/CM1 永不选择 Claude/Grok；USM4 Claude/Grok 三个目标逐项可降级；跨机 `recovery_mode=fresh_attempt`、`resume_session=false`、`truth_sources=["git","pr","db"]`。

### Step 4: mismatch / infra 故障阻断 attempt 并转人工

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步、验收点 1/3/4、范围限定。

**可观测行为**: 真实 gate↔dispatcher 逐个探测 team1..team5 全失败时，不创建 attempt/launch，不进 generator-fix，返回 `wait:human_review/infrastructure_blocked` 并发结构化告警；能力已匹配后的 product failure 则进入 generator-fix。所有 evidence/decision/alert 均带 `capability_snapshot_id/from_target/to_target/fallback_reason/failure_class`。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "全池失败返回人审基础设施阻塞并产出结构化告警与 evidence" -t "能力匹配后的 product failure 仍进入 generator-fix" && npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "五个 Codex 账号全失败时 dispatcher 不建 attempt 并转人审告警"
```

**硬阈值**: exit code = 0；probe 顺序 `team1..team5`；`createAttempt/launch` 次数 = 0；infra 的 action=`wait:human_review` 且 `should_enter_generator_fix=false`；product 的 action=`generator-fix`。

### Step 5: 健康 snapshot 才允许落 attempt 与 decision log

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步、验收点 2/3/4/6。

**可观测行为**: 只有在能力匹配且 snapshot 未过期时才创建合法裸 UUID attempt；attempt/decision log 记录完整 evidence；canonical resolver 只接受 `CECELIA_MACHINE_ID` 或受控 Fleet，忽略 Docker hostname；敏感凭据必须脱敏。

**验证命令**:
```bash
npx vitest run sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts -t "dispatcher 真实调用 preflight 后才创建合法 UUID attempt 并写完整 evidence" -t "过期 snapshot 在 createAttempt 前被竞态闸拒绝" && npx vitest run sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts -t "canonical machine 仅接受 env 或受控 Fleet 且忽略 Docker hostname" -t "preflight probe 有界 timeout 且过期 snapshot 竞态不得放行" -t "结构化 evidence 脱敏凭据并保留路由审计字段"
```

**硬阈值**: exit code = 0；健康路径 `createAttempt` 恰好 1 次且 run_id/attempt_id 均为裸 UUID；probe timeout <250ms；过期 snapshot 不建 attempt；secret 原文不出现在 evidence JSON。

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
| production 数据库写入路径 | controller 明确 `production_db_mutation_allowed=false`，本 sprint E2E 禁止生产写库 | local_api 只做无副作用 curl+jq；如人工需查证只允许只读 psql |

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd /workspace

HARNESS_TASK_ID="${HARNESS_TASK_ID:-ed561be4-940a-4c26-844c-e3c5a5a3f7c8}"
TASK_JSON=$(curl -fsS --max-time 10 "http://localhost:5221/api/brain/tasks/$HARNESS_TASK_ID")
echo "$TASK_JSON" | jq -e --arg id "$HARNESS_TASK_ID" '
  (.id // .task.id) == $id
  and ((.title // .task.title) | contains("Kernel capability gate"))
  and ((.payload.sprint_dir // .task.payload.sprint_dir) == "sprints/07251915-kernel-ed561be4")
' >/dev/null

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
| capability snapshot / ExecutionTarget / failure classification | `sprints/07251915-kernel-ed561be4/tests/preflight-capability-gate.contract.test.ts` | `capability snapshot 包含 provider auth GitHub PostgreSQL 外部模型能力与 canonical machine_id` / `capability parsing routing evidence 是 Commander 可消费的稳定导出且不依赖 Commander` / `ExecutionTarget 完整矩阵逐项放行且未列组合 fail-closed` / `team4 503 后同 cycle 最多重试一次且切换同 provider 健康账号 team1` / `CM1 CM4 禁 Claude Grok 且 USM4 Claude Grok 可确定性降级` / `Codex 跨机 fresh recovery 保持 task bundle 并从 Git PR DB 真相恢复` / `全池失败返回人审基础设施阻塞并产出结构化告警与 evidence` / `能力匹配后的 product failure 仍进入 generator-fix` / `canonical machine 仅接受 env 或受控 Fleet 且忽略 Docker hostname` / `preflight probe 有界 timeout 且过期 snapshot 竞态不得放行` / `结构化 evidence 脱敏凭据并保留路由审计字段` | 三个 preflight 模块及其稳定导出尚不存在，import 失败；实现空壳也会在矩阵/分流/竞态/脱敏断言处失败 |
| dispatcher 接线 / 全池失败 / snapshot 竞态 | `sprints/07251915-kernel-ed561be4/tests/dispatcher-preflight-wiring.contract.test.ts` | `dispatcher 真实调用 preflight 后才创建合法 UUID attempt 并写完整 evidence` / `五个 Codex 账号全失败时 dispatcher 不建 attempt 并转人审告警` / `过期 snapshot 在 createAttempt 前被竞态闸拒绝` | 当前 dispatcher 尚未调用真实 preflight，也不会做 snapshot 二次验鲜，目标行为断言失败 |
