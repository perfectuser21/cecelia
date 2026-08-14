# Cecelia 统一 Work Router 设计

状态：用户已批准进入 Kernel Harness 实施（2026-08-12）

日期：2026-08-12

范围：Brain 任务入口、顶层工作流路由、Harness 强制接入、Universal Map 启动门禁

不包含：本文件不授权实现，不改变生产数据，不改变现有运行中任务

## 1. 结论

Cecelia 应在所有工作入口与现有 Task Router/Dispatcher 之间增加唯一的顶层 `Work Router`。

所有可能修改代码仓库的工作统一规范化为 `coding_mutation`，并在入队前转换成 `harness_initiative`。`dev` 不再是可独立执行的 coding 入口。Harness 在开始规划前必须读取 Universal Map、验证事实快照新鲜度并建立 Impact Contract；任何一步无法成立时都失败关闭，不得降级为直接开发。

现有 `task-router.js` 保留为二级执行路由器，只负责将已经规范化的内部任务类型映射到 skill、location、executor 和 execution mode，不再决定顶层工作流。

Dispatcher 增加最终安全闸：任何声明或推导为仓库写入、但没有有效 Harness 路由凭证的任务，一律拒绝执行并记录路由违规事件。

本设计以两项 active decision 为规范依据：`29ae54ae-d91a-476f-8192-4f1203758943` 定义 Coding 的四档 `change_kind` 与默认执行形态；`c3617bdf-052a-4180-9bea-9d7417379c44` 要求有头、无头 coding 共用同一闸门，并退役 one-session skill-relay Harness 1.0。本设计显式取代旧 A/B/C 路由条令中“Harness 只服务 C 类”的分工；旧条令中与此无冲突的内容不受影响。发生口径冲突时，以这两项决策和本设计为准。

## 2. 问题陈述

当前系统已经拥有这些局部能力：

- Inbox 负责接收和保存输入。
- 丘脑/Intent 能识别宽泛领域。
- `task-router.js` 能把已确定的 `task_type` 映射到 skill 和执行位置。
- Dispatcher 能按照 `task_type` 分发任务。
- `harness_initiative` 已经是完整 Harness 图入口。
- Planner、Structure Gate、Diff Gate 和 merge fence 已能消费 Map/Impact Contract。
- Universal Map 已能自动扫描仓库事实、确定性投影并在查询时计算新鲜度。

缺失的是一个覆盖所有入口、负责选择顶层工作流并强制执行的统一机制。当前分类、创建和执行分散在多条路径中，`domain=coding` 不等于强制进入 Harness，部分 coding 任务仍能以 `dev` 直接派发。

生产数据快照也证明当前不是强制接入：现有 `initiative_runs` 主要处于 `legacy_exempt`，没有活跃 Impact Contract，任务 payload 中也没有形成普遍的 Map 绑定。

因此，Universal Map 当前既是可视化产品，也是可供部分 Harness 环节读取的治理能力，但还不是每次 coding Golden Path 的必经依赖。

## 3. 目标

### 3.1 顶层路由唯一

Inbox、对话、Brain API、丘脑、自动发现、定时任务和子任务派生必须通过同一个 Work Router 选择顶层 Pipeline。

### 3.2 Coding 写入统一进入 Harness

凡是可能修改以下任一对象的任务，均属于 `coding_mutation`：

- 源代码
- 测试代码或测试夹具
- 配置文件
- 数据库迁移
- CI/CD 配置
- 部署、运维或仓库脚本
- 依赖声明与 lockfile
- 受版本控制的文档或资源文件

`coding_mutation` 的唯一顶层执行入口是 `harness_initiative`。

### 3.3 Map 成为运行时治理输入

Harness 必须在计划和编码前读取目标 repo 的 Universal Map，并用它形成 Impact Contract。Map 不是登记表，不要求每天人工维护；它由仓库事实自动刷新，由查询时状态计算判断能否用于本次运行。

### 3.4 路由可解释、可审计、不可绕过

