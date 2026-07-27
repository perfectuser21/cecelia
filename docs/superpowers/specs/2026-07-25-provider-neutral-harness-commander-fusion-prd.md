# PRD：Provider-neutral Harness Commander 融合与跨设备调度

日期：2026-07-25
优先级：P0
状态：设计已确认；2026-07-27 完成生产 as-built 对账，交下一 Session 续接未完成 Phase
适用仓库：Cecelia
目标设备：`us-mac-m4`（US M4）、`xian-mac-m4`（xian-m4/CM4）、
`xian-mac-m1`（M1/CM1）
目标 Provider：Claude、Codex、Grok

## 0. 给下一 Session 的任务说明

这不是从零重写 Harness，也不是把所有 Harness Pipeline 收进一个巨型 LLM Session。

任务是把两套已经存在但各有缺口的能力融合：

1. 旧 One-session Harness：每条 Harness 有一个独立、灵活、能理解全局上下文的 LLM Commander。
2. Kernel v1：用确定性代码管理状态、门禁、租约、幂等、重试和恢复，但缺少持续、灵活的 Run 级 LLM Commander。

目标产物是一套混合架构：

> 每条 Harness Run 保留一个独立、Provider-neutral、全程可见的 LLM Commander；
> US M4 上的 Kernel Run Controller 保有最终执行权；Fleet Supervisor 将 Commander
> Attempt 和 Role Attempt 独立调度到 `us-mac-m4`、`xian-mac-m4` 或 `xian-mac-m1`。

下一 Session 必须先核对本文所列事实与当前代码，再编写实施计划。禁止直接把旧
`harness-controller` Prompt 塞入 Kernel，禁止为 Claude、Codex、Grok 复制三套状态机。

### 0.1 与三项在途 Kernel hotfix 的融合边界

本 PRD 是 Commander/Fleet 的上位架构，不取消、不吞并以下三项在途任务。三者组成
**Phase 0 稳定底座**，必须以三个独立 PR 交付、复审和回滚：

| Phase 0 | Brain Task | 职责 | 本 PRD 消费点 |
|---|---|---|---|
| 0A Durable Resume | `f09c9e31-ed78-4af4-a1b6-88241bc486c5` | approved contract、PRD/PR 里程碑、Attempt 和失败签名跨 Run 恢复 | FR-1、FR-11 |
| 0B Capability Gate | `ed561be4-940a-4c26-844c-e3c5a5a3f7c8` | `ExecutionTarget`、能力快照、账号/机器健康、确定性故障转移 | FR-4、FR-6～FR-9 |
| 0C Attempt Telemetry | `a1fa8636-2ad4-41b4-8de3-8609af83daec` | logical cycle、retry/resume/recovery lineage、耗时与无效 Attempt | FR-13、Phase 1 事件基础 |

Phase 0 不实现 LLM Commander、Commander Memory 或 CommanderDirective。Commander
五个 Phase 必须复用 Phase 0 的恢复、路由和遥测原语，不得另建同义状态机、账号选择器
或第二流程账本。

### 0.2 2026-07-27 生产 as-built 对账

本节是对 2026-07-25 设计的接线盘点，不是第二套架构。权威生产基线为 Brain
`1.267.89`、Git SHA `6b9446e81`。下一 Session 必须从该基线重新核对，不得把已经合入的
Fleet 运输层重写一遍。

| 设计块 | 2026-07-27 状态 | 生产证据或缺口 |
|---|---|---|
| Phase 0A Durable Resume | 未完成 | PR #4336 仍为 OPEN，未进入 `main` |
| Phase 0B Capability Gate | 已合入 | PR #4342 |
| Phase 0C Attempt Telemetry | 已合入 | PR #4343 |
| Phase 1 Commander 契约/状态 | 未开始 | `main` 无 CommanderBundle、Directive、Commander Memory 实现 |
| Phase 2 Provider-neutral Commander | 未开始 | Commander 尚未成为正式 Provider role |
| Phase 3 Fleet Routing | 部分完成 | PR #4352～#4359、#4361、#4363、#4364 已提供 transport、receipt、attestation、reconcile、synthetic canary |
| Phase 4 统一 Runner | 未完成 | US 走 local Docker Runner；Xian 走宿主机 Codex；没有统一执行镜像和工作区 |
| Phase 5 真业务 Canary | 未完成 | 仅 `CANARY_OK` 运输探针；没有完成 Planner→Generator→Evaluator→PR 的真实任务 |

2026-07-27 三机实测：

| 项目 | `us-mac-m4` | `xian-mac-m4` | `xian-mac-m1` |
|---|---|---|---|
| 芯片/内存 | M4 10C / 16GB | M4 10C / 16GB | M1 8C / 16GB |
| macOS | 15.7.4 | 15.6.1 | 15.6.1 |
| Codex | 0.145.0 | 0.145.0 | 0.145.0 |
| Node 执行面 | Runner 20.20.2 | Host 25.8.1 | Host 26.0.0 |
| 容器运行时 | OrbStack | OrbStack | 无 |
| Kernel transport | local-docker | remote-bridge + host Codex | remote-bridge + host Codex |
| Worker 服务域 | Brain 内本地路径 | 用户 LaunchAgent | system LaunchDaemon |
| 数据盘可用 | 41GB | 15GB（使用率 93%） | 93GB |
| 非 Canary 工作区 | per-task mount | 固定旧脏仓库，167 项改动 | 固定目录，但不是 Git 仓库 |
| Credential 来源 | US 本地账号目录 | Xian 本机账号目录 | Xian 本机账号目录 |

