# PRD：Provider-neutral Harness Commander 融合与跨设备调度

日期：2026-07-25
优先级：P0
状态：设计已确认，交下一 Session 制定实施计划
适用仓库：Cecelia
目标设备：US M4、`xian-m4`、后续新 M1
目标 Provider：Claude、Codex、Grok

## 0. 给下一 Session 的任务说明

这不是从零重写 Harness，也不是把所有 Harness Pipeline 收进一个巨型 LLM Session。

任务是把两套已经存在但各有缺口的能力融合：

1. 旧 One-session Harness：每条 Harness 有一个独立、灵活、能理解全局上下文的 LLM Commander。
2. Kernel v1：用确定性代码管理状态、门禁、租约、幂等、重试和恢复，但缺少持续、灵活的 Run 级 LLM Commander。

目标产物是一套混合架构：

> 每条 Harness Run 保留一个独立、Provider-neutral、全程可见的 LLM Commander；L0 Safety Kernel 保有最终执行权；Fleet Supervisor 将每个 Attempt 独立调度到 US M4、`xian-m4` 或 M1。

下一 Session 必须先核对本文所列事实与当前代码，再编写实施计划。禁止直接把旧
`harness-controller` Prompt 塞入 Kernel，禁止为 Claude、Codex、Grok 复制三套状态机。

## 1. 背景与问题

### 1.1 Brain 与 Harness Controller 的现状

Cecelia Brain 当前运行在 US M4，包含三层认知架构：

- L0 脑干：纯代码，负责 Tick、状态机、派发、保护和恢复。
- L1 丘脑：LLM，负责快速语义判断与事件路由。
- L2 皮层：LLM，负责深度分析、RCA 和战略调整。

Harness Controller 不是 Brain 之外的第四层。它属于 L0 所管理的 Run 级控制能力。

当前又存在两种 Harness 控制形态：

1. 旧 Harness：一个长期 LLM Controller Session 负责一条 Pipeline，灵活但运行真相容易
   依赖 Session、宿主机和隐式上下文。
2. Kernel v1：`orchestrator/run.js` 为一个 `run_id` 启动确定性 reconcile loop，
   `derive.js` 决定下一动作，可靠但面对未知异常时较僵硬。

L1/L2 当前是 Brain 的全局认知能力，不等价于“每条 Harness 一个长期 Commander”，
也不会天然持续订阅每条 Run 的完整事件。

### 1.2 2026-07-25 Lane 4 实弹暴露的问题

本次要求原本是：在 `xian-m4` 上使用 Codex/team4/GPT-5.5 跑 Kernel Harness。
实际结果不能证明 `xian-m4` 的执行能力，原因包括：

1. 创建的任务被错误写成 `location=us`。
2. `harness-skill-relay.js` 在看到 `harness_runtime=kernel-v1` 后提前进入本机
   `_spawnKernelRuntime`，早于后面的 `location=xian` 分支。
3. `team4` 被误当成物理设备标识；实际它只是账号 Lane。
4. 所有 Attempt 实际运行在 US M4。
5. Reviewer 的 `readOnly=true` 同时触发外层只读挂载与 Codex 内层
   `--sandbox read-only`，Docker 内的 `bwrap/unshare` 无法创建 namespace。
6. Reviewer 连续没有结构化 verdict，L0 按规则终止为 `gan_no_verdict_streak`。
7. 后续 Provider 503 是重试期间的次生故障，不是最初死亡原因。
8. `xian-m4` Worker `/health` 报 `docker_available=false`，但 SSH 上 Docker Server
   实际可用，说明健康探测可能存在启动时缓存不刷新问题。

以上问题说明机器、账号、模型、Provider、Controller Session 和 Run 状态尚未彻底解耦。

## 2. 产品目标

### 2.1 核心目标

