# Phase 1：Task→Ability 十字边 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `tasks` 表新增 `ability_id` 外键，打通双轴模型的十字边——一条 GTD Task 能记录它在实现能力台账（journey_features）里的哪个 Ability/Feature，并让任务创建 API 接受该字段。

**Architecture:** 一条 migration 加列 + 一处 API INSERT 接线，纯增量、NULL 安全、不动任何现有列。这是双轴模型 5 个 Phase 里最小、最安全、可独立交付的一刀。

**Tech Stack:** PostgreSQL（migration via `node packages/brain/src/migrate.js`）、Express 路由、vitest + supertest。

**Spec:** `docs/superpowers/specs/2026-06-10-canonical-wbs-tree-design.md`（§3 十字边 / §8 Phase 1）

---

## 本 Phase 的范围裁剪（明确说明）

Spec §8 的 Phase 1 还列了"回填孤儿 area_id"和"折叠 Scope 准备列"。本计划**只做 `tasks.ability_id` 十字边**，另两项移到 Phase 2，原因：

- **孤儿 area_id 回填**：盲目在 migration 里 SET area_id 有写错风险（28 个 objective 仅 9 个有 area，剩余无法机械确定归属）。需 report-first 的数据任务单独做，不混进 schema 变更。
- **Scope 折叠**：与 Initiative 合一强耦合（Initiative 直挂 Project 才需要），归入 Phase 2。

这样 Phase 1 是一刀干净、低风险、可独立验收的变更。

## File Structure

- `packages/brain/migrations/296_tasks_ability_id.sql` — 新建。加 `tasks.ability_id` 列 + FK + 索引。
- `packages/brain/src/routes/task-tasks.js` — 修改。任务创建端点（POST `/`，行 28-120）接受并写入 `ability_id`。
- `packages/brain/src/routes/__tests__/task-tasks.test.js` — 修改。加一条测试，断言 `ability_id` 透传到 INSERT 参数。

---

## Task 1：Migration 296 — 加 `tasks.ability_id` 列

**Files:**
- Create: `packages/brain/migrations/296_tasks_ability_id.sql`

- [ ] **Step 1: 写 migration 文件**

`packages/brain/migrations/296_tasks_ability_id.sql`：

```sql
-- Migration 296: 双轴模型 Phase 1 — Task→Ability 十字边
-- ability_id: 一条 GTD Task 实现能力台账（journey_features）里的哪个 Ability/Feature。
-- 执行轴 Task ←→ 能力轴 Ability 的十字连接。NULL 安全，不动任何现有列。
-- 参见 docs/superpowers/specs/2026-06-10-canonical-wbs-tree-design.md §3

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS ability_id UUID REFERENCES journey_features(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_ability_id ON tasks(ability_id);
```

- [ ] **Step 2: 跑 migration**

Run: `cd packages/brain && node src/migrate.js`
Expected: 输出包含 `296` 已 applied（或 "Applied migration 296"），无报错。

- [ ] **Step 3: 验证列 / FK / 索引都在**

Run:
```bash
PGPASSWORD=cecelia psql -h localhost -U cecelia -d cecelia -c "\d tasks" | grep -E "ability_id|idx_tasks_ability_id"
```
Expected: 看到 `ability_id | uuid`、一条指向 `journey_features(id)` 的 FOREIGN KEY、`idx_tasks_ability_id` 索引。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/296_tasks_ability_id.sql
git commit -m "feat(brain): migration 296 — tasks.ability_id 十字边（双轴模型 Phase 1）"
```

---

## Task 2：任务创建 API 接受 `ability_id`（TDD）

**Files:**
- Test: `packages/brain/src/routes/__tests__/task-tasks.test.js`
- Modify: `packages/brain/src/routes/task-tasks.js:30-45`（destructure）、`:95-116`（INSERT）

- [ ] **Step 1: 写失败测试**

在 `packages/brain/src/routes/__tests__/task-tasks.test.js` 的最外层 `describe` 末尾追加一个新 `describe` 块（mock/工具沿用文件顶部已有的 `mockPool`/`createApp`）：

```javascript
describe('task-tasks routes — ability_id 十字边', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('创建任务时 ability_id 透传到 INSERT 参数并回显', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-9', title: 'Build douyin publish', status: 'queued', task_type: 'dev', ability_id: 'ab-1' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Build douyin publish',
      ability_id: 'ab-1',
    });
    expect(res.status).toBe(201);
    // INSERT 参数数组最后一位是 ability_id
    const params = mockPool.query.mock.calls[0][1];
    expect(params).toContain('ab-1');
    // SQL 文本含 ability_id 列
    expect(mockPool.query.mock.calls[0][0]).toMatch(/ability_id/);
    expect(res.body.ability_id).toBe('ab-1');
  });

  it('不传 ability_id 时为 null，不报错', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-10', title: 'Plain task', status: 'queued', task_type: 'dev', ability_id: null }],
    });
    const res = await request(app).post('/tasks').send({ title: 'Plain task' });
    expect(res.status).toBe(201);
    const params = mockPool.query.mock.calls[0][1];
    expect(params[params.length - 1]).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/task-tasks.test.js`
Expected: 新增两条 FAIL（现 INSERT 无 `ability_id` 列、params 不含 'ab-1'、回显 undefined）。原有 3 条 B51 测试仍 PASS。

- [ ] **Step 3: 改实现 — destructure 加 ability_id**

`packages/brain/src/routes/task-tasks.js`，把 destructure 块（行 30-45）里 `okr_initiative_id = null,` 之后加一行：

```javascript
      okr_initiative_id = null,
      ability_id = null,
    } = req.body;