远端 Bridge 的 handler checksum 已一致，Codex 版本也已一致；这只证明协议文件相同，
不代表执行环境等价。当前 `kernel-attempt-handler.cjs` 对正常 Attempt 使用固定
`WORK_DIR`，只为 synthetic canary 建一次性空目录；因此 canary 绕过了真实开发最关键的
Git 工作区、依赖、写入隔离和并发冲突问题。

当前 Kernel Attempt 请求也没有从 US M4 下发所选 Codex 凭据。Bridge 只收到账号 ID，
随后调用远端本机 `loadRawAuth(account)`。旧 Bridge endpoint 虽已有 `setupInjectedAccounts`
辅助函数，但没有接入 Kernel Attempt endpoint。以下目标语义尚未实现：

> team1～team5 的账号状态和认证材料只由 US M4 管理；每个 Attempt 只把被选中的一个
> 账号以一次性凭据包注入目标 Worker；Worker 不永久保存、不回填 token。

### 0.3 下一 Session 的立即范围

下一 Session 不新写 Commander/Fleet 总体 PRD，也不重写已合入的 Fleet receipt、
attestation、watchdog 或 canary。立即范围是补齐 Phase 4 的承重接线，使 Phase 5 可以跑
第一条真实业务任务：

1. 三台 macOS Worker 统一 OrbStack、Worker Daemon 和固定 Runner digest；
2. 所有机器由同一 Worker API 启动容器，US M4 不再保留行为不同的特例执行器；
3. 每 Attempt 由 Worker 根据结构化 WorkspaceSpec 创建隔离 Git worktree；
4. US M4 中央账号管理接入 Kernel Attempt 的一次性凭据注入；
5. Worker admission、磁盘/内存/账号/Runner drift 闸 fail-closed；
6. 运行同题 One-session 与 Kernel Harness 真实 A/B，不再用 synthetic canary 代替。

上述范围仍应拆成可独立回滚的小 PR，禁止一次提交 Commander Phase 1～5。

### 0.4 新 Terminal 点火约束

下一 Terminal 使用 Codex Headless One-session Harness 执行，不依赖 Claude Code 额度。启动后：

1. 读取根目录 `AGENTS.md` 和本 PRD 全文；
2. 从 `origin/main` 建独立 worktree；
3. 先输出 Phase 4A～4D 的依赖图、逐 PR 文件边界和 Red 测试；
4. 只从 Phase 4A 开始，完成后保持 PR 未 merge，交独立复审；
5. 每个 Phase 通过复审后再进入下一 Phase；
6. 不改写本 PRD 已定的 Brain/Kernel/Commander 权责；
7. 不把 synthetic canary 作为真实任务 DoD；
8. 不在 Xian 节点手工复制长期 Codex 账号目录。

## 1. 背景与问题

### 1.1 Brain 与 Harness Controller 的现状

Cecelia Brain 当前运行在 US M4，包含三层认知架构：

- L0 脑干：纯代码，负责 Tick、状态机、派发、保护和恢复。
- L1 丘脑：LLM，负责快速语义判断与事件路由。
- L2 皮层：LLM，负责深度分析、RCA 和战略调整。

旧文档中的 “Harness Controller” 不是一个可继续沿用的精确组件名。本文将它拆成：

- `Kernel Run Controller`：Brain 内的 L0 确定性控制组件；
- `LLM Commander`：每 Run 独立、可换 Provider/设备的 LLM 角色。

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

以上问题说明机器、账号、模型、Provider、LLM Session 和 Run 状态尚未彻底解耦。

## 2. 产品目标

### 2.1 核心目标

1. 每条 Harness Run 都有一个逻辑独立的 LLM Commander。
2. Commander 可由 Claude、Codex 或 Grok 承担，不绑定某一家 Provider。
3. Commander 能看到该 Run 从开始到结束的完整事件和决策历史。
4. Kernel Run Controller 继续拥有状态推进、幂等、租约、预算和安全门禁的最终权力。
5. 每个 Planner、Proposer、Reviewer、Generator、Evaluator、Judge 或 Commander Attempt
   都可以独立选择执行机器。
6. 显式指定 `xian-mac-m4` 的 Attempt 必须实际落在该机器；不可静默回落 US M4。
7. Role、Provider、模型、账号和机器成为五个相互独立的轴。
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
| Brain Control Plane | 全局，固定 US M4 | 混合 | Cecelia 总体调度、认知、记忆和保护 |
| Fleet Supervisor | 全局 | 否 | 设备健康、容量、公平性、机器选择 |
| Kernel Run Controller | 单 Run，固定 US M4 | 否 | Brain 内的 L0 状态机、门禁、幂等、租约、预算、恢复 |
| LLM Commander | 单 Run、单次唤醒为 Attempt | 是 | 理解全程、制定策略、指导角色、处理未知异常；可按能力矩阵跨设备 |
| Attempt Supervisor | 单 Attempt | 否 | 启动、心跳、超时、回调、恢复和证据 |
| Role Worker | 单 Attempt | 是 | Planner、Reviewer、Generator 等具体工作；可按能力矩阵跨设备 |