1. 每条 Harness Run 都有一个逻辑独立的 LLM Commander。
2. Commander 可由 Claude、Codex 或 Grok 承担，不绑定某一家 Provider。
3. Commander 能看到该 Run 从开始到结束的完整事件和决策历史。
4. L0 Safety Kernel 继续拥有状态推进、幂等、租约、预算和安全门禁的最终权力。
5. 每个 Planner、Proposer、Reviewer、Generator、Evaluator、Judge 或 Commander Attempt
   都可以独立选择执行机器。
6. 显式指定 `xian-m4` 的 Attempt 必须实际落在 `xian-m4`；不可静默回落 US M4。
7. Controller、Provider、模型、账号和机器成为五个相互独立的轴。
8. Commander 或 Worker Session 丢失后，可从 DB、Git、PR 和事件日志恢复。

### 2.2 成功定义

成功不是“能启动三个 Provider”，而是以下闭环成立：

```text
Run 创建
→ 独立 Commander 获得完整 Run 上下文
→ Commander 给出结构化指挥建议
→ L0 校验并执行
→ Fleet Supervisor 把 Attempt 放到正确机器
→ Worker 回传统一结果
→ Run 事件与 Commander Memory 持久化
→ 故障后可换进程、换机器或换 Provider 继续
→ 所有门禁通过后完成交付
```

## 3. 非目标

本项目不做：

1. 不将 Brain L1/L2 改造成每条 Harness 的专属 Commander。
2. 不允许 LLM Commander 直接写核心状态表或绕过 L0 门禁。
3. 不让一个 Commander Session 同时持有多条 Run 的业务上下文。
4. 不把 Provider Session 或 LangGraph checkpoint 当作流程真相。
5. 不在本期实现多 Active Brain 共识；同一时间仍只有一个 Active Brain Leader。
6. 不静默迁移明确指定机器的任务。
7. 不为三家 Provider 分叉三套 Prompt、状态机或业务逻辑。
8. 不因本项目重构与 Harness/Fleet 无关的 Brain 模块。

## 4. 术语与边界

| 名称 | 范围 | 是否 LLM | 职责 |
|---|---|---:|---|
| Brain | 全局 | 混合 | Cecelia 总体调度、认知、记忆和保护 |
| Fleet Supervisor | 全局 | 否 | 设备健康、容量、公平性、机器选择 |
| Run Safety Kernel | 单 Run | 否 | 状态机、门禁、幂等、租约、预算、恢复 |
| LLM Commander | 单 Run | 是 | 理解全程、制定策略、指导角色、处理未知异常 |
| Attempt Supervisor | 单 Attempt | 否 | 启动、心跳、超时、回调、恢复和证据 |
| Role Worker | 单 Attempt | 是 | Planner、Reviewer、Generator 等具体工作 |

“一个 Active Controller”必须拆成两个不变量：

1. 全局同一时刻只有一个 Active Fleet Supervisor/Brain Leader。
2. 每个 `run_id` 同一时刻只有一个 Active Run Safety Kernel。

物理上可以只有一个 Brain 服务；逻辑上每条 Run 必须拥有隔离的 Controller 状态和
Commander Memory。

## 5. 目标架构

```text
US M4
└── Cecelia Brain
    ├── L1/L2 全局认知层
    │
    └── L0 控制层
        ├── Fleet Supervisor
        │   ├── US M4 health/capacity
        │   ├── xian-m4 health/capacity
        │   └── M1 health/capacity
        │
        ├── Run A
        │   ├── Run Safety Kernel A
        │   ├── LLM Commander A
        │   └── Attempt Supervisors
        │
        └── Run B
            ├── Run Safety Kernel B
            ├── LLM Commander B
            └── Attempt Supervisors

Workers
├── US M4：Claude/Codex/Grok Role Attempts
├── xian-m4：Claude/Codex/Grok Role Attempts
└── M1：Claude/Codex/Grok Role Attempts
```

Brain 默认继续部署在 US M4。跨设备扩容通过 Worker 完成，不要求把 Brain 搬到
`xian-m4`。未来可增加备用 Brain，但不属于本 PRD。

