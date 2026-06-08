# Brain abilities + golden_path CRUD API — 设计

## 目标
给 abilities / golden_path 两张表加 Brain HTTP CRUD 路由，让 skill 和外部能读写。PR-2（skill 改调新 API）的前置。

## 关键修正（Research Subagent 取证发现）
两张表当前只在本地 psql 手建，**migration 文件里没有**（最新 migration 293）→ CI/prod 无表。
**本 PR 必须补 migration**（CREATE TABLE IF NOT EXISTS，幂等，与本地已建 schema 一致），否则 smoke 在 CI 失败。

## 表 schema（与本地已建一致，写进 migration）
```
abilities:    id, name, area, journey_id, kind(ability|feature), type,
              workflow_ref, status(working|broken|planned),
              notion_id, notion_synced_at, created_at, updated_at
golden_path:  id, scope_type(run|project|initiative|journey), scope_id,
              order_no, ability_id→abilities(id), note,
              notion_id, notion_synced_at, created_at
```

## 路由（照搬 journeys.js journey_features 模式：pool.query、裸数组 GET、try-catch 500、动态 PATCH）
新文件 `packages/brain/src/routes/abilities.js`：
- GET   /api/brain/abilities       过滤 area / journey_id / kind / status，ORDER BY created_at DESC
- POST  /api/brain/abilities       必填 name + area；默认 kind=ability, status=planned
- PATCH /api/brain/abilities/:id   动态 UPDATE（status/kind/type/workflow_ref/...）+ updated_at=NOW()
- GET   /api/brain/golden_path     过滤 scope_type / scope_id，ORDER BY order_no ASC
- POST  /api/brain/golden_path     必填 scope_type+scope_id+order_no+ability_id
- PATCH /api/brain/golden_path/:id 动态 UPDATE

挂载：server.js `import abilitiesRouter` + `app.use('/api/brain', abilitiesRouter)`（line 319 附近，照 journeysRouter）。

## 测试
- 单元（vitest + supertest + vi.mock db.js）：`src/routes/__tests__/abilities.test.js`
  覆盖 GET 返回数组 / POST 201 / POST 缺 name 400 / PATCH 404 / DB 错 500
- smoke（real-env）：`packages/brain/scripts/smoke/abilities-api-smoke.sh`
  curl -sf GET /api/brain/abilities | jq -e 'type=="array"'；同样验 golden_path

## 影响范围
纯新增（migration + 新 router 文件 + server.js 两行挂载 + smoke + test）。不动任何现有表/路由。零破坏。

## 验收
- [ ] migration 跑过后 abilities/golden_path 表存在
- [ ] 6 路由可用，GET /abilities 查到 zenithjoy 25 条
- [ ] 单元测试 + smoke 绿
- [ ] CI 全绿