每个顶层任务都必须保存路由凭证，回答：它是什么工作、为什么走这条 Pipeline、目标 repo 是什么、绑定了哪个 Map 范围、由哪个路由器版本作出决定。

## 4. 非目标

- 不把当前 70 个 `task_type` 重构成 70 个平级顶层入口。数量来自 `task-router.js` 导出的 `VALID_TASK_TYPES`，实施和验收必须从该单一事实源实时计数，不能复制成第二份常量。
- 不要求纯只读代码审查启动完整 Harness。
- 不把内容创作塞进 Coding Harness。
- 不使用数据库 trigger 完成自然语言或工作语义分类。
- 不在本项目中重写 Harness 内部状态机。
- 不增加人工逐项登记 Map 数据的流程。

## 5. 方案比较

### 5.1 推荐：创建时统一路由 + Dispatcher 安全闸

Work Router 在任务入队前完成分类、规范化、Map 绑定和路由凭证生成。Dispatcher 只验证凭证和不可绕过不变量。

优点：语义信息完整、错误出现得早、所有入口得到一致结果、可解释、可渐进迁移。Dispatcher 安全闸还能捕获漏接入口。

代价：必须梳理全部任务创建入口，并把直接 INSERT 或局部创建逻辑收敛到统一边界。

### 5.2 不采用：仅在 Dispatcher 强制转换

Dispatcher 发现 `dev` 时临时改成 `harness_initiative`。

问题：介入太晚，任务通常已经丢失原始意图、repo、Map scope 和路由理由；执行时转换也会让排队语义与实际运行语义不一致。

### 5.3 不采用：数据库 trigger/constraint 负责路由

数据库拒绝或转换 coding 类型。

问题：数据库无法可靠判断自然语言工作的写入意图，错误难解释，规则难版本化，也不适合解析 repo 和 Map scope。数据库只适合保存结果和提供简单完整性约束。

## 6. 总体架构

```text
Inbox / Conversation / Brain API / Thalamus / Discovery / Scheduler / Child Spawn
                                  │
                                  ▼
                    Normalize Work Request
                                  │
                                  ▼
                        Unified Work Router
                                  │
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
      Coding Mutation       Content Creation      Read-only / Ops
             │                    │                    │
             ▼                    ▼                    ▼
     Harness Initiative     Content Pipeline      Dedicated Pipeline
             │
             ▼
 Repo Resolve → Map Freshness → Impact Contract → Structure Gate
             → Plan → Generate → Evaluate → Diff Gate → CI
             → Merge Fence → Deploy → Real Acceptance
```

当前 70 个 `task_type` 继续存在，但被明确划分为：

1. 顶层业务入口类型。
2. Pipeline 内部阶段类型。
3. 系统维护类型。
4. 兼容或退役类型。

外部入口只能创建少量规范化顶层类型；内部阶段只能由所属 Pipeline 派生。

## 7. 组件边界

### 7.1 Work Request Normalizer

职责：把不同入口的数据转换成统一输入，不作最终路由决定。

依赖：入口原始字段、认证上下文、来源信息。

输出：`NormalizedWorkRequest`。

### 7.2 Work Classifier

职责：确定 `work_kind` 与 `mutation_intent`。优先使用结构化显式字段，再使用来源合同和任务类型规则，最后才使用丘脑语义分类。

分类结果必须包含理由和证据，不允许只有一个不可解释标签。

### 7.3 Repo Resolver

职责：把 repo id、repo path、来源项目和显式 payload 解析成 Map 中的规范 repo key。

禁止用当前进程工作目录作为隐式生产默认值。无法唯一解析 repo 的 `coding_mutation` 失败关闭。

### 7.4 Pipeline Selector

职责：先把 `work_kind` 映射到唯一顶层 Pipeline 和 canonical task type；当结果是 `coding_mutation` 时，再根据显式 `change_kind` 选择默认执行形态。

核心映射：