本文禁止单独使用含糊的 `Controller` 指代运行组件；必须写出 `Brain Control Plane`、
`Kernel Run Controller`、`LLM Commander` 或 `Role Worker`。旧 One-session
Harness 的 LLM Controller 能力迁入 `LLM Commander`，控制权迁入
`Kernel Run Controller`。

“一个 Active Controller”必须进一步拆成两个不变量：

1. 全局同一时刻只有一个 Active Fleet Supervisor/Brain Leader。
2. 每个 `run_id` 同一时刻只有一个 Active Kernel Run Controller。

物理上可以只有一个 Brain 服务；逻辑上每条 Run 必须拥有隔离的 Kernel Controller
状态和 Commander Memory。

## 5. 目标架构

```text
US M4
└── Cecelia Brain
    ├── L1/L2 全局认知层
    │
    └── L0 控制层
        ├── Fleet Supervisor
        │   ├── US M4 health/capacity
        │   ├── xian-mac-m4 health/capacity
        │   └── xian-mac-m1 health/capacity
        │
        ├── Run A
        │   ├── Kernel Run Controller A
        │   ├── Commander State/Memory A
        │   └── Attempt Supervisors
        │
        └── Run B
            ├── Kernel Run Controller B
            ├── Commander State/Memory B
            └── Attempt Supervisors

Attempt 执行面
├── US M4：Claude/Codex/Grok Commander + Role Attempts
├── xian-mac-m4：仅 Codex Commander + Role Attempts（当前已验证矩阵）
└── xian-mac-m1：仅 Codex Commander + Role Attempts（当前已验证矩阵）
```

Brain Control Plane、Fleet Supervisor 和所有 Kernel Run Controller 固定部署在 US M4。
跨设备扩容通过 Commander/Role Attempt 完成，不要求把 Brain 搬到 `xian-mac-m4`。
未来可增加备用 Brain，但不属于本 PRD。Claude Code 与 Grok 当前只在 US M4 验证；
禁止因架构图或 fallback 配置把它们静默派到 Xian 设备。

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

`retry_attempt` 表示创建一个带 `retry_of_attempt_id`、保持原
`logical_cycle_id` 的新 Attempt。终态 Attempt 不得复活；跨 Provider 或跨机器时不得复用
旧 Session ID。

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
    "machine": "xian-mac-m4",
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

### FR-3A：Harness Actor Inbox 与角色间通信

LLM Commander、Planner、Proposer、Reviewer、Generator、Evaluator 和 Judge 之间允许
**语义上直达、传输上经 Kernel** 的定向通信：

```text
Commander Inbox ◄─────────────────────────────► Planner Inbox
       ▲                                              │
       │                                              ▼
Reviewer Inbox ◄────── Kernel Message Spine ──────► Generator Inbox
```

每个 `run_id + actor_key` 拥有一个逻辑独立的 `Harness Actor Inbox`。`actor_key` 首版为
`commander/planner/proposer/reviewer/generator/evaluator/judge`；它标识可恢复的逻辑角色，
而不是某个短命 Attempt。新 Attempt 必须从该角色的持久游标继续消费未处理消息。

每条定向消息至少包含：

- `message_id`
- `sender_role`
- `recipient_role`
- `thread_id`
- `correlation_id`
- `source_attempt_id`
- `run_id`
- `event_cursor`
- `message_type`
- `payload`
- `evidence_refs`
- `dedupe_key`

首版消息类型至少支持 `instruction/question/answer/review_feedback/evidence_request/escalation`。
Kernel Run Controller 作为可靠 Message Spine，负责鉴权、持久化、去重、投递、游标、
ack 和消息预算，但不改写发送者的业务含义。接收者在下一份 `CommanderBundle` 或
`TaskBundle` 中看到地址明确的原消息和线程上下文，不需要靠摘要猜测发送者意图。

Agent 可以直接回复另一 Agent，也可以在同一 `thread_id` 下追问；但任何 LLM 角色都不能
绕过 Kernel 直接启动另一角色、修改 Run 状态、共享隐藏 Session 或建立不可回放的
点对点网络通道。需要副作用的消息必须转换为 Directive，再由 Kernel 执行 FR-4 校验。

Actor Inbox 使用 FR-11 既有权威记录的事务性 audit/outbox 定向视图，不得新增第三套
mailbox 流程真相。投影可以重建；`ack/read cursor` 只表示交付状态，不表示 Run 业务状态。
Kernel 拒绝投递时必须记录结构化原因，并把拒绝反馈给原发送者。每条线程受 Run 的消息数、
token、deadline 和收敛预算约束，防止多个 Agent 无界互聊。

`Harness Actor Inbox` 与 Cecelia 接收人类话语、机器 Signal 和 Learning 的全局 Capture
Inbox 是两个作用域：前者只服务一条 Harness Run 内部协作，后者服务全局信息采集，二者
不得共表或共消费游标。

### FR-4：Kernel Run Controller 保有最终执行权

Kernel Run Controller 必须验证 CommanderDirective：

