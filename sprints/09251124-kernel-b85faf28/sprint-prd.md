# Sprint PRD — 接力棒 project 根推 Notion Projects 库：缺列/类型一致性闸（relay-projection ensureProps 补列 + proven-to-fire smoke）

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（active，82%）
- **当前进度**：82%
- **本次推进预期**：+1%（接力棒 project 投影从静默停更恢复为可信可观测）

## 背景

2026-09-25 11:19 建 project 根 `bf5088a3` 后，Brain 日志出现
`[relay-projection] project bf5088a3 推送失败: Notion PATCH /pages/…​ → 400: Status is expected to be select. AI Project / Run ID / Remark is not a property that exists`。
根因与 09-08 Notion 缺列三连坑同类：投影代码 `buildProjectProps` 发的列（`Status` 发成 `status` 类型、`AI Project` / `Run ID` / `Remark` 三列）在目标「Projects」库（`d83c40c2-ba63-8323-8dc7-01cc291c4d9b`）不存在或类型不符，被 `pushProjectRoots` 逐行 `catch` 吞掉后静默停更。ops-notion-schema 早已沉淀「复用已有库须幂等补列 + 一致性 smoke」机制（`ensureProps` / `diffMissingProps` / `ops-notion-schema-smoke.sh`），本 sprint 把同一机制接进 relay-projection。

## Golden Path（核心场景）

系统从 [Brain tick 投影] → 经过 [推前幂等补列 + 类型对齐] → 到达 [Projects 库出现完整一页]

具体：
1. [触发] Brain tick 周期调 `runRelayProjection` → `pushProjectRoots` 遍历 `task_type='project'` 根。
2. [补列] 推每页前，relay-projection 用**集中定义的列清单**对 Projects 库跑 `ensureProps`（复用 ops-notion-schema 幂等补列机制）：目标库缺 `AI Project` / `Run ID` / `Remark` 时幂等 PATCH 补上；已存在的列不重发（不冲掉主理人手改的配置）。
3. [类型对齐] `Status` 按目标库真实类型 `select` 发送（与库定义一致），不再发 `status` 类型。
4. [出口] 对根 `bf5088a3` 的 PATCH/POST 返回 **200**；Projects 库该页正文出现四块：**目标 / 链 / 待拍板 / 最近交接**（即任务描述的 目标/链/日志/待拍板）。
5. [闸] 一致性 smoke：投影代码 emit 的每个列必须在集中列定义里存在、且类型匹配（`Status`=select）；缺列或类型不符时 smoke **红**（proven-to-fire），阻断上线。

## 边界情况

- 目标库已有全部列 → `ensureProps` 检测无缺列、跳过，不发多余 PATCH（幂等）。
- `Status` 列已是 select 且存在 → 补列不改已存在列类型；类型一致由 emit 端保证发 select。
- Notion token 缺失 → `runRelayProjection` 静默返回 `no_token`，不报错、不误判成功。
- 页被删（404）→ 沿用既有重建逻辑，补列在重建路径同样先行。
- 逐行 catch 仍保留，但**失败必须计数/可观测**，不得再出现「吞 400 静默停更两天」。

## 范围限定

**在范围内**：
- relay-projection 推送前对 Projects 库（及待拍板决策 inlet 库）幂等补列 + `Status` 类型对齐。
- Projects/Decisions-inlet 列定义**集中**成单一 source（对齐 `OPS_DB_PROPS` 模式）。
- 新增一致性 smoke（emit 列 ⊆ 集中定义 且类型匹配，proven-to-fire）。
- 先写能复现 400/缺列的 failing test，修复后永久留 CI。

**不在范围内**：
- 不改 Notion 库的人工列语义 / 正文四块结构。
- 不动 legacy `notion-push-sync` 的 ops 四库推送逻辑（仅复用其机制）。
- 不改 tick 调度频率、指纹去重策略。

## 假设

- [ASSUMPTION: 目标「Projects」库的 `Status` 列真实类型为 `select`（来自 400 报文 "Status is expected to be select"）；`AI Project`/`Run ID`/`Remark` 三列当前不存在，需补列。]
- [ASSUMPTION: 运行时补列复用 `ensureProps`/`diffMissingProps` 语义；具体以共享模块方式落地由 proposer/generator 决定（Planner 不指定实现路径）。]
- [ASSUMPTION: `AI Project`=checkbox、`Run ID`=rich_text、`Remark`=rich_text，与现 `buildProjectProps` emit 类型一致。]

## 预期受影响文件

- `packages/brain/src/notion-relay-projection.js`: 集中列定义 + 推前 `ensureProps` 补列 + `Status` 发 select。
- `packages/brain/src/ops-notion-schema.js`: 复用/导出 `diffMissingProps` 等机制（如需将 `ensureProps` 提为可被运行时 import 的共享 helper）。
- `packages/brain/src/__tests__/notion-relay-projection.test.js`: 新增复现缺列/类型不符的 failing test（保留为回归）。
- `packages/brain/scripts/smoke/`: 新增 relay-projection 列一致性 smoke（proven-to-fire）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本任务 ability_id/journey_id 为 null，golden-path/feature NFR 查询返回空）+ 任务描述显式 NFR -->
- 幂等: 补列必须幂等（已存在列不重发，不覆盖主理人手改配置）
- 可观测: 投影失败不得静默——逐行 catch 必须带失败计数/告警，禁止吞 400 静默停更（血训：09-06/09-08 两次踩，本闸防第三次）
- 一致性闸: smoke 必须 proven-to-fire（人为制造缺列/类型不符时能红）
- 超时/频控: 待定（PrepPRD 未指定，沿用现有 tick 周期）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant。本任务无 ability_id/journey_id → 无 step/journey_feature 级；area 级查询返回 94 条 capture-triage 通用学习（未挂 area、非本 feature 专属），下列为其中与本 sprint 直接相关者 -->
- [复用库补列] 建新表/复用库前先 grep 全部写入方，两个模块写同一库必须 schema 对齐（来源: area）
- [真实列名] 起草涉及库字段的合同/测试前先核对目标库真实列名与类型，不凭经验假设（来源: area）
- [catch 可观测] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area，默认铁律）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path。本任务无 journey_id → 无法按 line 聚合；下列取接力棒 PR1-PR3 已合并 PR 的既成行为，本 sprint 不得回退 -->
- 接力棒 PR1 脊柱: 任务链真列 → project 根 → 追加式 handoff → 派发注入链上下文
- 接力棒 PR2 接棒与闸: 接棒收口 + 闸
- 接力棒 PR3 投影: project 根 → Projects 库镜子（Status/AI Project/Run ID/Remark + 目标/链/待拍板/最近交接四块）；待拍板决策 → 决策库草案；指纹去重、页删重建

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl localhost:5221 + psql）
# 期望验收点（自然语言）：
# 1. 对 project 根 bf5088a3 触发 relay-projection 推送，Notion PATCH/POST 返回 200（不再 400）
# 2. 回读 Projects 库该页：Status 为 select 值、AI Project/Run ID/Remark 三列存在且有值
# 3. 页正文含四块：目标 / 链 / 待拍板 / 最近交接
# 4. 新增一致性 smoke：人为删一列或改 Status 为 status 类型 → smoke 红（proven-to-fire）
# 5. failing test 在修复前红、修复后绿，保留在 CI
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 纯后端投影逻辑，无 UI/远端 agent/engine 路径。
## target_environment: local_api
## target_environment_reason: Brain 内部后台投影任务，E2E 走本地 evaluator curl localhost:5221 + psql 验证 Notion 推送结果。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