| work_kind | pipeline | canonical_task_type |
|---|---|---|
| `coding_mutation` | `harness` | `harness_initiative` |
| `coding_review` | `code_review` | 既有只读审查入口 |
| `content_creation` | `content` | 既有内容顶层入口 |
| `research` | `research` | 既有研究入口 |
| `operations` | `operations` | 对应受控运维入口 |

只读审查一旦给出需要修改仓库的结论，必须创建新的 `coding_mutation` 子任务，不得由只读任务原地取得写权限。

`coding_mutation` 只有以下四种 `change_kind`，不存在第五个形式：

| change_kind | 默认执行形态 | 默认人工审核 |
|---|---|---|
| `new_capability` | 完整 Planner + GAN 对抗 + Contract + Generate + Evaluate + Judge | 需要 |
| `capability_change` | 轻量 Planner，不做 GAN，对 Contract 直接收敛，再 Generate + Evaluate + Judge | 需要 |
| `bugfix` | hotfix 档，跳过 Planner/GAN，直接 Generate + Evaluate + Judge | 不需要 |
| `parameter_only` | 最轻档，跳过 Planner/GAN，但保留 Generate + Evaluate + Judge，尤其不得省略 Evaluator | 不需要 |

这张表是 `change_kind → default_execution_profile` 的单向默认映射。调用方可以通过有审计证据的显式 override 升档，例如增加 GAN 或人工审核；不得降掉所属档位的必需 Gate，也不得从 gear、task type、当前 stage 或实际走过的路径反向推导、改写 `change_kind`。四档共用同一个 Kernel Harness 2.0、Routing Receipt、Map/Impact Contract、Evaluator、Judge 和 merge fence，区别只在默认阶段组合，不是四套执行系统。

### 7.5 Routing Receipt Writer

职责：生成不可变的路由凭证并与顶层任务原子写入。

### 7.6 Dispatcher Route Guard

职责：在 claim 后、调用 executor 前验证：

- 路由凭证存在且版本受支持。
- canonical task type 与 pipeline 一致。
- 写入意图只能走 Harness。
- Harness 所需 repo、Map 和 Impact Contract 标志完整。

校验失败时释放执行资源，将任务置为明确的阻塞/失败状态并记录 `route_violation`，不自动降级。

## 8. 数据契约

### 8.1 NormalizedWorkRequest

字段：`source`、`source_id`、`title`、`description`、`requested_task_type`、`declared_change_kind`、`execution_profile_override_request`、`declared_domain`、`mutation_intent`、`repo_hint`、`map_scope_hint`、`parent_task_id`、`metadata`。`source` 枚举为 `inbox|conversation|api|thalamus|discovery|scheduler|child`；`mutation_intent` 枚举为 `write|read_only|none|unknown`；`declared_change_kind` 只能使用四形式。

`source`、`source_id`、`title` 和 `mutation_intent` 为必填。对未能确定写入可能性的 coding 工作，`unknown` 按 `write` 处理，避免漏进 Harness；其余字段可空，但不能注入未知枚举。

### 8.2 RouteDecision

字段：`work_kind`、`change_kind`、`pipeline`、`canonical_task_type`、`default_execution_profile`、`execution_profile_override`、`repo`、`map_scope`、`impact_contract_required`、`orchestrator`、`router_version`、`route_reason`、`evidence`、`decided_at`。例如 `coding_mutation/capability_change` 必须得到 `harness/harness_initiative/capability-change-v1`，`impact_contract_required=true`；`decided_at` 使用 RFC3339。

### 8.3 Routing Receipt

Routing Receipt 是 `RouteDecision` 的持久化表示，必须写入专用表 `work_routing_receipts` 并由 task id 外键关联，以获得不可变性、索引能力和独立审计。任务 payload 只保存 `routing_receipt_id` 与执行所需投影，不作为路由事实源。