1. `run_id` 与当前 Run 一致。
2. `event_cursor` 未过期；过期建议必须重新观测。
3. 当前 phase 允许该 action。
4. 不产生重复 `(run_id, hop)` 或重复 Attempt。
5. 不超过预算、重试、并发和 deadline。
6. 不违反显式机器强绑定。
7. Provider、账号、模型和机器组合在能力矩阵中合法。
8. 证据引用属于当前 Run。
9. Merge、生产放行等高风险动作继续经过现有硬门禁。

Kernel Run Controller 可以拒绝 Commander 建议，但必须写结构化拒绝原因，并将拒绝事件
反馈给同一 Commander。

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
      account: account1
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

已知基础设施故障首先由 L0 使用 Phase 0B 的确定性策略处理，不为普通瞬时错误白烧一次
Commander 调用：

1. 当前 `ExecutionTarget` 对单次 5xx 做最多一次有界恢复重试；
2. 同签名再次失败，短时熔断该账号并在同 Provider、同机器选择其他健康账号；
3. Codex 在 `strict_affinity=false` 时可选择另一台已验证机器；
4. 仅 US M4 允许按 RunProfile 声明跨 Provider 降级到 Claude Code 或 Grok；
5. 合法目标全部耗尽、错误未知或策略冲突时，才唤醒 Commander 或请求人工。

Commander 可以建议改变 fallback 策略，但不能接管上述确定性账号轮换，也不能绕过
能力矩阵、显式机器强绑定或 L0 熔断状态。

### FR-7：五轴彻底分离

每个 Commander/Role Assignment 必须独立表达：

```yaml
role: reviewer
provider: codex
model: GPT-5.5
account: team4
machine: xian-mac-m4
```

约束：

- `team4` 不能推导出 `xian-mac-m4`。
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

上述字段必须来自结构化 `ExecutionTarget`。当前允许矩阵是声明制白名单：

| Provider | Account | Canonical Machine ID |
|---|---|---|
| Claude Code | `account1`, `account2` | `us-mac-m4` |
| Codex | `team1`～`team5` | `us-mac-m4`, `xian-mac-m4`, `xian-mac-m1` |
| Grok | `grok` | `us-mac-m4` |

Codex 的该行表示中央 Credential Broker 完成后的逻辑能力矩阵，不表示三台机器各自永久保存
team1～team5。实际候选集必须是“US M4 中央健康账号 × ready Codex Worker”的交集。中央
注入未接通前，禁止用远端本地 auth 文件假装该矩阵已经成立。

未列出或未实机验证的 Provider × Account × Machine 组合一律不可选。禁止静默复制凭据，
禁止把账号名、容器 hostname、Prompt 文本或 `location` 别名当作物理机器证据。

### FR-8：Attempt 级跨设备调度

最小调度单元是 Attempt，不是整个 Harness Run。

同一 Run 可以：

```text
Commander  → US M4
Planner    → xian-mac-m1
Proposer   → xian-mac-m4
Reviewer   → US M4
Generator  → xian-mac-m4
Evaluator  → xian-mac-m1
```

显式机器要求：

- `strict_affinity=true`：目标机器不可用时 loud-fail 或等待，不得改派。
- `strict_affinity=false`：可按声明的 fallback machine pool 重路由，但必须新增 Attempt，
  保存原失败和新 RoutingDecision。
- 未指定机器：Fleet Supervisor 按能力、健康、空闲 Slot、资源压力和公平性选择。

Codex 跨机器恢复必须保持同一 `logical_cycle_id`，关闭旧 Attempt 后从 DB、Git、PR 和
事件证据创建 fresh Attempt；不得复制本地 thread/session 文件冒充跨机器 resume。
Claude Code/Grok 在 Xian 机器上未验证，因此 Xian 上 Codex 池耗尽时只能在非 strict
模式迁回 US M4，或进入 `infrastructure_blocked`，不得当地启动 Claude Code/Grok。

### FR-9：Fleet Supervisor

Fleet Supervisor 只管理全局资源，不介入某条 Run 的业务策略。

它必须：

1. 周期性刷新 `us-mac-m4`、`xian-mac-m4`、`xian-mac-m1` 的真实健康与容量。
2. 健康状态必须有 TTL；启动时失败不可永久缓存。
3. 区分 Worker HTTP 健康、Docker 可用、Runner 镜像版本、Provider 凭据可用和剩余 Slot。
4. 对候选机器先过滤 capability，再评分。
5. 预留 Slot 后再落 RoutingDecision，避免并发超卖。
6. 全局公平性不得覆盖显式机器强绑定。
7. 路由失败必须给出逐候选机器的拒绝原因。

Fleet Supervisor 使用 Fleet Registry 的 canonical machine ID。`os.hostname()`、Docker
container ID（实弹曾写成 `79f7d974a2ce`）和展示别名不得落入
`actual_machine_id`。机器身份由受控注册或 `CECELIA_MACHINE_ID` 注入并校验；未知身份
fail-closed。

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

#### FR-10.1：统一 macOS Fleet Node 基线

当前三台 16GB macOS 设备必须使用同一节点基线：