```

- [ ] **Step 4: 改实现 — INSERT 列/值/参数/RETURNING 加 ability_id**

同文件，把 INSERT 语句（行 95-116）改成（4 处变化：列、占位符 $13、参数、RETURNING）：

```javascript
    const result = await pool.query(
      `INSERT INTO tasks (
         title, description, priority, task_type, status,
         project_id, area_id, goal_id, location,
         payload, trigger_source, domain, okr_initiative_id, ability_id
       )
       VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, title, status, task_type, priority, project_id, area_id, goal_id, okr_initiative_id, ability_id, created_at`,
      [
        title.trim(),
        description,
        priority,
        task_type,
        project_id,
        area_id,
        goal_id,
        location,
        (payload ?? metadata) ? JSON.stringify(payload ?? metadata) : null,
        trigger_source,
        domain,
        okr_initiative_id,
        ability_id,
      ]
    );
```

- [ ] **Step 5: 跑测试，确认全过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/task-tasks.test.js`
Expected: 5 条全 PASS（3 条 B51 + 2 条 ability_id）。

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/routes/task-tasks.js packages/brain/src/routes/__tests__/task-tasks.test.js
git commit -m "feat(brain): 任务创建 API 接受 ability_id（双轴模型十字边）"
```

---

## Task 3：DevGate + 收尾

- [ ] **Step 1: 跑 DevGate（改 Brain 必须过）**

Run:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三个全绿。若 facts-check 因 migration/schema 漂移失败，按其提示更新 `.agent-knowledge/brain.md` 或 DEFINITION.md。

- [ ] **Step 2: 冒烟验证端到端**

Run（Brain 已重载新代码后）：
```bash
curl -s -X POST localhost:5221/api/brain/task-tasks -H "Content-Type: application/json" \
  -d '{"title":"phase1 smoke ability edge","ability_id":null}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('ability_id field present:', 'ability_id' in d)"
```
Expected: `ability_id field present: True`（确认 RETURNING 带出该字段）。

> 注：上面用 `task-tasks` 挂载前缀；实际前缀以 server.js 中 `app.use('/api/brain/...', taskTasksRouter)` 为准，执行时先 `grep -rn "task-tasks" packages/brain/src/server.js` 确认。

---

## Execution notes（项目约定）

- 本 Phase 是 Brain 代码改动，**走项目 `/dev` 工作流执行**（worktree 隔离 + DevGate + Brain auto-version + CI），不要在 main 直接改。本计划即 PrepPRD 依据。
- Brain 重载新代码前需 `git pull` host main（Brain mount host repo，restart 不自动更新代码）。
- migration 会被 db_schema_registry 自动扫描，无需手动登记。

## Self-Review 记录

- **Spec 覆盖**：覆盖 spec §3"唯一新增断边 tasks.ability_id"+ §8 Phase 1 的 ability_id 部分；area 回填/Scope 折叠已显式裁剪到 Phase 2 并说明原因。
- **占位符**：无 TBD/TODO；migration、API diff、测试均为完整可执行代码。
- **类型一致**：`ability_id` 全程 UUID，destructure / INSERT 列 / $13 / params / RETURNING / 测试断言五处命名一致。