## 6. 核心产品需求

### FR-1：每 Run 一个独立 LLM Commander

每个 `run_id` 必须有独立 Commander 身份、上下文和游标：

- `commander_id`
- `run_id`
- `provider`
- `account_id`
- `model`
- `provider_session_id`
- `event_cursor`
- `strategy_summary`
- `active_risks`
- `latest_guidance`
- `status`

Commander 的身份属于 Run，不属于某个进程。进程或 Provider Session 丢失时，可以创建
新的 Commander Attempt，读取同一 Run 的持久状态后继续。

不同 Run 的原始 Prompt、合同内容、反馈和私有上下文不可进入另一 Run 的 CommanderBundle。

### FR-2：事件驱动的全程监控

“全程监控”定义为：

1. 该 Run 的所有控制事件、Attempt 事件、机器路由、Provider 错误、verdict、Git/PR SHA
   和人工指令都进入持久事件流。
2. Commander 可以从 Run 开始位置读取到当前事件游标。
3. 正常心跳由 L0 持续监管，不要求每次心跳调用 LLM。
4. Commander 在关键节点和异常节点被唤醒，获得自上次游标之后的事件及压缩后的全程摘要。

必唤醒节点：

- Run 启动；
- Planner 完成；
- 每轮 Proposer/Reviewer 结束；
- 合同批准或连续拒绝；
- 进入 Generator 前；
- CI 或 Evaluator 结果到达；
- Judge verdict 到达；
- Merge 前；
- Run 终止或完成；
- 用户插入新指令；
- 未知错误、连续无进展、机器迁移或 Provider 反复失败。

普通 60 秒 heartbeat、健康的轮询等待、可由固定策略处理的一次瞬时 503，不单独唤醒
Commander，但事件仍必须可追溯。

### FR-3：Commander 只输出统一结构化指令

三家 Provider 接收统一 `CommanderBundle`，返回统一 `CommanderDirective`。

允许的首版动作：

- `continue_default`
- `dispatch_role`
- `retry_attempt`
- `revise_guidance`
- `switch_provider`
- `switch_machine`
- `pause_run`
- `request_human`
- `abort_run`

示例：

```json
{
  "schema": "commander-directive/v1",
  "run_id": "run-uuid",
  "event_cursor": 42,
  "action": "retry_attempt",
  "target_role": "reviewer",
  "reason": "The reviewer failed in the runner sandbox before producing a verdict.",
  "guidance": "Keep the approved contract unchanged and repair only the execution environment.",
  "route": {
    "machine": "xian-m4",
    "provider": "codex",
    "account": "team4",
    "model": "GPT-5.5"
  },
  "evidence_refs": [
    "attempt:attempt-uuid",
    "event:41"
  ]
}
```

自由文本不得直接触发副作用。缺少 schema、证据引用、当前游标或合法 action 的结果，
只能记录为无效建议。

### FR-4：L0 Safety Kernel 保有最终执行权

L0 必须验证 CommanderDirective：

1. `run_id` 与当前 Run 一致。
2. `event_cursor` 未过期；过期建议必须重新观测。
3. 当前 phase 允许该 action。
4. 不产生重复 `(run_id, hop)` 或重复 Attempt。
5. 不超过预算、重试、并发和 deadline。
6. 不违反显式机器强绑定。
7. Provider、账号、模型和机器组合在能力矩阵中合法。
8. 证据引用属于当前 Run。
9. Merge、生产放行等高风险动作继续经过现有硬门禁。

L0 可以拒绝 Commander 建议，但必须写结构化拒绝原因，并将拒绝事件反馈给同一 Commander。

### FR-5：Provider-neutral Commander

Commander 和 Role Worker 都使用统一 Provider Adapter 边界。当前支持：

- Claude
- Codex
- Grok