- OrbStack/Docker 作为唯一 Provider 执行介质；
- 初始统一资源档为 6 vCPU / 8GiB VM 内存；后续改档必须走受控 NodeProfile；
- 同一 OCI Runner image digest，禁止生产使用可漂移的 `latest` 作为验收证据；
- 同一 Worker Daemon 代码、API、LaunchDaemon 模板、日志格式和升级方式；
- 同一容器内 Node、Codex、Git、测试工具、entrypoint、Skills 和工具开关；
- 同一 `TaskBundle → Provider → HarnessResult` 调用链。

US M4 可以使用 loopback 或 Unix socket 调用本机 Worker，但不能绕过 Worker API 后维护另一套
local-docker 业务实现。`xian-mac-m4` 的用户 LaunchAgent 必须迁成与其他节点一致的
system LaunchDaemon，不得依赖 GUI 用户已登录。

所有节点必须满足服务器基线：

- `sleep=0`、网络睡眠关闭、来电自动启动；
- Tailscale 和 Worker 随系统启动并自动恢复；
- 时间同步可用；
- Worker 运行在明确的低权限服务账号下；
- 日志轮转，不记录 Prompt 原文或凭据；
- 数据盘可用空间至少 40GB 且使用率不高于 85%，否则自动 drain；
- Runner/Worker/OS/OrbStack 漂移可观测，超过白名单版本时不接新 Attempt。

硬件型号、CPU 核数和地理位置允许不同；执行合同和安全边界必须相同。不同硬件只通过
NodeProfile 和 capacity units 表达，禁止伪造为相同物理容量。

#### FR-10.2：Worker-owned WorkspaceSpec

Brain 不得把某台机器上的绝对路径当作跨设备工作区真相。每个 Attempt 必须携带结构化
WorkspaceSpec：

```json
{
  "repo": "perfectuser21/cecelia",
  "base_sha": "40-char-lowercase-sha",
  "branch": "cp-...",
  "expected_head_sha": "40-char-lowercase-sha-or-null",
  "mode": "read-only|read-write",
  "run_id": "uuid",
  "attempt_id": "uuid"
}
```

Worker 必须：

1. 从受控 bare mirror/fetch cache 获取 Git 结构化真相；
2. 服务端创建 Attempt 专属 worktree，不信任请求中的任意 cwd；
3. 校验 `base_sha/expected_head_sha` 后才启动 Runner；
4. Reviewer/Evaluator 以只读 mount 运行；
5. Writer 只写本 Attempt worktree，并通过 Git SHA/PR 交接给下一机器；
6. terminal callback 后清理容器和 worktree；清理失败进入 quarantine；
7. 同一机器 resume 只可复用受控 SessionStore；跨机器一律 fresh Attempt，从
   DB/Git/PR 恢复，禁止复制 Provider 私有 session 文件。

任何节点的固定 checkout、部署目录或人工工作区都不得作为并发 Generator 的 cwd。

#### FR-10.3：US M4 中央 Codex Credential Broker

team1～team5 的账号状态、配额、熔断和认证材料以 US M4 为唯一权威源。Xian Worker
只声明 `provider=codex` 能力，不再声明或永久持有某个 team 账号。

派发流程：

```text
Fleet Supervisor 选择 machine
→ Capability Gate 选择健康 account
→ Credential Broker 为 attempt_id 签发单账号 CredentialEnvelope
→ Brain 通过已认证的 Worker API 下发
→ Worker 只在目标容器 tmpfs 中生成 0600 CODEX_HOME/auth.json
→ Codex 执行
→ callback 只返回结果和 credential_ref
→ 容器/tmpfs 销毁
```

CredentialEnvelope 的持久元数据只允许包含：

- `credential_ref`
- `attempt_id`
- `account_id`
- `machine_id`
- `issued_at`
- `expires_at`
- `payload_hash`

完整 `auth.json`、access token、refresh token 和 API key：

- 不得写入 PostgreSQL、decision log、Attempt state、Bridge receipt、stdout/stderr 或 callback；
- 不得同时把五个账号发给 Worker，只能发送最终选中的一个账号；
- 不得落到宿主机普通磁盘；只允许 Worker 进程内存和容器 tmpfs；
- 不得由 Worker 回填或覆盖 US M4 权威凭据。

派发前 Credential Broker 必须确认凭据剩余有效期覆盖 Attempt deadline 加安全余量；不满足时
先在 US M4 中央刷新或熔断账号，禁止让远端 Worker 自行承担跨 Attempt 的凭据刷新责任。
若 Codex 在临时副本中修改认证文件，Worker 只上报布尔型
`credential_copy_mutated=true`，销毁副本并触发 US M4 重新校验；绝不回传修改后的 token。

当前 `CODEX_ACCOUNT_ALLOWLIST` 和远端本机 `loadRawAuth` 只能作为迁移期兼容代码。中央注入
通过真业务 canary 后必须关闭本地凭据 fallback；缺少 CredentialEnvelope 时 loud-fail。

#### FR-10.4：Node Admission 与真实容量

Fleet Registry 中的节点只有同时满足以下条件才进入 `ready`：

