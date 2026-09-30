# Sprint PRD — 价值流建模③：workflows 表 + backbone_activities 改挂 workflow_id/executor_kind + ops_workflows.workflow_id

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（active，82%）
- **当前进度**：价值流建模 13 张表方案（决策 3e867cad）已完成第一批 steps/enablers/enabler_calls（迁移 492）
- **本次推进预期**：交付方案第 4-5 张表（workflows + backbone_activities 改挂 + ops_workflows.workflow_id），把「Workflow=某渠道可执行链条」（决策 752b7166）落库

## 背景

决策 3e867cad「价值流建模 13 张表方案」把画布语义拆成可挂探针的实体；决策 752b7166 定义 Workflow = 一个 Capability 在某渠道/形态上的可执行链条，n8n 画布与 cron 脚本降为 Workflow 的运行时实现。当前 `backbone_activities`（= `journey_steps` 视图）的活动直接挂在 `journey_id` 上，无法表达「同一批活动被多个渠道 workflow 共用」；`ops_workflows`（n8n 画布投影）也没有指回 workflows 表。本 sprint 补上 workflows 实体并完成改挂。

## Golden Path（核心场景）

系统/建模者从 [跑迁移] → 经过 [建表 + 改挂 + 灌种子] → 到达 [可查询到 workflow 及其共用活动]

具体：
1. 运行本 sprint 的迁移后，新表 `workflows` 存在，含列 `capability_id` / `channel` / `version` / `status`；schema_version 表新增本迁移记录。
2. `journey_steps`（视图 `backbone_activities`）新增列 `workflow_id`（指向 workflows）、`executor_kind`（取值 `code|agent|human`）、可空 `enabler_id`（Call Activity 指向 enablers 的共用件，允许 NULL）。
3. 灌种子：新建 workflow「抖音·关键词获客」（capability=智能获客，channel=抖音）；智能获客的 8 个骨干活动的 `workflow_id` 改挂到该 workflow。
4. 灌种子：新建第二个 workflow「对标获客」，其中 7 个活动复用（共享）智能获客同名活动，体现「多 workflow 共用活动」。
5. `ops_workflows` 新增可空列 `workflow_id`（指向 workflows），使已入库的 n8n 画布可回指其所属 workflow（此列可空，历史行不强制回填）。
6. 出口可观测：`SELECT` 能查到两个 workflow；「抖音·关键词获客」下挂 8 个活动、每个活动有 `workflow_id` 且 `executor_kind` 合法；「对标获客」共用 7 个活动；`ops_workflows` 已含 `workflow_id` 列。

## 边界情况

- `executor_kind` 只允许 `code|agent|human`，非法值须被 CHECK 约束拒绝（注意：enablers.kind 仅 code|agent，活动层多一个 human）。
- `enabler_id` 可空：不调用共用件的活动此列为 NULL，不得强制。
- 迁移可重复执行（IF NOT EXISTS / ON CONFLICT DO NOTHING），重跑不覆盖后来人改动、不重复灌种子。
- 改挂活动时 `journey_id` 现为 NOT NULL：本 sprint 只新增 `workflow_id` 并回填，不破坏既有 `journey_id` 外键与 `(journey_id, activity_key)` 唯一约束。
- 「对标获客」共用 7 活动指的是同一批 journey_steps 行被第二个 workflow 引用/复用，不得为共用活动重复插入物理副本。

## 范围限定

**在范围内**：新建 `workflows` 表；为 `journey_steps` 加 `workflow_id`/`executor_kind`/可空 `enabler_id`；灌两个 workflow 种子及 8+7 活动改挂；`ops_workflows` 加可空 `workflow_id`。
**不在范围内**：13 表方案其余表（spans/probes/areas.parent_area_id/journeys.kind/task_runs.workflow_id 等）；n8n 画布迁移；旧 golden_path* 退役；Dashboard 展示；selfcheck EXPECTED_SCHEMA_VERSION 调整。

## 假设

- [ASSUMPTION: `capability_id` 指向本仓库既有的能力标识来源（capability_key / golden_paths / system_capabilities 之一），确切外键目标由 proposer 读 api_registry/schema 后确定；PRD 只约束该列存在且非空标识所属 Capability。]
- [ASSUMPTION: 「智能获客 8 活动」= `journey_steps` 中 `capability_key='keyword_acquisition'` 的最新 `backbone_version` 骨干活动，与迁移 492 种子锚点一致。]
- [ASSUMPTION: 「对标获客」channel 与 capability 归属沿用同一 capability，仅 channel/workflow 名不同；具体 channel 值由 proposer 依现有数据确认。]

## 预期受影响文件

- `packages/brain/migrations/493_*.sql`：新建 workflows 表 + ALTER journey_steps（workflow_id/executor_kind/enabler_id）+ ALTER ops_workflows（workflow_id）+ 两 workflow 种子 + 8/7 活动改挂 + schema_version 记录。
- `packages/brain/migrations/rollback/493_*.down.sql`：对应回滚（若本仓库迁移含 rollback 惯例）。
- `packages/brain/src/__tests__/`：新增回归测试，断言表/列/约束存在、两 workflow 及共用活动数正确。
- （只读参考，不改）`packages/brain/migrations/492_steps_enablers.sql`、`482_backbone_activity_contracts.sql`、`436_ops_workflows.sql`、`391_industry_vocab_views.sql`。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task ability_id 为空，返回 0 条）；PrepPRD 未显式给 NFR。 -->
- 超时/延迟：待定（PrepPRD 未指定；schema 迁移为一次性 DDL，无在线延迟要求）
- 频控：无
- 版本要求：迁移编号须单调递增（延续 492 之后为 493），schema_version 表须写入本迁移记录
- 可观测：迁移须幂等；改挂结果须可用 SQL 断言（活动数、workflow 数、列/约束存在）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 本 task journey_id/ability_id 为空，无 line/feature 级铁律；下列为 area 级 DB 建模通用铁律（来源: area），已剔除 capture-triage 噪音。 -->
- [幂等CAS] 迁移与改挂须幂等，重跑不产生重复行、不覆盖后来人改动（来源: area）
- [枚举单源] executor_kind 枚举语义只允许一份定义，消费方共享 import，禁手抄同值副本（来源: area）
- [不破坏既有] 加列/改挂不得破坏 journey_steps 既有 journey_id 外键与唯一约束（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 task 无 journey_id，无法拉 line golden-paths；已完成的迁移 492 三表为同方案前序，仅供不回退参考。 -->
- （本 line 暂无历史；同方案前序迁移 492 已建 steps/enablers/enabler_calls，本 sprint 不得改动其结构）

## E2E 验收

> Planner 初稿留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（psql + curl localhost:5221）。

```bash
# 占位：proposer 将填入 local_api 脚本（跑迁移 → psql 断言）
# 期望验收点（自然语言）：
#  1) 表 workflows 存在，含列 capability_id/channel/version/status；
#  2) journey_steps 含列 workflow_id、executor_kind（CHECK code|agent|human）、可空 enabler_id；
#  3) 存在 workflow「抖音·关键词获客」，其下 8 个 keyword_acquisition 活动 workflow_id 已回填；
#  4) 存在第二个 workflow「对标获客」，共用 7 个同名活动（非物理副本）；
#  5) ops_workflows 含可空列 workflow_id；
#  6) 迁移重跑一次结果不变（幂等）。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 DB schema 迁移与数据建模，无 UI、无远端 agent、无 engine 管道。
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端，E2E 在本地 evaluator 用 psql + curl localhost:5221 验证。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