`work_routing_receipts` 至少包含：`id`、`task_id`、`source`、`source_id`、`work_kind`、`change_kind`、`pipeline`、`canonical_task_type`、`default_execution_profile`、`execution_profile_override`、`repo`、`map_scope`、`impact_contract_required`、`orchestrator`、`router_version`、`route_reason`、`evidence`、`supersedes_receipt_id`、`created_at`。非 coding receipt 的 `change_kind` 与执行 profile 为空；除新增后继 receipt 外，不提供 UPDATE 路径。

Routing Receipt 创建后不可覆盖。重路由必须新增 receipt，并通过 `supersedes_receipt_id` 形成历史链。

## 9. 路由优先级与确定性

Work Router 按以下优先级决策：

1. 受信任调用方给出的结构化 `mutation_intent`。
2. 任务来源合同，例如“修复”“实现”“迁移”类自动任务固定为写入。
3. 已登记的 task type 分类表。
4. 丘脑对自然语言的语义分类。
5. 无法确定时的安全默认值。

安全默认值：只要工作属于 coding 且无法排除仓库写入，就路由为 `coding_mutation`。无法确定 repo 时阻塞在路由阶段，不得默认绑定 Cecelia。

同一 `NormalizedWorkRequest` 和同一规则版本必须产生相同 RouteDecision。LLM 分类结果必须被收敛成枚举并保存证据，不能让后续阶段重新解释原始自然语言。

`change_kind` 必须由 Work Router 在 Harness 启动前正向确定并写进 Routing Receipt。Kernel 只能读取它选择默认 profile；不得根据“是否跑了 Planner/GAN”、gear 或历史 task type 反推 `change_kind`。

## 10. Coding Golden Path

`coding_mutation` 四种形式共用的固定启动链：

1. Work Router 生成 `harness_initiative` 和 Routing Receipt。
2. Harness 校验 repo 绑定。
3. 查询目标 repo 的 Universal Map metadata。
4. 要求相关事实快照状态为 `fresh`，revision 与目标工作基线一致。
5. 根据任务意图和 Map 选择候选 capability、边界与横切件。
6. 生成或确认 Impact Contract。
7. Structure Gate 验证计划范围。
8. 按 `change_kind` 的默认执行形态运行对应 Planner/GAN 阶段，然后实现和测试。
9. Diff Gate 将真实 diff 与 Impact Contract 对比。
10. CI、merge fence、部署和真实产出验收。

以下情况必须失败关闭：

- repo 未知或不唯一。
- repo 没有可查询的 Map。
- Map metadata 缺失。
- 快照过期、revision 非法、scanner version 非法。
- 不能建立 Impact Contract。
- 计划或真实 diff 超出合同且没有经过显式合同修订。

失败关闭不等于任务永久失败。修复事实快照或补全 repo 信息后，可以通过新增 Routing Receipt 或 Harness resume 继续，但不能改写历史凭证。

### 10.1 Map/scanner bootstrap 恢复通道

Map、scanner 或 projection engine 自身发生故障时，普通 coding preflight 可能无法建立 fresh Map。为避免 fail-closed 造成系统无法修复自己的死锁，Kernel 提供窄化的 `map_recovery` bootstrap 模式。它不是绕过 Harness，也不得产生 `legacy_exempt`：

- 仅接受 `work_kind=coding_mutation`、`change_kind=bugfix`，且真实 diff 只能命中冻结的 Map/scanner/projection allowlist。
- 仍须先生成 Routing Receipt；另以不可变 `map_recovery_contract` 绑定 receipt、唯一 `task_id`、repo、branch、base SHA、故障 `reason_code`、过期时间和恢复授权证据。恢复合同只能被一个 Harness attempt 消费。
- 仅当 preflight 得到 `map_unavailable`、`scanner_unavailable` 或 `projection_unavailable` 等稳定原因码时可启用；不能由调用方自由声明。
- Impact Contract 由 last-known-good Manifest/快照与固定恢复边界生成最小合同，仍为 `required`；Structure/Diff Gate、frozen-baseline、Generator 隔离、Evaluator、Judge、CI 和 merge fence 全部保留。
- 不允许 `new_capability`、`capability_change`、`parameter_only`，不允许顺带修改业务 capability，也不允许默认选择 Cecelia repo。
- 修复完成后必须重跑目标 repo 全部 scanner，确认新 revision 的 Map 为 fresh 且真实查询通过，才能关闭任务；失败的恢复凭证不可复用。