1. canonical machine ID 与注册表一致；
2. Worker protocol、Runner contract 和 image digest 完全匹配；
3. OrbStack/Docker、Git、Tailscale、callback 网络可用；
4. 磁盘、内存、CPU 压力低于 admission 阈值；
5. 能创建、挂载、销毁隔离 worktree/container；
6. 能接受中央凭据包但不会持久化或回显；
7. 串行 synthetic canary 和节点自检通过。

当前 `7/8/8=23` 仅是资源公式给出的轻量 capacity units。生产接口的 confidence 仍为
`theoretical`，样本量仅 2，不得宣称为三倍 PR 吞吐。Slot 必须改为角色加权：

- Commander/Planner/Reviewer：轻量 unit；
- Proposer：中量 unit；
- Generator/Evaluator/Judge（含测试/构建）：重量 unit；
- 重量任务必须按容器 memory/cpu limit 预留，不能与轻量任务一比一计数。

新节点只有完成至少一条真实开发任务并留下 p50/p95 资源数据后，才可提高重量任务并发。

### FR-11：持久真相与恢复

流程真相只能来自：

- PostgreSQL Run/Attempt/Decision 权威数据，以及可重建的 Event audit/outbox；
- Git commit/branch；
- GitHub PR 和 CI；
- 已落库合同、verdict 和证据。

`initiative_contracts`、`harness_attempts`、`orchestrator_decision_log` 和 GitHub
结构化真相继续是 L0 恢复依据。Commander 所需 Run Event 可以新增事务性
audit/outbox 投影，但不得成为与这些表竞争的第二流程账本：

- 每条投影事件必须带唯一 `source_type/source_id/source_version`；
- 重放不得产生重复事件；
- L0 `derive` 不读取 Commander Memory 或事件摘要决定既有硬门；
- Commander 的 `event_cursor` 只表示已消费到哪个审计事件，不表示流程状态；
- 投影丢失时可以从权威表重建，不能反向覆盖权威表。

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
  primary: { provider: codex, account: team4, model: GPT-5.5, machine: xian-mac-m4 }
  fallbacks:
    - { provider: codex, account: team1, machine: xian-mac-m4 }
    - { provider: claude, account: account1, machine: us-mac-m4 }
roles:
  planner: { provider: codex, account: team2, model: GPT-5.5 }
  proposer: { provider: codex, account: team4, model: GPT-5.5 }
  reviewer: { provider: codex, account: team1, model: GPT-5.5 }
routing:
  preferred_machine: xian-mac-m4
  fallback_machines: [us-mac-m4]
  strict_affinity: false
budget:
  max_usd: 10
  safety_max_hops: 4096