现有 Adapter 能力 `start / resume / inspect / cancel / normalizeResult` 应继续作为基础；
不得在 `derive.js` 或业务状态机中判断 Provider。

Provider 专属内容只能存在于：

- Adapter；
- 凭据解析；
- CLI 参数构造；
- Provider 原始结果归一化。

Commander Prompt、Run Event、Directive、HarnessResult 和控制状态必须保持 Provider-neutral。

### FR-6：Provider 故障接管

每条 Run 可声明：

```yaml
commander:
  primary:
    provider: codex
    account: team4
    model: GPT-5.5
  fallbacks:
    - provider: claude
      account: team2
    - provider: grok
      account: grok
```

自动跨 Provider 接管仅允许用于基础设施或 Provider 可用性错误：

- 认证账号被熔断；
- 明确的 rate limit；
- 连续 5xx/503 达阈值；
- Provider Session 无法恢复；
- CLI 或 Runner 启动失败。

语义失败、合同被 Reviewer 拒绝、Evaluator 发现产品缺陷，不得伪装成 Provider 故障自动换家。

跨 Provider 接管必须创建新 Commander Attempt，不复制不兼容的 Session ID；新 Provider 从
`CommanderBundle + Run Event Log + Commander Memory` 恢复。

### FR-7：五轴彻底分离

每个 Commander/Role Assignment 必须独立表达：

```yaml
role: reviewer
provider: codex
model: GPT-5.5
account: team4
machine: xian-m4
```

约束：

- `team4` 不能推导出 `xian-m4`。
- `codex` 不能推导出 US 或 Xian。
- `GPT-5.5` 不能推导账号或机器。
- `location=xian` 不能只作为 Prompt 文本；必须进入真实 RoutingDecision。

Attempt 落库前必须持久化最终解析结果：

- `requested_machine`
- `actual_machine_id`
- `provider`
- `account_id`
- `model`
- `runner_version`
- `runner_digest`
- `route_reason`
- `strict_affinity`

### FR-8：Attempt 级跨设备调度

最小调度单元是 Attempt，不是整个 Harness Run。

同一 Run 可以：

```text
Commander  → US M4
Planner    → M1
Proposer   → xian-m4
Reviewer   → US M4
Generator  → xian-m4
Evaluator  → M1
```

显式机器要求：

- `strict_affinity=true`：目标机器不可用时 loud-fail 或等待，不得改派。
- `strict_affinity=false`：可按声明的 fallback machine pool 重路由，但必须新增 Attempt，
  保存原失败和新 RoutingDecision。
- 未指定机器：Fleet Supervisor 按能力、健康、空闲 Slot、资源压力和公平性选择。

### FR-9：Fleet Supervisor

Fleet Supervisor 只管理全局资源，不介入某条 Run 的业务策略。

它必须：

1. 周期性刷新 US M4、`xian-m4`、M1 的真实健康与容量。
2. 健康状态必须有 TTL；启动时失败不可永久缓存。
3. 区分 Worker HTTP 健康、Docker 可用、Runner 镜像版本、Provider 凭据可用和剩余 Slot。
4. 对候选机器先过滤 capability，再评分。
5. 预留 Slot 后再落 RoutingDecision，避免并发超卖。
6. 全局公平性不得覆盖显式机器强绑定。
7. 路由失败必须给出逐候选机器的拒绝原因。

### FR-10：统一 Runner Contract

所有机器必须执行同一版本的 Runner Contract：

- 相同 TaskBundle schema；
- 相同 HarnessResult/CommanderDirective schema；
- 相同 callback 鉴权；
- 相同 heartbeat 与 lease 语义；
- 相同 Runner Contract 版本；跨架构设备使用同一 multi-arch manifest，或记录并验证
  可证明等价的 per-platform runner digest；
- 相同只读、安全和证据规则。

远端 Worker Daemon 只负责启动规范化 Runner，不得自行实现另一套 Codex/Claude/Grok
业务命令。

