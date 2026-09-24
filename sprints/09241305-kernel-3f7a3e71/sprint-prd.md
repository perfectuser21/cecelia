# Sprint PRD — depends_on 脏短 id 不再让整个 tick 崩、零派发

## OKR 对齐

- **对应 KR**：KR2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（消除单条脏任务导致全系统零派发的 P0 故障面）

## 背景

2026-09-24 03:17Z 起每次 tick 报 `Tick failed: invalid input syntax for type uuid: "9b32b2c5"`（Brain 1.317.4 重启后 11 分钟），持续 15+ 分钟零派发，直到手工把任务 d261ff7d 的 `payload.depends_on` 从 `["9b32b2c5"]` 改回完整 uuid。根因：`dispatch-helpers.selectNextDispatchableTask` 的软依赖检查把 `payload.depends_on` 元素直接喂进 `id = ANY($1)`（tasks.id 是 uuid 列），任一脏值让整条 SQL 抛错并冒泡到 tick-loop；tick-loop 只打 `err.message` 无堆栈，排障靠猜。单条脏任务 = 全系统停摆，必须让脏数据只连累它自己。

## Golden Path（核心场景）

系统从 [tick-loop 定时触发派发] → 经过 [遇到含脏短 id 的 depends_on] → 到达 [该脏任务被 block、其它任务正常派发]

具体：
1. tick-loop 触发 `selectNextDispatchableTask`，候选任务中有一条 `payload.depends_on` 含非 uuid 元素（如 `"9b32b2c5"`）。
2. 依赖检查在查询前用 uuid 正则过滤 `depends_on`：合法 uuid 参与已有的依赖满足判断；发现任一非法元素时，写 `task_events`（event_type=`dependency_ref_invalid`，记脏值与任务 id），把该任务 `block`（reason=`dependency_invalid`），并跳过它继续处理下一候选。
3. 可观测结果：tick 不再抛 `invalid input syntax for type uuid`，同轮其它可派发任务照常派发；脏任务落到 blocked 且 `task_events` 有一条 `dependency_ref_invalid` 记录。
4. 写入侧防线：`actions.createTask` / `routes/tasks` PATCH / `relay-baton` 子任务创建三处，若 `depends_on` 含非完整 uuid 直接 400 拒绝（错误信息含违规元素），脏数据不再进库。
5. tick-loop 的 catch 改打 `console.error(err.stack)`，未来同类崩溃有堆栈可定位。
6. 迁移一次性扫描现存 `tasks.payload.depends_on`，把仍含脏短 id 的记录识别出来（记录/清理，不静默丢数据）。

## 边界情况

- `depends_on` 为空数组 / 缺失 / 非数组 → 按现状不做依赖检查，不误 block。
- `depends_on` 混合合法 uuid + 脏元素 → 视为脏，整条 block（不半执行），并记录全部脏值。
- 大小写 / 带前后空格的 uuid → 正则需容忍标准 uuid 格式（8-4-4-4-12 hex），非此格式即判脏。
- 迁移需幂等：重复执行不重复破坏或重复记录同一条。

## 范围限定

**在范围内**：`selectNextDispatchableTask` 软依赖前置正则过滤 + block；三处写入侧 400 校验；tick-loop 打堆栈；一次性脏数据迁移；回归测试。
**不在范围内**：`task_dependencies` 硬边表逻辑（已是 join 不受影响）；depends_on 的语义扩展；dispatcher 其它派发规则。

## 假设

- [ASSUMPTION: uuid 合法性判定用标准 v4/通用 uuid 正则 `^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$`，不校验 version 位。]
- [ASSUMPTION: `task_events` 表已存在且接受自定义 event_type；block 走既有 task block 通道（reason 字段）。]
- [ASSUMPTION: 迁移采用「扫描 + 报告 + 将脏 depends_on 置空或标记」策略，具体清理动作由 proposer 在合同阶段定死；本 PRD 只要求脏数据不再触发 tick 崩。]

## 预期受影响文件

- `packages/brain/src/dispatch-helpers.js`：`selectNextDispatchableTask` 软依赖检查加 uuid 正则前置过滤 + 脏值 block + task_events 记录（约 line 150 区块）。
- `packages/brain/src/tick-loop.js`：catch 分支改 `console.error(err.stack)`（line 104 / 146）。
- `packages/brain/src/actions.js`：`createTask` 校验 `payload.depends_on` 全为完整 uuid。
- `packages/brain/src/routes/tasks.js`：PATCH `/tasks/:task_id`（line 363）校验 depends_on，脏值 400。
- `packages/brain/src/lib/relay-baton.js`：子任务创建时校验 depends_on。
- `packages/brain/migrations/466_*.sql`：一次性扫描/清理现存脏 depends_on。
- `packages/brain/src/__tests__/`：回归测试（脏短 id → tick 不崩 + 任务 block + 其它任务照派；写入侧 400）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空），PrepPRD 未显式指定 -->
- 超时/延迟：待定（PrepPRD 未指定；不得因新增正则/记录显著拖慢单轮 tick）
- 频控：无
- 版本要求：无
- 可观测：脏依赖必须落 `task_events(dependency_ref_invalid)`；tick 崩溃必须打完整堆栈（不可只 err.message）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 两源为空；area 级现存铁律均为 dashboard 三件套类，与本 sprint 无关 -->
- [tick 不可因单条脏数据崩] 单条任务的脏 `depends_on` 只能连累它自己（block 自身），绝不能让整轮 tick 抛错、导致全系统零派发（来源: 本 sprint 事故根因，升级为铁律）
- [脏数据不静默] 非法依赖引用必须留痕（task_events），不可静默丢弃或吞错（来源: 可观测 NFR）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；payload.journey_id 为空，无 line 历史可载 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl + psql）
# 期望验收点（自然语言）：
# 1) 造一条 payload.depends_on=["9b32b2c5"] 的 P0 任务 + 一条正常可派发任务；
# 2) 触发 tick（或跑一轮 loop），确认 tick 不抛 uuid 语法错误、正常任务被派发；
# 3) psql 查该脏任务 status=blocked、blocked_reason=dependency_invalid；
# 4) psql 查 task_events 存在一条 event_type=dependency_ref_invalid（含脏值 9b32b2c5）；
# 5) 写入侧：POST/PATCH 带短 id depends_on 返回 400。
```

## Unified Map

<!-- map_scope=["F1"]，但 task.payload.map_repo 缺失 → Unified Map 未配置，不做领域猜测 -->
- status: not_configured（reason: task.payload.map_repo missing）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain 纯后端（dispatch/tick/写入校验），无 UI/远端 agent/engine。
## target_environment: local_api
## target_environment_reason: 验收在本地 evaluator 用 curl localhost:5221 + psql 验证 tick 不崩、任务 block、task_events 落库。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
