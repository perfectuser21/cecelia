# 设计：ability_id 全链接线 PR2

## 背景

PR1（#3635，已 merged）建好了 `advancement_items` 推进项账本本体（表 + `routes/abilities.js` 三端点 + war room 前端进度条）。但 ability 维度从「点火 relay」→「运行留痕 initiative_runs」→「收尾回写 report」三段还没有真正接通，同时军师 eval 顺带实锤了两个数据卫生问题（issues.journey_id 全 null / tasks 按 journey_id 过滤失效）。本次是 PrepPRD（`sprints/07091418-ability-id-chain-pr2/prep-prd.md`）已定死的 7 处小改动，无需探索式设计——只有一种可行方案，直接照现有代码模式（如 `CECELIA_JOURNEY_ID` 的写法、`abilities.js` 的 PATCH 端点、其余 8 个 push 函数的写法）复制/接线。

## 改动清单（与 PrepPRD 一一对应）

### 1. relay spawn env 加 `CECELIA_ABILITY_ID`
文件：`packages/brain/src/harness-skill-relay.js`（约245-256行 spawnFn env 对象）
仿照现有 `CECELIA_JOURNEY_ID: task.payload?.journey_id || ''`，新增：
```js
CECELIA_ABILITY_ID: task.ability_id || task.payload?.ability_id || '',
```

### 2. `initiative_runs` 加 `ability_id` 列
新增 `packages/brain/migrations/323_initiative_runs_ability_id.sql`：
```sql
ALTER TABLE initiative_runs ADD COLUMN IF NOT EXISTS ability_id UUID REFERENCES journey_features(id);
```
起跑时写入该列的代码路径：找到创建/更新 initiative_runs 记录处，跑起时从 `task.ability_id` 带入。

### 3. Phase B 第9个 push 函数 `pushAdvancementItems`
文件：`packages/brain/src/notion-push-sync.js`
仿照现有 8 个 push 函数（journeys/journey_features/issues/skill_registry/journey_steps/journey_step_links/decisions/initiative_contracts）的字段映射模式（参照 journey_features 的 thickness→Notion select 映射写法），新增函数把 `advancement_items` 表同步到 Notion，并接入 Phase B 调用序列的第9位。

### 4. PR merged 回写推进项 + 修 thickness:"done" bug
文件：`packages/workflows/skills/harness-report/SKILL.md`（约293-295行）
- **修 bug**：现状 `PATCH journey_features -d '{"thickness":"done","status":"done"}'`，而 `VALID_THICKNESS=['thin','medium','thick','mature']`（`routes/journeys.js` 第7行），"done" 非法值，PATCH 恒 400（被 `|| echo WARN` 静默吞掉）。改为只传 `{"status":"done"}`。
- **新增**：PR merged 后，若本次 run 关联了 `advancement_item_id`，调用 PR1 已建的端点：
  ```bash
  curl -s -X PATCH "localhost:5221/api/brain/advancements/$ADVANCEMENT_ITEM_ID" \
    -d "{\"status\":\"done\",\"pr_url\":\"$PR_URL\"}"
  ```

### 5. issues journey_id 回填卫生
文件：`packages/brain/src/test-lifecycle-patrol.js`（约80行）
现状 `INSERT INTO issues (title, priority, status, sub_area, body, notion_synced_at)` 缺 `journey_id`。修复：INSERT 语句加 `journey_id` 列，值来自调用方能确定的归属（若巡检本身跑在某条 journey 语境下则带入，否则显式传 NULL，不做无依据猜测回填）。

### 6. 修复 `GET /api/brain/tasks?journey_id=` 过滤失效
文件：`packages/brain/src/routes/task-tasks.js`（约170-207行）
现状 query 解构无 `journey_id`，且 tasks 表无顶层该列（只在 `payload` JSONB）。修复：
```js
const { status, area_id, project_id, task_type, journey_id, limit = '200', offset = '0' } = req.query;
...
if (journey_id) {
  conditions.push(`payload->>'journey_id' = $${paramIndex++}`);
  params.push(journey_id);
}
```

### 7. tasks.ability_id 现状核实（不改代码）
`POST /api/brain/tasks` 已支持 `ability_id`（`task-tasks.js` 58/137/140/154行，迁移297）。本次只做一次回归确认（验收标准里的 curl 验证），不产生代码 diff。

## 数据流（改动后）

```
POST /tasks {ability_id}  →  tasks.ability_id 落库（已支持）
        ↓
relay 起跑 spawn env CECELIA_ABILITY_ID  →  initiative_runs.ability_id 落库（新）
        ↓
harness 跑完 PR merged
        ↓
report: PATCH journey_features{status:done}（修 bug，去掉非法 thickness）
        + PATCH advancements/:id {status:done, pr_url}（新）
        ↓
notion-push-sync Phase B 第9函数 pushAdvancementItems → Notion 同步
```

## 测试策略

- **Unit**：`notion-push-sync.test.js` 加 `pushAdvancementItems` 用例；`task-tasks.js` journey_id 过滤加路由测试。
- **Integration**：migration 323 应用后查表结构；起跑一个带 ability_id 的 task 验证 env 透传（可用现有 harness smoke 脚本模式，mock spawn 捕获 env）。
- **Manual/E2E**（写入 PrepPRD 验收标准）：真实调用 curl 验证 `tasks?journey_id=` 过滤、advancements PATCH 200。
- 无需 trivial 档：所有改动都在 DB/API 边界，需可运行验证。

## 范围边界

- 不改动 `abilities.js` 现有三端点（PR1 已生产验证，仅复用）
- 不改前端/war room UI
- 不做军师上游 producer（属于 PR3，不在本次范围）

## 自我审查

- 无占位符/TBD，7 项均有具体文件+行号+代码片段
- 与 PrepPRD 一致，无矛盾
- 范围聚焦、单 PR 可完成，无需再分解
- 无歧义点：thickness bug 修复方式（去掉该字段）已明确，journey_id 回填遇不确定时明确"不猜测、传 NULL"