Reviewer 只读必须通过外层执行边界实现。若 Worktree 已只读挂载，禁止再在 Docker 内启动
会依赖 `bwrap/unshare` 的嵌套 Provider 沙箱。三个设备必须有相同测试证明。

### FR-11：持久真相与恢复

流程真相只能来自：

- PostgreSQL Run/Attempt/Decision/Event 数据；
- Git commit/branch；
- GitHub PR 和 CI；
- 已落库合同、verdict 和证据。

以下内容只能作为优化，不能作为真相：

- LLM 对话记忆；
- Provider Session；
- tmux；
- 容器本地文件；
- 某台机器上的临时 Worktree；
- 进程内计数。

恢复规则：

1. 同一 Attempt、有兼容 Provider Session 且原机器仍可访问时，可以 resume。
2. 跨机器或跨 Provider 时，不冒充 resume；关闭旧 Attempt，创建新 Attempt。
3. 新 Commander 从持久事件和摘要恢复。
4. Run 的 `(run_id, hop)` fencing 和 Attempt lease 继续防止双执行。

### FR-12：个性化指导

每条 Run 必须拥有独立 `RunProfile`，至少包含：

```yaml
run_id: run-uuid
objective: 海外不同机型与模型组合适配
workflow: gan-development
priority: P0
commander:
  primary: { provider: codex, account: team4, model: GPT-5.5 }
  fallbacks:
    - { provider: claude, account: team2 }
roles:
  planner: { provider: codex, account: team4, model: GPT-5.5 }
  proposer: { provider: codex, account: team4, model: GPT-5.5 }
  reviewer: { provider: codex, account: team4, model: GPT-5.5 }
routing:
  preferred_machine: xian-m4
  strict_affinity: true
budget:
  max_usd: 10
  max_hops: 200
```

CommanderBundle 必须包含该 Run 的：

- 原始目标与不可变约束；
- 当前 phase；
- 已批准合同；
- 最近角色产物；
- 已拒绝方案与原因；
- 当前风险；
- 机器和 Provider 历史；
- 预算与剩余重试；
- 自上次 Commander 游标后的新事件；
- 全程压缩摘要；
- 允许动作集合。

因此“共用一个 Brain 服务”不能导致不同 Pipeline 使用同一份通用指导。

### FR-13：可观测性

Dashboard/API 至少可以回答：

1. 这条 Run 当前由哪个 Commander Provider/模型指挥？
2. Commander 最后看到了哪个事件？
3. Commander 建议了什么？L0 是否接受？若拒绝，为什么？
4. 每个 Attempt 请求去哪台机器，实际去哪台机器？
5. 使用了哪个 Provider、账号、模型和 Runner digest？
6. 失败属于业务、Provider、Runner、机器、路由还是控制面？
7. 是否发生过跨 Provider 或跨机器接管？
8. 当前谁持有 Run lease 和 Attempt lease？

所有自动改派必须写事件，禁止只出现在日志字符串中。

## 7. 主要数据契约

### 7.1 CommanderBundle

```json
{
  "schema": "commander-bundle/v1",
  "run_id": "run-uuid",
  "commander_attempt_id": "attempt-uuid",
  "event_cursor": 42,
  "run_profile": {},
  "objective": {},
  "observed": {},
  "history_summary": {},
  "new_events": [],
  "active_risks": [],
  "budgets": {},
  "allowed_actions": [],
  "output_schema": "commander-directive/v1"
}
```

### 7.2 RoutingDecision

```json
{
  "schema": "routing-decision/v1",
  "run_id": "run-uuid",
  "attempt_id": "attempt-uuid",
  "requested_machine": "xian-m4",
  "actual_machine_id": "registry-machine-id",
  "strict_affinity": true,
  "provider": "codex",
  "account_id": "team4",
  "model": "GPT-5.5",
  "runner_digest": "sha256:...",
  "reason": "explicit strict machine request",
  "rejected_candidates": []
}
```