bootstrap 是专门的自修复合同，不是通用 escape hatch。正常 Map 可用时，Work Router 必须拒绝创建 `map_recovery` receipt。

## 11. Content 与其他 Pipeline

内容创作进入 Content Pipeline，由该 Pipeline 自行拆分选题、研究、撰写、审核、素材和发布等内部任务。内部某一步如果确实要改代码，例如修改内容生成器，则派生新的 `coding_mutation`，原内容任务保持自己的工作流身份。

Research、Operations 和 Communication 同理：顶层工作流不因偶发技术内容而变成 Harness；只有真实仓库写入形成独立 Harness 子任务。

## 12. 所有入口的收敛要求

下列入口不得再直接决定最终 `task_type` 后 INSERT：

- Brain 创建任务 API。
- Intent/自然语言解析创建路径。
- Capture triage 创建路径。
- Actions 中的任务创建 helper。
- 自动修复、巡检、回调和任务生成器。
- Pipeline 内的子任务创建。
- Scheduler 创建的业务任务。

统一写入边界应提供一个事务级 `createRoutedTask()`。入口只提交 NormalizedWorkRequest；该函数负责路由、凭证和任务的原子落库。

现状考古已识别 33 处建任务入口；Knife 0 必须把这 33 处逐项冻结为机器可检索清单，并以主线实际结果校正增减，Knife 2 的完成标准是清单中每一处都有入口合同。Inbox 的 capture-triage 与 Thalamus 当前存在重复岗哨；两者都只能提供证据并调用同一个 Work Router，不得各自保留最终分类逻辑，更不能让 Work Router 变成第三套分类器。

有头交互开发与无头任务使用同一张 Routing Receipt、同一四形式和同一 Harness Gate。有头 `/dev` 创建或补齐 `.dev-lock.<branch>` 时，必须把 `task_id`、`routing_receipt_id`、`run_id`、repo、branch 和 base SHA 写入 lock；`packages/engine/hooks/dev-mode-tool-guard.sh` 在任何 mutation-capable tool 动作发生前，通过受认证 Brain API 验证 receipt 存在、未 supersede/过期，并确认其 task/repo 与 active run/attempt、lock、当前 worktree 和 HEAD 基线完全一致。缺失、API 不可达或任一字段不匹配时 exit 2 阻断；只读诊断工具仍可用于恢复。

动作闸不以“存在 dev light”为充分条件：在受管 Git repo 内，mutation-capable tool 没有 live `/dev` session、`.dev-lock` 或有效 receipt 同样必须阻断。Engine 维护版本化的 mutation-capable tool 合同；Edit/Write 类始终属于写入，Bash 按命令合同判定，无法证明只读的未知工具按写入处理。

动作期 hook 是主闸。Dispatcher guard、CI 和 merge fence 是纵深防御与漏网兜底，不能被描述成正常路由的首个强制点，也不能用“CI 最终会拦”来放行未路由的本地写入。hook 只验证创建期决定，不得根据用户正在调用的工具反向决定 `change_kind`。

仅数据库迁移、恢复工具和经过明确 allowlist 的系统维护路径可以绕开该函数，且它们不得创建可由 Dispatcher 执行的普通业务任务。

## 13. 兼容与迁移

### 13.1 新任务

功能启用后，新 `coding_mutation` 立即强制进入 Harness。不得再创建可直接执行的 coding `dev`。

### 13.2 未开始的旧任务

对 `queued`、`blocked`、`paused` 且具有 coding 写入语义的旧任务执行一次性 dry-run 审计，再批量重新路由：

- 保留原 task id 与原始 payload。
- 新增 Routing Receipt。
- canonical type 改为 `harness_initiative`。
- 无法解析 repo 的任务进入明确阻塞状态。