```

`safety_max_hops` 只是防止控制器失控的宽兜底，不是业务轮次上限。它不得先于进展驱动
收敛探测器终止健康 Run；到达兜底只能 `FAILED + 人工升级`，绝不能 PASS 或 merge。
等待 `human_review` 的时间不计入自动化活动 deadline。

Writer 与 Reviewer/Evaluator 必须是不同 Attempt 和 fresh session；默认还应选择不同账号
或 Provider。明确配置同一账号时也不得复用 Session，且必须在 RoutingDecision 中披露
独立性降级。

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
9. 每个 Actor Inbox 有多少 unread/acked/rejected 消息，最长等待多久？
10. 一条 `thread_id` 经历了哪些发送者、Attempt 和设备？

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
  "requested_machine": "xian-mac-m4",
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

### 7.3 ActorMessage

```json
{
  "schema": "harness-actor-message/v1",
  "message_id": "message-uuid",
  "run_id": "run-uuid",
  "sender_role": "commander",
  "recipient_role": "planner",
  "thread_id": "thread-uuid",
  "correlation_id": "directive-or-message-uuid",
  "source_attempt_id": "attempt-uuid",
  "event_cursor": 42,
  "message_type": "question",
  "payload": {},
  "evidence_refs": ["event:41"],
  "dedupe_key": "run:thread:sender:sequence"
}
```

消息消费状态必须通过独立 delivery/ack 投影表达，禁止覆写原始消息；同一
`message_id/dedupe_key` 重放只能产生一条逻辑消息。

### 7.4 事件最小集合

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
- `actor_message.accepted`
- `actor_message.delivered`
- `actor_message.acked`
- `actor_message.rejected`
- `run.phase_changed`
- `run.paused`
- `run.failed`
- `run.completed`

高频 heartbeat 可压缩存储，但最新心跳和过期判定必须可审计。

## 8. 错误处理矩阵

| 故障 | 默认处理 | 是否唤醒 Commander | 是否允许自动换 Provider/机器 |
|---|---|---:|---|
| 单次 Provider 503 | 当前目标最多一次有界恢复重试 | 否 | 同签名再次失败即换账号 |
| 连续 Provider 5xx 达阈值 | 熔断账号；同 Provider 换账号/合法机器 | 已知策略耗尽后是 | 按能力矩阵与 fallback 配置允许 |
| 认证失败/账号熔断 | 禁止继续使用账号 | 是 | 允许换合法账号/Provider |
| Worker health 过期 | 停止新派发 | 是 | 非 strict 可换机器 |
| 显式 `xian-mac-m4` 不可用 | loud-fail 或等待 | 是 | strict 时禁止 |
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
- [ ] Brain Control Plane、Kernel Run Controller、LLM Commander、Role Worker 是四个清晰组件。
- [ ] Brain Control Plane 与 Kernel Run Controller 固定在 US M4；Commander/Role Attempt
  可按能力矩阵跨设备。
- [ ] Fleet Supervisor 不读取或决定 Run 业务策略。
- [ ] `derive.js` 不出现 Claude/Codex/Grok 分支。
- [ ] Provider 专属逻辑只在 Adapter/credential/CLI 边界。
- [ ] 文档、schema 和 API 中不使用无类型限定的 `Controller` 表达运行组件。

### 11.2 Provider 验收

- [ ] 同一 CommanderBundle 可分别由 Claude、Codex、Grok 返回合法 Directive。
- [ ] 三家输出通过相同 schema 校验。
- [ ] Codex Commander 故障后可由 Claude 或 Grok 从持久状态接管。
- [ ] 跨 Provider 接管创建新 Attempt，不伪造 resume。
- [ ] 混合角色组合可运行，例如 Codex Commander + Claude Planner + Grok Reviewer。

### 11.3 跨设备验收

- [ ] `strict_affinity=true + machine=xian-mac-m4` 的真实 Attempt 只在该机器执行。
- [ ] 数据库同时记录 `requested_machine=xian-mac-m4` 与真实 `actual_machine_id`。
- [ ] `team4` 不被用作机器选择依据。
- [ ] Kernel v1 不再因提前本机 return 绕过 Xian 路由。
- [ ] `us-mac-m4`、`xian-mac-m4`、`xian-mac-m1` 使用同一 Runner Contract 版本，并记录可验证的
  multi-arch manifest 或 per-platform runner digest。
- [ ] Worker Docker 健康状态会重新探测，不永久缓存启动时失败。
- [ ] 三台机器均通过同一 Worker API 启动同一 pinned Runner digest；US 本机路径不再有行为特例。
- [ ] 三台机器均由 Worker 创建 Attempt 专属 worktree；固定 checkout 和部署目录不参与执行。
- [ ] `xian-mac-m1` 已具备 OrbStack/Docker，`xian-mac-m4` 不再依赖 GUI LaunchAgent。
- [ ] 每台节点 admission 记录 OS、OrbStack、Worker、Runner、Codex、Node、磁盘和 capacity profile。
- [ ] 任何一项 drift、磁盘低水位或 worktree/container 自检失败都会 drain 节点。
- [ ] team1～team5 只由 US M4 Credential Broker 管理；Xian 节点无长期账号权威状态。
- [ ] 每个 Attempt 只注入所选一个账号，且 callback/日志/DB 均不含认证材料。
- [ ] CredentialEnvelope 缺失、过期、machine/attempt 不匹配时 fail-closed。
- [ ] Worker 修改临时认证副本时只回报 mutation 布尔值，不回传 token。

### 11.4 Commander 全程监控验收

- [ ] Commander 在 Run 启动、每个阶段边界、异常和 Merge 前被唤醒。
- [ ] Commander 可读取该 Run 的完整摘要与增量事件。
- [ ] 普通 heartbeat 不产生无意义 LLM 调用。
- [ ] Commander Session 被杀后，新 Session 能恢复策略摘要和事件游标。
- [ ] Run A 的上下文不会进入 Run B 的 CommanderBundle。
- [ ] 每个逻辑角色拥有独立 Harness Actor Inbox；Attempt 重启或换机后继续原消费游标。
- [ ] Agent 可用 `thread_id` 定向追问/回答，接收方看到未经摘要改写的原消息。
- [ ] Inbox 消息不能直接产生副作用，所有动作仍经过 Kernel Directive 校验。
- [ ] Capture Inbox 与 Harness Actor Inbox 不共表、不共游标。

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
7. Actor Inbox 地址、线程、去重、ack、消息预算与跨 Attempt 游标恢复。
8. WorkspaceSpec schema、SHA/branch/cwd 对抗输入和 read-only/read-write 边界。
9. CredentialEnvelope 的 attempt/machine/expiry 绑定、一次消费和 secret redaction。
10. Node admission 的 Runner drift、磁盘低水位、Docker 不可用和服务版本拒绝。
11. 角色加权 capacity units，不允许把轻量和重量 Attempt 一比一计数。

### 12.2 集成测试

1. Run Event → Commander 唤醒 → Directive → L0 校验 → Attempt 创建。
2. Commander 非法 Directive 被拒绝并回写事件。
3. Codex Commander 503 达阈值 → Claude Commander 接管。
4. `location=xian` + Kernel v1 → 真实 remote launcher，而非 US 本地 Docker。
5. Reviewer 外层只读运行成功且不调用嵌套 read-only sandbox。
6. Kernel/Worker 崩溃后从 DB/Git/PR 重建下一 hop。
7. Commander → Planner 提问 → Planner 回复 → Commander 消费同一线程的完整闭环。
8. Agent 定向消息请求副作用时，Kernel 拒绝非法动作并把原因回送发送者。
9. US M4 Credential Broker → Xian Worker → 容器 tmpfs → Codex → callback 的真调用链。
10. Worker terminal 后容器、worktree、tmpfs 凭据全部销毁；重启后无 token 残留。
11. 同一 Runner digest 在三机执行相同合同 fixture，输出通过同一 schema。
12. 两个 Writer 同时落同一机器时拥有不同 worktree，不能互见未提交文件。
13. remote Attempt 明确指定模型、角色环境和工具策略，Worker 不得回落宿主默认配置。

### 12.3 三机实弹

必须运行一条非核心 canary：

```text
Commander → US M4 / Codex
Planner   → xian-mac-m1 / Codex
Proposer  → xian-mac-m4 / Codex
Reviewer  → US M4 / Grok 或 Claude
Generator → xian-mac-m4 / Codex
Evaluator → xian-mac-m1 / Codex
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
machine=xian-mac-m4
strict_affinity=true
provider=codex
account=team4
model=GPT-5.5
```

任何 Attempt 落到 US M4 都算验收失败，不得以“Provider 正常”替代设备证据。

最后必须进行同题 A/B：

1. 从同一个 base SHA 创建两个隔离分支；
2. 使用同一份小型真实代码任务、同一 Codex 模型、同一合同测试和相同 merge gate；
3. A 路径由 One-session Harness 执行，B 路径由 Kernel Hybrid 执行；
4. 两边都必须真实产生代码 diff、Red→Green、PR、CI 和独立 verdict；
5. 记录总耗时、各角色耗时、Attempt 数、LLM 次数、token、空等时间、人工介入和最终质量；
6. Kernel 未完成 Generator/Evaluator/PR 闭环时，本项目不得宣称可替代 One-session Harness。

## 13. 建议实施分期

### Phase 1：契约与持久状态

- 前置：Phase 0A/0C 已合入并通过独立复审；
- CommanderBundle/Directive schema；
- Run Commander 状态与事件游标；
- Harness Actor Inbox message schema、定向 outbox、actor cursor 与消息预算；
- Directive validator；
- 基于既有权威表的事务性事件 outbox 与可观测字段；
- 不接真实 LLM 副作用。

### Phase 2：Provider-neutral Commander

- 前置：Phase 0B 提供 Provider/account capability snapshot 与确定性 fallback 原语；
- 将 Commander 作为正式 role 接入现有 Provider Registry；
- Claude/Codex/Grok Adapter 合同测试；
- 关键节点唤醒与 event-driven memory；
- Provider 故障接管。

### Phase 3：Attempt 级 Fleet Routing

- 复用 Phase 0B 的 `ExecutionTarget`、canonical machine ID 和健康池；
- Kernel Dispatcher 接机器解析与 Slot reservation；
- 修复 Kernel v1 绕过 `location=xian`；
- Requested/actual machine 证据；
- strict affinity 和非 strict fallback。

2026-07-27 状态：transport、receipt、attestation、watchdog reconcile 已部分落地；不能因
synthetic canary 通过而把 Phase 3/4 标完成。缺口必须由 Phase 4 的统一执行面闭合。

### Phase 4：统一 Runner 与故障闭环

Phase 4 拆成四个独立可回滚交付，不得合成一个大 PR：

#### Phase 4A：Fleet Node Contract 与 admission

- 三台 macOS 的 OrbStack、Worker LaunchDaemon、NodeProfile 和 server baseline；
- pinned Runner digest 和 drift 检查；
- 磁盘/内存/Docker/worktree 自检；
- role-weighted capacity units；
- 新节点 bootstrap/admission/drain 工具。

#### Phase 4B：统一 Worker API 与隔离 Workspace

- US/Xian 统一走 Worker Attempt API；
- WorkspaceSpec 与服务端 Git SHA 对账；
- Bridge-owned per-Attempt worktree/container；
- Reviewer 外层只读；
- terminal/restart/orphan 清理与 quarantine。

#### Phase 4C：中央 Credential Broker

- team1～team5 只在 US M4 管理；
- 每 Attempt 单账号 CredentialEnvelope；
- 容器 tmpfs 注入、一次消费、全链路 redaction；
- 禁止 token writeback；
- 关闭 Xian 本地 `loadRawAuth` fallback。

#### Phase 4D：执行等价与故障闭环

- 三机相同 model、role env、Skills、tool policy、timeout 和 result schema；
- 同机 SessionStore 与跨机 fresh recovery；
- Worker health TTL；
- 统一 failure classification；
- Runner/Worker/Brain 任一重启后的恢复和清理实测。

### Phase 5：Canary 与默认策略

- 三 Provider 合同实测；
- 三机混合 canary；
- Xian strict canary；
- One-session vs Kernel 同题真实 A/B；
- 故障注入；
- 形成是否把 `hybrid` 设为默认的独立决策。

每个 Phase 必须可以单独回滚。不要用一个超大 PR 同时完成五个 Phase。
Phase 0 三个 hotfix 必须保持独立；Phase 4 又明确拆成 4A～4D。PR 数量以可独立
Red→Green、复审、部署和回滚为准，不再设置“最多八个”的人为上限，也不得把多个交付块
压回一个巨型 PR。

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
- `us-mac-m4`、`xian-mac-m4`、`xian-mac-m1` 的细粒度算力调度；
- 每条 Pipeline 的独立上下文和个性化指导；
- 从事件日志可完整解释“谁在什么时候，为什么，把什么任务派到哪台机器”。

这才是“融合”完成，而不是简单地给现有 Kernel 多加一次 LLM 调用。