### 7.3 事件最小集合

- `run.created`
- `commander.started`
- `commander.directive_proposed`
- `commander.directive_accepted`
- `commander.directive_rejected`
- `commander.failover_started`
- `commander.failover_completed`
- `routing.requested`
- `routing.reserved`
- `routing.rejected`
- `attempt.starting`
- `attempt.running`
- `attempt.heartbeat`
- `attempt.completed`
- `attempt.failed`
- `attempt.expired`
- `run.phase_changed`
- `run.paused`
- `run.failed`
- `run.completed`

高频 heartbeat 可压缩存储，但最新心跳和过期判定必须可审计。

## 8. 错误处理矩阵

| 故障 | 默认处理 | 是否唤醒 Commander | 是否允许自动换 Provider/机器 |
|---|---|---:|---|
| 单次 Provider 503 | L0 有界退避 | 否 | 阈值前否 |
| 连续 Provider 5xx 达阈值 | 记录 Provider 故障 | 是 | 按 fallback 配置允许 |
| 认证失败/账号熔断 | 禁止继续使用账号 | 是 | 允许换合法账号/Provider |
| Worker health 过期 | 停止新派发 | 是 | 非 strict 可换机器 |
| 显式 `xian-m4` 不可用 | loud-fail 或等待 | 是 | strict 时禁止 |
| Docker/Runner 启动失败 | 基础设施失败 | 是 | 非 strict 可重路由 |
| Reviewer 无 verdict | 先区分 Runner 与语义原因 | 是 | 不得直接归类语义失败 |
| Reviewer 拒绝合同 | 进入业务反馈循环 | 是 | 不自动换 Provider |
| Commander 输出非法 schema | L0 拒绝并记录 | 是，有限次数 | 达阈值后 fallback |
| Commander Session 丢失 | 新 Commander Attempt 恢复 | 是 | 允许按配置换 Provider |
| stale event cursor | 丢弃建议并重新观测 | 是 | 不适用 |
| 重复 `(run_id, hop)` | 当前实例让位 | 否 | 不适用 |

错误分类至少包含：

- `business`
- `provider`
- `account`
- `runner`
- `machine`
- `routing`
- `controller`
- `contract`
- `unknown`

`unknown` 不得直接按业务失败终止；必须唤醒 Commander 或人工升级。

## 9. 安全与权限

1. Commander 不能直接调用数据库写核心状态，只能提交 Directive。
2. L0 是 Directive 的唯一执行者。
3. Callback 使用 Attempt 级 secret，并验证 `attempt_id/run_id/role/provider`。
4. 账号凭据只注入被选中的 Worker，禁止写进 CommanderBundle 或事件日志。
5. Reviewer 只读由外层容器和挂载契约保证，不依赖嵌套沙箱。
6. Merge、生产放行和高风险动作保留既有人工/证据门禁。
7. 日志和事件不得记录 token、API key 或完整认证配置。

## 10. 兼容与迁移

采用渐进式迁移：

1. 保留旧 One-session Harness 路径作为回滚方案。
2. 保留当前 Kernel v1 纯 L0 模式。
3. 新增 `commander_mode`：
   - `legacy-session`
   - `kernel-only`
   - `hybrid`
4. 只对显式 `commander_mode=hybrid` 的 canary Run 启用新 Commander。
5. Provider、机器和账号配置缺失时 loud-fail，不默默回旧路径。
6. 证明 hybrid 等价或优于旧路径后，再讨论默认切换；本 PRD不要求立即删除旧路径。

## 11. 验收标准

### 11.1 架构验收

- [ ] 每个 `run_id` 有独立 Commander 状态、事件游标和 Memory。
- [ ] Run Safety Kernel 与 LLM Commander 是两个清晰组件。
- [ ] Fleet Supervisor 不读取或决定 Run 业务策略。
- [ ] `derive.js` 不出现 Claude/Codex/Grok 分支。
- [ ] Provider 专属逻辑只在 Adapter/credential/CLI 边界。