### 13.3 正在运行的旧任务

不在中途更换执行模型。记录 `legacy_execution_audit`，允许当前 attempt 收口；后续重试、修复或派生任务必须走新路由。

### 13.4 `dev` 的生命周期

第一阶段保留 `dev` 用于读取历史记录、兼容旧回调以及承载既有 Harness 内部阶段，但禁止外部入口新建，也禁止把它作为顶层 coding 工作直接派发。未来是否重命名 Harness 内部阶段不属于本设计范围。

one-session skill-relay Harness 1.0 不得作为“四档中较轻的一档”继续存在；它进入明确退役迁移，只允许已有 attempt 收口。所有新有头/无头 coding 统一进入 Kernel Harness 2.0。

## 14. 可观测性

至少提供以下事件和指标：

- `work_routed`
- `work_route_blocked`
- `route_violation`
- `legacy_task_rerouted`
- `map_preflight_failed`
- `impact_contract_created`
- `impact_contract_revised`

核心指标：

- coding mutation 的 Harness 覆盖率，目标 100%。
- 无 Routing Receipt 的新业务任务数，目标 0。
- coding `dev` 直接派发数，目标 0。
- Harness 启动时 Map 查询率，目标 100%。
- `legacy_exempt` 新增量，目标 0。
- 有头 mutation-capable tool 在动作前完成有效 receipt 校验的覆盖率，目标 100%。
- 四档 `change_kind` 的默认 profile 命中率、显式升档率与非法反向推导数，后者目标 0。
- `map_recovery` 创建、拒绝、到期和恢复后全量重扫结果。
- 按入口统计的路由失败率和原因。

Dashboard 应能展示任务的 work kind、Pipeline、repo、Map 状态、Impact Contract、route reason 和阻塞 Gate。该展示是审计视图，不是路由事实源。

## 15. 安全与错误处理

- 所有路由枚举执行严格校验，未知值不透传给 Dispatcher。
- Work Router 与任务写入在同一事务内，避免有任务无凭证。
- 路由重试通过 `source + source_id + router_version` 幂等。
- Map 不可用时不得以 `legacy_exempt` 继续；只有满足 §10.1 全部条件的 `map_recovery` 最小合同可以自修复。
- Dispatcher 不允许通过修改 payload 绕开专用 Routing Receipt。
- 有头交互开发不得通过缺失/伪造 `.dev-lock`、离线 Brain API 或换 worktree 绕过动作期 receipt 闸门。
- Generator Provider 不持有 push 或 Brain callback 能力；它只产出本地 commit/artifact，获批 ref 由 Judge/merge fence 之后的受信任 Harness transport 发布。
- 路由错误必须返回稳定 `reason_code`，不得只保存自由文本。
- 不自动选择生产数据库或默认 repo。
- 旧任务迁移先 dry-run 并输出数量、分类、repo 解析率和阻塞清单，再执行真实更新。

## 16. 测试策略

实现必须遵循 TDD，先提交能证明当前绕过问题的失败测试，再实现。

### 16.1 单元合同

- 每种 `work_kind` 的确定性分类。
- write/read-only 边界。
- repo 解析与歧义失败。
- RouteDecision schema。
- 同输入同版本产生同结果。
- coding unknown 按 write 处理。
- 四个 `change_kind` 到默认执行形态的正向映射。
- 显式升档可用，降档和 gear/stage/task type 反向推导均被拒绝。

### 16.2 入口合同

对每个任务创建入口验证：

- coding mutation 最终均为 `harness_initiative`。
- content 不误入 Harness。
- review 产生修复时派生 Harness 子任务。
- 任务与 Routing Receipt 原子创建。
- 已冻结的 33 处入口逐项覆盖，不用汇总数量代替逐项证据。
- capture-triage 与 Thalamus 委托同一 Work Router，结果不发生双重改写。

### 16.3 有头动作闸

