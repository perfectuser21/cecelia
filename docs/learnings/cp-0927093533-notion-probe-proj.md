## 验证层探针/判定回执/格子颜色投影到 Notion 驾驶舱（2026-09-27）

### 根本原因
- 承诺地图格子行（`journey_step_links.cell_kind` 非空，283 行）被 `pushJourneyStepLinks` 的 `cell_kind IS NULL` 过滤，从未推过 Notion；表无 `updated_at`，翻色也无法增量重推。旧推送写的 `Journey`/`Step` 列在 Backbone-Step Map 库里不存在（实查 0 行），即使推也必 400。
- `journey_assertion_receipts` 是 append-only 触发器守着的表，投影引擎回写 `notion_id` 也会被拒——接投影前必须先放行「仅记账列变化」的 UPDATE。
- `step_probes` 与业务回执从未接过 Notion 血管（无记账列、无登记）。

### 下次预防
- [ ] 新表要接 Notion：先查 `notion_projection_map` 登记 + 三记账列 + `pushRegisteredRows`，不自造推送；表若有 append-only/触发器，先跑 cecelia_test 实测记账列 UPDATE 能过。
- [ ] 增量推送依赖 `updated_at` 的表，触发器必须排除 notion_* 列（否则引擎回写 synced 抬 updated_at 自激重推）。
- [ ] 改 Notion 推送前先 GET 一次真库 schema 看列名（Journey/Step 这种"想当然"的列名会静默 400 → isWrongDatabaseError 清 id 无限重建）。
- [ ] 建库有机器路径（`scripts/ops/create-*-notion-dbs.js`：按 title 搜索复用 + POST /databases），迁移直接种真 id，不留 pending_vessel 占位给人。
- [ ] 旧测试用 `mockResolvedValueOnce` 按调用顺序 mock notionReq 的，新增一次 GET/PATCH 就会错位——改为按 method 分派。
- [ ] worktree 无 node_modules 时软链主仓库的 `node_modules` 与 `packages/brain/node_modules`（gitignored）即可跑 vitest。
