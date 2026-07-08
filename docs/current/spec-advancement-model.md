# Spec 铺开 / 推进项完成度模型（设计定稿）

> 状态：设计已锁（2026-07-08）。落地按「先竖切一刀」执行，见文末路线。
> 背景研究证据：见 memory `spec-advancement-model-design.md`（三个 subagent 代码考古坐实）。

## 0. 一句话

**ability 是永远维护的长期战线，底下挂一串「推进项」；1 plan = 1 harness run = 认领 1 个推进项 = 1 个 PR；进度 = 完成项/当前总项（连续 %，算出来不存死值）。** 现有 DB schema 与该模型高度同构，缺的是一张推进项账本表 + 接三根数据流断线，不是造新范式。

## 1. 推翻的旧模型

厚度四档（thin/medium/thick/mature）是「终点思维」。每个 ability 长期维护、永远能更好、没有"做完"那天。改用**推进项完成度**：连续进度感 +（军师）按产能挑项派发。厚度保留为"战线成熟度"的软标签，不再当进度单位。

## 2. 数据契约：一张轻表 `advancement_items`

推进账本的唯一中枢。记账单位 = 推进项（天然对应 harness 一 sprint 一 PR）。

| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk | |
| ability_id | uuid FK→journey_features(id) | 挂在长期战线上（journey_features kind='ability'）|
| title | text | 推进项标题，如"报告回写加飞书截图" |
| status | text | `todo` / `doing` / `done`（默认 todo）|
| priority | text | P0/P1/P2（军师排序用，默认 P1）|
| run_id | uuid FK→initiative_runs(id) NULL | 认领后填 |
| pr_url | text NULL | merged 后填 |
| created_at / done_at | timestamptz | |

**进度不落列**：`COUNT(*) FILTER (WHERE status='done') / COUNT(*)` per ability_id 现算。战线永远开着——想到新要求就 INSERT 一行 todo（目标持续长大）。

## 3. 三根断线（现状病灶，全部带证据在 memory）

1. **golden_path 表 0 行**：唯一写入者 `promote-regression.js` 只挂废弃 LangGraph 图，relay 路径不写。
2. **tasks.ability_id 生产全空**：10423 行仅 1 条夹具 → run 与 ability 不挂钩。
3. **payload 不传 ability_id**：`harness-skill-relay.js` 只搬 journey_id，ability 维度从点火第一步就丢。

补充坐实：累积 FR 读端(`harness-line-context.js`)绕道 tasks.ability_id join，而写端已把 ability 正确写进 `golden_path.feature_id`（真 FK）——读写用错 key。

## 4. 三层设计（按改动量分档）

### L 层 · 净新脑力（规模化才需要，竖切一刀先跳过）
- **拆解入口**：ability → 一串 advancement_items(todo)。最省 = 把 decomp Phase2「规划下一个 PR」能力复用到 ability 侧（现长在 OKR 侧，挂不到 ability）。
- **军师 producer**：扫各 ability 的 todo → 按优先级挑 N 个 → 建 N 个 harness_initiative task 落进现有队列。N 默认锚 `MAX_CONCURRENT_HARNESS_INITIATIVES=2`（dispatcher.js:56，语义"同时在跑"，军师需自带日/周期配额）。**不碰 thalamus/task-router**，只加上游 producer。

### M 层 · 展示（中大）
- `advancement_items` 表 + `GET /api/brain/abilities/:id/advancements`（GROUP BY status 算 done/total）。
- war room 新格子视图：每 ability 一根进度条 + 三栏（✓已完成 / ⟳进行中 / ○待推进）。现"铺开层空"就是因为根本没有以 ability 为格的视图/API（war room 现有进度条是 run 节点% 或 journey_steps done/total，都不是 ability 级）。

### S 层 · 接线（小改，拧螺丝）
- relay spawn env 加 `CECELIA_ABILITY_ID`（`harness-skill-relay.js` docker + headed 两分支）。
- `initiative_runs` 加 `ability_id` 列 + 2 处 INSERT（relay docker/headed）+ `routes/initiatives.js` 人工接管 INSERT 对齐。
- report Phase B 加第 9 个 push 函数 `pushAdvancementItems`（8 个已是同构模板，复制）；PR merged 后 Step4 旁加一条 `PATCH /advancements/:id {status:done, pr_url}`。
- 顺带修 report 现有 bug：Step4 发 `thickness:"done"` 是无效值（VALID_THICKNESS 无 done）→ 会 400。

**注入基本就绪**：`tasks.ability_id` 列已存在（migration 297）+ `POST /tasks` 已支持 ability_id（task-tasks.js:58/131/148），建带 ability_id 的 task 零改路由。

## 5. 闭环

```
ability 挂推进项(todo)
  → 军师按产能挑 N 个(L层;竖切阶段手工挑)
  → 派 N 个 plan/harness run(认领→status=doing, run_id 落表)
  → harness 跑(内部产 golden_path 作该 run 验收)
  → PR merged → report 回写 status=done + pr_url
  → 进度 +1项(现算)
  → war room 每 ability 进度条 + 三栏 / 日报按 ability 报推进
```

## 6. 落地路线：先竖切一刀

**不先做 L 层**（拆解自动化 + 军师自动挑项）。先在样板 line（journey bb8cc561 "Cecelia Harness Pipeline"）的一个 ability（如「报告与回写」）上：

1. 建表 `advancement_items` + `initiative_runs.ability_id` 列（migration 300/301）
2. 接线（S 层全部）
3. 聚合 API + war room 格子视图（M 层）
4. **手工**塞该 ability 3-5 个推进项进表 → 让 war room 进度条第一次亮

S+M 已能端到端跑通闭环并证明模型；L 层（自动拆解/军师）留到模型验证后再规模化。