- `.dev-lock.<branch>` 缺 task、receipt、run、repo、branch 或 base SHA 时，mutation-capable tool 在动作前被拒绝；没有 live `/dev` session 或 lock 也不得放行。
- receipt 缺失、过期、已 supersede、Brain API 不可达、worktree/HEAD 不匹配时 fail closed。
- 合法 receipt 的有头 coding 正常执行，且与等价无头请求得到相同 `change_kind` 和 profile。
- 只读诊断不被误伤；CI/merge fence 仍能兜底捕获伪造或漏接。

### 16.4 Dispatcher 回归

- coding `dev` 无凭证时拒绝执行。
- 伪造 payload 不能绕过凭证检查。
- 合法 Harness 凭证照常执行。
- 既有非 coding 系统任务不被误伤。

### 16.5 Map/Harness 集成

使用真实测试数据库和真实临时 Git repo 验证：

- fresh Map 允许 Harness 进入 Structure Gate。
- stale、missing、invalid revision、invalid scanner 全部失败关闭。
- repo A 的任务不会读取 repo B 的事实。
- Impact Contract 与真实 diff 的越界能被 Diff Gate 阻止。
- `impact_contract_policy` 对所有新 coding run 必为 `required`。
- 所有 Generator run 都武装 frozen-baseline pre-push 与退出后 lineage assertion。
- Generator 与 Evaluator 一样具备 pushurl 熔断、`setpriv` 身份降权和 `env -u HARNESS_CALLBACK_TOKEN`；容器内 hook 路径真实存在并生效。
- Map 故障时普通任务失败关闭；合法 `map_recovery` 只能修改 allowlist，修复后全量重扫恢复 fresh；非法或过期恢复请求被拒绝。

### 16.6 真实验收

在 scratch 环境从至少三个真实入口各创建一项 coding mutation，并查询数据库确认：

- 三项均有 Routing Receipt。
- 三项均成为 Harness Initiative。
- 三项均查询正确 repo 的 Map。
- 三项均建立 Impact Contract。
- 人为制造 stale Map 后任务不能进入编码阶段。
- 刷新 Map 后同一任务可恢复，并保留原失败审计。
- 新建 coding `dev` 直接派发计数为 0。

同时创建 content、read-only review 和 research 对照任务，证明它们进入各自 Pipeline；review 派生的真实修复任务必须进入 Harness。

## 17. 发布策略

1. 影子模式：Work Router 只计算并记录决策，与现有结果比较，不改变派发。
2. 入口强制：所有新任务通过 `createRoutedTask()`，Dispatcher 仍只告警。
3. 动作期强制：有头由 `dev-mode-tool-guard` 在 mutation-capable tool 前验证 lock/receipt，无头由 Dispatcher 在 executor 前验证 receipt；两者是各自路径的主闸。
4. 纵深兜底：CI/merge fence 拒绝漏接、伪造或不一致的 coding 结果，不承担正常路径的首次路由。
5. 旧队列迁移：执行审计过的批量重路由。
6. 兼容收口：停止新增 `legacy_exempt`，移除 coding `dev` 顶层入口并退役 Harness 1.0。

每一阶段都必须满足：无新增未路由任务、错误率在验收阈值内、可回滚到上一阶段的执行开关。回滚只影响新路由启用状态，不删除 Routing Receipt 或审计历史。

## 18. 实施切片建议

### Knife 0：路由合同与事实基线

冻结 work kind、四档 `change_kind`、默认执行形态、RouteDecision、Routing Receipt 和 task type 分类；从 `VALID_TASK_TYPES` 验证当前为 70 且无重复，冻结并逐项复核现状考古识别的 33 处创建入口与直接 `dev` 派发基线。

Knife 0 必须用 failing regression 点名三个已验证陷阱，不能在后续重构中静默带过：`packages/brain/src/planner.js:1203` 附近的 tasks INSERT 缺 `task_type` 列；`packages/brain/src/proposal.js` 把 `change.skill` 当作 `task_type`；`packages/brain/src/routes/capture-atoms.js` 的 decision 分支向 `decisions` 写入 schema 不存在的 `title`、`description`、`area_id` 列。