### 11.2 Provider 验收

- [ ] 同一 CommanderBundle 可分别由 Claude、Codex、Grok 返回合法 Directive。
- [ ] 三家输出通过相同 schema 校验。
- [ ] Codex Commander 故障后可由 Claude 或 Grok 从持久状态接管。
- [ ] 跨 Provider 接管创建新 Attempt，不伪造 resume。
- [ ] 混合角色组合可运行，例如 Codex Commander + Claude Planner + Grok Reviewer。

### 11.3 跨设备验收

- [ ] `strict_affinity=true + machine=xian-m4` 的真实 Attempt 只在 `xian-m4` 执行。
- [ ] 数据库同时记录 `requested_machine=xian-m4` 与真实 `actual_machine_id`。
- [ ] `team4` 不被用作机器选择依据。
- [ ] Kernel v1 不再因提前本机 return 绕过 Xian 路由。
- [ ] US M4、`xian-m4`、M1 使用同一 Runner Contract 版本，并记录可验证的
  multi-arch manifest 或 per-platform runner digest。
- [ ] Worker Docker 健康状态会重新探测，不永久缓存启动时失败。

### 11.4 Commander 全程监控验收

- [ ] Commander 在 Run 启动、每个阶段边界、异常和 Merge 前被唤醒。
- [ ] Commander 可读取该 Run 的完整摘要与增量事件。
- [ ] 普通 heartbeat 不产生无意义 LLM 调用。
- [ ] Commander Session 被杀后，新 Session 能恢复策略摘要和事件游标。
- [ ] Run A 的上下文不会进入 Run B 的 CommanderBundle。

### 11.5 安全与故障验收

- [ ] L0 拒绝过期 event cursor 的 Directive。
- [ ] L0 拒绝违反 strict machine affinity 的换机建议。
- [ ] L0 拒绝预算超限、非法 phase 和重复 hop。
- [ ] Reviewer 在三台机器上均不会因嵌套 `bwrap/unshare` 失败。
- [ ] Provider 503、Runner 失败、语义拒绝被分成不同 failure class。
- [ ] 所有改派和接管都有结构化事件与证据。

## 12. 测试与实弹

### 12.1 单元测试

1. CommanderBundle 构造与 Run 隔离。
2. CommanderDirective schema 与 action 白名单。
3. stale cursor、预算、phase、strict affinity 校验。
4. Provider capability 与 fallback 解析。
5. Machine/Provider/account/model 五轴独立解析。
6. Health TTL 与重新探测。

### 12.2 集成测试

1. Run Event → Commander 唤醒 → Directive → L0 校验 → Attempt 创建。
2. Commander 非法 Directive 被拒绝并回写事件。
3. Codex Commander 503 达阈值 → Claude Commander 接管。
4. `location=xian` + Kernel v1 → 真实 remote launcher，而非 US 本地 Docker。
5. Reviewer 外层只读运行成功且不调用嵌套 read-only sandbox。
6. Controller/Worker 崩溃后从 DB/Git/PR 重建下一 hop。

### 12.3 三机实弹

必须运行一条非核心 canary：

```text
Commander → US M4 / Codex
Planner   → M1 / Claude 或 Codex
Proposer  → xian-m4 / Codex
Reviewer  → US M4 / Grok 或 Claude
Generator → xian-m4 / Codex
Evaluator → M1 / Claude 或 Codex
```

验收证据必须包含：

- Run ID；
- 每个 Attempt ID；
- requested/actual machine；
- Provider/account/model；
- Runner digest；
- heartbeat；
- callback；
- Commander Directive 与 L0 接受/拒绝结果；
- 最终 PR/CI/verdict。

随后再运行严格 Xian canary：

```text
commander_mode=hybrid
machine=xian-m4
strict_affinity=true
provider=codex
account=team4
model=GPT-5.5
```

