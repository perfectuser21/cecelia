# 推进项完成度模型 PR1 — 实现 Spec

> 蓝图：`docs/current/spec-advancement-model.md`（模型总纲，已锁）
> 需求：`sprints/07081119-advancement-items-pr1/prep-prd.md`（PrepPRD，已批准）
> 本 spec 只覆盖 PR1（展示证明层）；relay/report 接线、军师、自动拆解不在本 PR。

## 1. 目标

给每个 ability 一根「推进项完成度」进度条。ability = 长期战线，底下挂一串推进项（advancement_items），进度 = 完成/总数（**现算不落列**）。PR1 用手工数据点亮"看"这一端：能建推进项、能查进度、war room 能看到进度条 + 三栏。

## 2. 三个单元（各自单一职责、独立可测）

### 单元 A · DB schema（migration 319）
新表 `advancement_items` = 推进账本。字段：

| 列 | 类型 | 约束 |
|---|---|---|
| id | uuid | PK，default gen_random_uuid() |
| ability_id | uuid | NOT NULL，FK→journey_features(id) ON DELETE CASCADE |
| title | text | NOT NULL |
| status | text | NOT NULL default 'todo'，CHECK in ('todo','doing','done') |
| priority | text | default 'P1' |
| run_id | uuid | NULL，FK→initiative_runs(id) ON DELETE SET NULL |
| pr_url | text | NULL |
| created_at | timestamptz | default now() |
| done_at | timestamptz | NULL |

索引：`idx_advancement_items_ability_id ON (ability_id)`。迁移幂等（IF NOT EXISTS）。
**进度不落列**——done/total 由 API 现算。

### 单元 B · API（挂进 `routes/abilities.js`，复用现有 router）
契约：

- `GET /api/brain/abilities/:id/advancements`
  返回 `{ ability_id, items: [...按 priority,created_at 排], progress: { done, doing, todo, total, pct } }`
  pct = total>0 ? round(done/total*100) : 0（整数）。`done/doing/todo/total` 用 `COUNT(*) FILTER (WHERE status=...)` 一条 SQL 现算。
  ability 不存在（journey_features 无此 id）→ 404。

- `POST /api/brain/abilities/:id/advancements`
  body `{ title, priority? }`。title 缺 → 400。ability_id 不存在 → 404（不建孤儿行）。成功 → 201 返回新行（status 默认 todo）。

- `PATCH /api/brain/advancements/:itemId`
  body 允许改 `status`（校验 CHECK 集合，非法 → 400）、`pr_url`、`title`、`priority`。status 改为 done 时自动写 `done_at=now()`；改回非 done 时 `done_at=NULL`。item 不存在 → 404。

错误风格与 abilities.js 一致（400 校验 / 404 不存在 / 500 catch）。

### 单元 C · 前端（war room）
新增 ability 进度展示组件，挂进 `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`（或抽独立子组件文件）：
- 输入：某 ability 的 advancements 数据（走单元 B 的 GET）
- 渲染：一根进度条（宽度 = pct%）+ 三栏分组 ✓已完成(done 项) / ⟳进行中(doing 项) / ○待推进(todo 项)，每栏列标题 + 计数
- 纯展示，数据从 API 来；聚合/分栏的纯函数逻辑（items → {done[],doing[],todo[],pct}）抽出来单测

## 3. 数据流

```
操作者 → POST 建推进项 → advancement_items(status=todo)
操作者 → PATCH status=done (+pr_url) → done_at 落时间
war room → GET /abilities/:id/advancements → {items, progress{done,total,pct}}
       → 进度条(pct) + 三栏(按 status 分组)
```

## 4. 错误处理
- 非法 ability_id（POST/GET）→ 404，不建孤儿行
- 非法 status（PATCH/CHECK）→ 400
- title 缺失（POST）→ 400
- 前端：GET 失败 → 该 ability 行显示"进度加载失败"占位，不白屏

## 5. 测试策略（四档）

- **Integration（API behavior，进 CI，本 PR 主守卫）**：起 Brain（或直连测试 DB），跑真实 SQL：
  1. POST 建 3 项 → GET 返回 total=3/done=0/pct=0
  2. PATCH 1 项 done → GET 返回 done=1/pct=33 且该项 done_at 非空
  3. POST 到不存在 ability_id → 404，且 DB 无新行（反向断言）
  4. PATCH 非法 status → 400
  这是本 bug/功能的 proven-to-fire 守卫（逻辑接缝，CI test 足够）。
- **Unit（前端，进 CI）**：聚合纯函数 `groupByStatus(items)` → {done[],doing[],todo[],pct}：空列表 pct=0；混合列表分栏计数正确；全 done pct=100。
- **E2E（manual，验收）**：Playwright 开 war room（mac_web，perfect21:5211）截图，肉眼确认目标 ability 进度条 + 三栏计数正确。dashboard 需运行，作为验收步骤非 CI 门禁。
- **Migration 幂等（manual）**：`psql -c "\d advancement_items"` 显示表 + 两个 FK + status CHECK；重复跑 migration 不报错。

## 6. 边界 / 不做（YAGNI）
- 不做删除推进项 API（PR1 用不到；需要时再加 DELETE）
- 不做分页（单 ability 推进项数量级小）
- 不接 relay/report 自动回写（PR2）
- 不做军师自动挑项 / ability 自动拆解（PR3+）
- run_id 列本 PR 建好但不写入（PR2 relay 认领时才填）

## 7. 触及文件
- 新增 `packages/brain/migrations/319_advancement_items.sql`
- 改 `packages/brain/src/routes/abilities.js`（加 3 endpoint）
- 新增 API integration test（`packages/brain/` 测试目录约定）
- 改/新增 `apps/dashboard/src/pages/warroom/`（进度组件 + 纯函数 + 单测）
- 因改 Brain：过 DevGate（facts-check / version-sync / dod-mapping）+ 视需要 bump brain 版本