### Knife 1：统一创建边界

实现纯函数路由核心和事务级 `createRoutedTask()`，先接 Brain API、Intent 和 Capture 三个主要入口。

### Knife 2：全入口收敛

接入自动修复、巡检、回调、子任务和 Scheduler，禁止业务路径直接创建可执行任务。

### Knife 3：Harness + Map 强制启动门禁

让每个 coding Harness 在计划前完成 repo、Map freshness 和 Impact Contract 检查，实现 §10.1 bootstrap 恢复合同，并在 `packages/brain/src/orchestrator/kernel-run-store.js:438` 附近将所有新 coding run 的 `impact_contract_policy` 翻为 `required`，不再由 payload opt-in，也不新增 `legacy_exempt`。

将 `docker/cecelia-runner/entrypoint.sh:873-1000` 已有 frozen-baseline pre-push + 退出后 lineage assertion 推广到全部 Generator run；不能只在特定任务 flag 下生效。把 Evaluator 的三件隔离措施完整复制给 Generator：`remote.origin.pushurl` 熔断、`setpriv` 非特权 UID/capability 清空、Provider 环境 `env -u HARNESS_CALLBACK_TOKEN`（并移除同级 Brain/lease 凭据）。所有 Git hook 路径必须使用容器内真实可达路径并以容器集成测试证明生效。

### Knife 4：有头动作闸 + Dispatcher 安全闸

扩展 `.dev-lock` 合同和 `dev-mode-tool-guard`，让有头开发在 mutation-capable tool 动作前验证有效 Routing Receipt；同时拒绝无凭证或路由不一致的无头 coding 写入任务，建立 route violation 观测。CI 与 merge fence 只作为二次兜底。Knife 4 还必须证明 Generator 三件隔离在实际容器命令链中没有因 host 路径、环境继承或 UID 切换失效。

### Knife 5：旧任务迁移与真实验收

先 dry-run，再迁移未开始任务；完成 scratch 多入口端到端验收和生产只读观测。

## 19. 架构审核清单

审核者应明确给出 PASS、NEEDS_REVISION 或 BLOCK，并逐项检查：

1. Work Router 是否真正覆盖所有任务创建入口，而非新增第三套路由。
2. `coding_mutation` 的定义是否覆盖所有仓库写入，又没有把纯只读审查强行塞入 Harness。
3. `dev` 是否被禁止作为新的独立 coding 执行入口。
4. 四档 `change_kind` 是否穷尽 Coding 形式、只做正向默认映射且禁止反向推导；Harness 1.0 是否明确退役。
5. Routing Receipt 是否不可变、可版本化、可追溯。
6. 有头动作期主闸是否验证 `.dev-lock` 与 receipt，Dispatcher/CI/merge fence 是否保持纵深兜底。
7. Dispatcher 是否能阻止任何漏接入口绕过 Harness。
8. Universal Map 是否成为每次 Harness 启动的真实依赖，而非只用于页面展示。
9. Map/Impact Contract 不可用时是否失败关闭，bootstrap 是否足够窄且能完成自修复闭环。
10. 多 repo 是否显式解析并隔离，是否避免默认污染 Cecelia。
11. content、research、operations 是否保持独立 Pipeline，并能正确派生 coding 子任务。
12. 旧任务迁移是否保留历史并避免中途改变运行中 attempt。
13. Kernel L2 的 Impact Contract、frozen baseline、Generator 隔离三件套和容器 hook 路径是否全部接线。
14. 测试是否包含真实 PostgreSQL、真实 Git repo、并发/幂等与真实产出验证。
15. 分阶段发布是否能观测、能停止扩散且不删除审计证据。

## 20. 审核后进入实施的条件

只有在本设计获得用户与架构审核者明确批准后，才进入 `/dev` 实施计划。实施计划必须逐 Knife 列出允许修改文件、RED/GREEN 测试、DevGate、数据库隔离、真实验收命令和 PR/CI 收口要求。