任何 Attempt 落到 US M4 都算验收失败，不得以“Provider 正常”替代设备证据。

## 13. 建议实施分期

### Phase 1：契约与持久状态

- CommanderBundle/Directive schema；
- Run Commander 状态与事件游标；
- Directive validator；
- 事件集合和可观测字段；
- 不接真实 LLM 副作用。

### Phase 2：Provider-neutral Commander

- 将 Commander 作为正式 role 接入现有 Provider Registry；
- Claude/Codex/Grok Adapter 合同测试；
- 关键节点唤醒与 event-driven memory；
- Provider 故障接管。

### Phase 3：Attempt 级 Fleet Routing

- Kernel Dispatcher 接机器解析与 Slot reservation；
- 修复 Kernel v1 绕过 `location=xian`；
- Requested/actual machine 证据；
- strict affinity 和非 strict fallback。

### Phase 4：统一 Runner 与故障闭环

- US M4、`xian-m4`、M1 Runner Contract 对齐；
- Reviewer 外层只读；
- Worker health TTL；
- 统一 failure classification。

### Phase 5：Canary 与默认策略

- 三 Provider 合同实测；
- 三机混合 canary；
- Xian strict canary；
- 故障注入；
- 形成是否把 `hybrid` 设为默认的独立决策。

每个 Phase 必须可以单独回滚。不要用一个超大 PR 同时完成五个 Phase。

## 14. 代码导航

下一 Session 至少检查：

- `packages/brain/src/orchestrator/README.md`
- `packages/brain/src/orchestrator/run.js`
- `packages/brain/src/orchestrator/loop.js`
- `packages/brain/src/orchestrator/derive.js`
- `packages/brain/src/orchestrator/dispatcher.js`
- `packages/brain/src/orchestrator/execution-contract.js`
- `packages/brain/src/orchestrator/provider-registry.js`
- `packages/brain/src/orchestrator/providers/`
- `packages/brain/src/harness-skill-relay.js`
- `packages/brain/src/harness-relay-watchdog.js`
- `packages/brain/src/routing/resolve-executor.js`
- `packages/brain/src/routing/load-machines.js`
- `packages/brain/src/routing/select-load-balanced.js`
- `packages/brain/src/fleet-resource-cache.js`
- `packages/brain/src/slot-allocator.js`
- `packages/brain/src/spawn/detached.js`
- `docker/cecelia-runner/entrypoint.sh`
- `sprints/07171830-xian-harness-lane/`

同时核对 `xian-m4` 当前 Worker Daemon 与 Cecelia 仓库 Runner Contract，不能只改 US 仓库后
假设远端已自动一致。

## 15. 实施铁律

1. 遵守根目录 `AGENTS.md`：不直接 push main，不跳过 DevGate。
2. Brain 源码变更按仓库版本规则同步更新定义与版本。
3. Bugfix/行为变更必须先 RED 再 GREEN。
4. 所有真实路由声明必须以 `actual_machine_id` 证据验收。
5. 显式路由非法或不可用时 loud-fail，不静默改派。
6. 不修改测试来迎合实现。
7. 保留用户当前 Worktree 的无关修改。
8. 不以 mock、账号名、Prompt 文本或本机日志代替远端实弹。
9. 先提交分 Phase 实施计划并评审，再开始编码。

## 16. 最终产品判断

本项目完成后，Cecelia Harness 应同时具备：

- 旧 LLM Commander 的灵活指挥能力；
- Kernel L0 的确定性、安全和可恢复性；
- Claude、Codex、Grok 的可替换性；
- US M4、`xian-m4`、M1 的细粒度算力调度；
- 每条 Pipeline 的独立上下文和个性化指导；
- 从事件日志可完整解释“谁在什么时候，为什么，把什么任务派到哪台机器”。

这才是“融合”完成，而不是简单地给现有 Kernel 多加一次 LLM 调用。
