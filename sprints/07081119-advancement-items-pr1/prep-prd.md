# PrepPRD：推进项完成度模型 — 竖切一刀 PR1（展示证明层）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：advancement_items 表 + 聚合/CRUD API + war room ability 进度视图 + 手工试铺样板 ability
- [ ] 另立 Sprint（本次不做）：relay/report 接线（S 层自动闭环，PR2）；军师自动挑项 + ability 自动拆解（L 层，PR3+）；累积 FR 读写 key 对齐 + golden_path 写入迁进 relay
- [ ] 待讨论：样板试铺挂哪个 ability（harness 线只有 feature，abilities 在「智能发布」线）

## Journey 当前状态（本次是 dev_pipeline 基础设施，非客户价值线）
- 现状：ability 账本 schema 已存在（journey_features / golden_path / decisions），但无「ability→推进项→进度」结构化连接
- 本次新增：advancement_items 推进账本表 + 进度可视化（war room 铺开层现空）

## 本次要做的
给每个 ability 一根「推进项完成度」进度条。ability = 长期战线，底下挂一串推进项（todo/doing/done），进度 = 完成/总数（现算不落列）。PR1 只做**展示证明层**：能建推进项、能查进度、war room 能看到进度条 + 三栏，用手工数据点亮闭环的"看"这一端。

## Golden Path（操作者视角，单线性）
> 本功能面向系统操作者（Alex / Cecelia 军师），"用户动作"= 调 API / 开 war room。

1. 系统跑 migration → `psql \d advancement_items` 显示表存在（含 ability_id FK→journey_features、status、pr_url、run_id FK→initiative_runs）
2. 操作者 `POST /api/brain/abilities/:id/advancements` 建 3 个推进项 → 返回 201，DB 落 3 行 status=todo
3. 操作者 `GET /api/brain/abilities/:id/advancements` → 返回推进项列表 + `{done, total, pct}`（此时 0/3, pct=0）
4. 操作者 `PATCH /api/brain/advancements/:itemId` 把 1 项设 status=done、带 pr_url → 再 GET，`{done:1,total:3,pct:33}`
5. 操作者打开 war room（perfect21:5211）→ 该 ability 一行：进度条按 pct 填充 + 三栏 ✓已完成(1)/⟳进行中(0)/○待推进(2) 正确分列
- 出错恢复：给不存在的 ability_id POST → 返回 404/400 明确报错，不静默建孤儿行

## 客户视角（操作者能感知到什么）
打开 war room 就能看到"每个 ability 推进到百分之几"，以及具体哪几项做完了、哪几项还没做——从"只有 status 二值"变成"连续进度 + 明细清单"。

## 完成后能
- 用一张表记录任意 ability 的推进项清单与状态
- 用一个 API 现算出任意 ability 的完成度
- 在 war room 直接看到每个 ability 的进度条 + 三栏明细

## 涉及的 Ability / Feature
- 新增能力轴基础设施「推进项完成度账本」（本次是 dev_pipeline 使能件，落在 harness 线 journey bb8cc561 下作为 feature 记录）

## 不包含
- relay spawn env 透传 ability_id、initiative_runs.ability_id 列、report 回写推进项（PR2）
- 军师自动挑项、ability→推进项自动拆解（PR3+）
- golden_path 写入迁移、累积 FR 读写 key 对齐（后续）

## 前置工作（已逐项确认，无 TBD）

### 基础设施
- [x] Brain API — localhost:5221 healthy（已注入上下文确认）
- [x] PostgreSQL — DB `cecelia` 可连（本 session psql 已多次查通）
- [x] Dashboard — perfect21:5211（war room 现有页面 apps/dashboard/src/pages/warroom/WarRoomPage.tsx）
- [x] 迁移目录 — packages/brain/migrations/（最新 299，本次用 300）
- [x] 真实 ability 数据 — journey_features kind=ability 有 27 条（智能发布线），试铺目标从中选

### 无外部凭据/素材依赖
- [x] 纯内部 DB + API + 前端，无第三方 API key、无测试 fixture 需求

## 验收标准（Final E2E，target=mac_web / local_api）
- [ ] migration 300 幂等：`psql -c "\d advancement_items"` 显示表 + ability_id/run_id 两个 FK + status CHECK 约束（todo/doing/done）
- [ ] API 行为：POST 建项返回 201 且 DB 有行；GET 返回列表 + 正确 `{done,total,pct}`（COUNT FILTER 现算）；PATCH 改 status/pr_url 生效；非法 ability_id 返回 4xx 不建孤儿
- [ ] war room：Playwright 打开页面截图，可见目标 ability 一根进度条（宽度=pct）+ 三栏 ✓/⟳/○ 且计数正确
- [ ] 回归守卫：API 层 behavior test（POST→GET 聚合数字/PATCH 迁移/非法输入 4xx）commit 进 CI；前端聚合渲染逻辑单测
- [ ] DevGate 通过（facts-check / version-sync / dod-mapping，因改 Brain）
- [ ] CI 全绿（brain-ci + workspace-ci）
