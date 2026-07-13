# 推进项完成度模型 PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每个 ability 一根「推进项完成度」进度条：新增 advancement_items 表 + 聚合/CRUD API + war room 进度条三栏视图，用手工数据点亮"看"这一端。

**Architecture:** Brain 侧新增一张 advancement_items 表（推进账本，进度不落列）+ 挂在现有 abilities.js router 上的 3 个 endpoint（聚合用 SQL COUNT FILTER 现算，pct 用抽出的纯函数算）。前端 war room 新增 AbilityProgress 组件（进度条 + 三栏），分组/百分比用抽出的纯函数 groupByStatus。

**Tech Stack:** Node/Express + PostgreSQL（Brain）；React + Vite + vitest + @testing-library/react（Dashboard）。测试遵循本仓约定：API 用 mock pool 直调 handler，纯函数单测，真 SQL 用本地真 DB curl 冒烟兜底。

---

### Task 1: migration 320 — advancement_items 表

**Files:**
- Create: `packages/brain/migrations/320_advancement_items.sql`

- [ ] **Step 1: 写迁移 SQL**

```sql
-- migration 320: 推进项完成度模型 — advancement_items 推进账本
-- ability(journey_features kind=ability) 底下挂一串推进项。进度 done/total 由 API 现算，不落列。
-- run_id 本 PR 建好不写入（PR2 relay 认领时填）。参见 docs/superpowers/specs/2026-07-08-advancement-items-model-design.md
CREATE TABLE IF NOT EXISTS advancement_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ability_id  UUID NOT NULL REFERENCES journey_features(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  priority    TEXT NOT NULL DEFAULT 'P1',
  run_id      UUID REFERENCES initiative_runs(id) ON DELETE SET NULL,
  pr_url      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_advancement_items_ability_id ON advancement_items(ability_id);
```

- [ ] **Step 2: 本地应用迁移并验证结构**

Run:
```bash
psql -d cecelia -f packages/brain/migrations/320_advancement_items.sql
psql -d cecelia -c "\d advancement_items"
```
Expected: 表建成，显示 9 列；含 `advancement_items_status_check`（CHECK）、`advancement_items_ability_id_fkey`（→journey_features）、`advancement_items_run_id_fkey`（→initiative_runs）、索引 `idx_advancement_items_ability_id`。

- [ ] **Step 3: 验证幂等**

Run: `psql -d cecelia -f packages/brain/migrations/320_advancement_items.sql`
Expected: 无报错（IF NOT EXISTS 生效），无副作用。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/320_advancement_items.sql
git commit -m "feat(brain): migration 320 — advancement_items 推进账本表"
```

---

### Task 2: computeProgress 纯函数（TDD 单元）

**Files:**
- Create: `packages/brain/src/advancement-progress.js`
- Test: `packages/brain/src/__tests__/advancement-progress.test.js`

- [ ] **Step 1: 写 failing test**

```js
import { describe, it, expect } from 'vitest';
import { computeProgress } from '../advancement-progress.js';

describe('computeProgress', () => {
  it('空账本 pct=0', () => {
    expect(computeProgress({ done: 0, doing: 0, todo: 0 }))
      .toEqual({ done: 0, doing: 0, todo: 0, total: 0, pct: 0 });
  });
  it('1/3 完成 pct=33（四舍五入）', () => {
    expect(computeProgress({ done: 1, doing: 0, todo: 2 }))
      .toEqual({ done: 1, doing: 0, todo: 2, total: 3, pct: 33 });
  });
  it('全完成 pct=100', () => {
    expect(computeProgress({ done: 2, doing: 0, todo: 0 }))
      .toEqual({ done: 2, doing: 0, todo: 0, total: 2, pct: 100 });
  });
  it('缺字段按 0 处理', () => {
    expect(computeProgress({ done: 1 })).toEqual({ done: 1, doing: 0, todo: 0, total: 1, pct: 100 });
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd packages/brain && npx vitest run src/__tests__/advancement-progress.test.js`
Expected: FAIL（Cannot find module '../advancement-progress.js'）

- [ ] **Step 3: 实现 computeProgress**

Create `packages/brain/src/advancement-progress.js`:
```js
// 推进项进度纯计算：counts → {done,doing,todo,total,pct}。pct 整数四舍五入，total=0 时 pct=0。
export function computeProgress({ done = 0, doing = 0, todo = 0 } = {}) {
  const total = done + doing + todo;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, doing, todo, total, pct };
}
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `cd packages/brain && npx vitest run src/__tests__/advancement-progress.test.js`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/advancement-progress.js packages/brain/src/__tests__/advancement-progress.test.js
git commit -m "feat(brain): computeProgress 推进项进度纯函数 + 单测"
```

---

### Task 3: 3 个 advancement API endpoint（TDD，mock pool 直调 handler）

**Files:**
- Modify: `packages/brain/src/routes/abilities.js`（顶部加 import + 常量，文件末尾 `export default router` 前加 3 个 handler）
- Test: `packages/brain/src/__tests__/advancements-api.test.js`

- [ ] **Step 1: 写 failing test（照 capabilities-api.test.js 的 mock-pool 直调 handler 模式）**

```js
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

let routes;
function mockReqRes(body = {}, params = {}, query = {}) {
  const req = { body, params, query };
  const res = {
    _status: 200, _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}
function getHandler(method, path) {
  const layers = routes.stack.filter(l => l.route && l.route.methods[method] && l.route.path === path);
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

describe('advancements API', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('../routes.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('GET 聚合：ability 存在 → items + progress', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'ab1' }] })                       // ability 存在
      .mockResolvedValueOnce({ rows: [{ id: 'i1', status: 'done' }, { id: 'i2', status: 'todo' }, { id: 'i3', status: 'todo' }] }) // items
      .mockResolvedValueOnce({ rows: [{ done: '1', doing: '0', todo: '2' }] }); // counts
    const handler = getHandler('get', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'ab1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.progress).toEqual({ done: 1, doing: 0, todo: 2, total: 3, pct: 33 });
    expect(res._data.items).toHaveLength(3);
  });

  it('GET：ability 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('get', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'nope' });
    await handler(req, res);
    expect(res._status).toBe(404);
  });

  it('POST：title 缺失 → 400，不查库不插入', async () => {
    const handler = getHandler('post', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'ab1' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('POST：ability 不存在 → 404，不插入孤儿行', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // ability 不存在
    const handler = getHandler('post', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({ title: 'x' }, { id: 'nope' });
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(mockPool.query).toHaveBeenCalledTimes(1); // 只查了存在性，没 INSERT
  });

  it('POST：正常 → 201', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'ab1' }] })                 // 存在
      .mockResolvedValueOnce({ rows: [{ id: 'new', title: 'x', status: 'todo' }] }); // insert
    const handler = getHandler('post', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({ title: 'x' }, { id: 'ab1' });
    await handler(req, res);
    expect(res._status).toBe(201);
    expect(res._data.status).toBe('todo');
  });

  it('PATCH：非法 status → 400', async () => {
    const handler = getHandler('patch', '/advancements/:itemId');
    const { req, res } = mockReqRes({ status: 'bogus' }, { itemId: 'i1' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('PATCH：status=done → done_at 联动，返回行', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'i1', status: 'done' }] });
    const handler = getHandler('patch', '/advancements/:itemId');
    const { req, res } = mockReqRes({ status: 'done', pr_url: 'http://x' }, { itemId: 'i1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toMatch(/done_at=now\(\)/);
  });

  it('PATCH：item 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('patch', '/advancements/:itemId');
    const { req, res } = mockReqRes({ status: 'doing' }, { itemId: 'nope' });
    await handler(req, res);
    expect(res._status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd packages/brain && npx vitest run src/__tests__/advancements-api.test.js`
Expected: FAIL（No handler for get /abilities/:id/advancements）

- [ ] **Step 3: 实现 3 个 handler**

在 `packages/brain/src/routes/abilities.js` 顶部（`const router = express.Router();` 之后）加：
```js
import { computeProgress } from '../advancement-progress.js';
const ADVANCEMENT_STATUS = ['todo', 'doing', 'done'];
```

在文件末尾 `export default router;` **之前**加：
```js
// ---------- advancement_items (推进项账本) ----------

// GET /api/brain/abilities/:id/advancements — 列表 + 现算进度
router.get('/abilities/:id/advancements', async (req, res) => {
  try {
    const { id } = req.params;
    const ab = await pool.query(`SELECT id FROM journey_features WHERE id=$1`, [id]);
    if (ab.rows.length === 0) return res.status(404).json({ error: 'ability not found' });
    const items = await pool.query(
      `SELECT * FROM advancement_items WHERE ability_id=$1
       ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at ASC`,
      [id]
    );
    const counts = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='done')  AS done,
              COUNT(*) FILTER (WHERE status='doing') AS doing,
              COUNT(*) FILTER (WHERE status='todo')  AS todo
       FROM advancement_items WHERE ability_id=$1`,
      [id]
    );
    const c = counts.rows[0];
    const progress = computeProgress({ done: +c.done, doing: +c.doing, todo: +c.todo });
    res.json({ ability_id: id, items: items.rows, progress });
  } catch (err) {
    console.error('[abilities] GET advancements error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/abilities/:id/advancements — 建推进项
router.post('/abilities/:id/advancements', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const ab = await pool.query(`SELECT id FROM journey_features WHERE id=$1`, [id]);
    if (ab.rows.length === 0) return res.status(404).json({ error: 'ability not found' });
    const { rows } = await pool.query(
      `INSERT INTO advancement_items (ability_id, title, priority)
       VALUES ($1,$2,$3) RETURNING *`,
      [id, title, priority || 'P1']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[abilities] POST advancements error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/advancements/:itemId — 改 status/pr_url/title/priority
router.patch('/advancements/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { status, pr_url, title, priority } = req.body;
    if (status && !ADVANCEMENT_STATUS.includes(status))
      return res.status(400).json({ error: `status must be one of: ${ADVANCEMENT_STATUS.join(',')}` });
    const sets = [];
    const params = [];
    if (status !== undefined) {
      params.push(status); sets.push(`status=$${params.length}`);
      sets.push(status === 'done' ? `done_at=now()` : `done_at=NULL`);
    }
    if (pr_url !== undefined)   { params.push(pr_url);   sets.push(`pr_url=$${params.length}`); }
    if (title !== undefined)    { params.push(title);    sets.push(`title=$${params.length}`); }
    if (priority !== undefined) { params.push(priority); sets.push(`priority=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'no updatable fields' });
    params.push(itemId);
    const { rows } = await pool.query(
      `UPDATE advancement_items SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'advancement item not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[abilities] PATCH advancement error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `cd packages/brain && npx vitest run src/__tests__/advancements-api.test.js`
Expected: PASS（8 passed）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/abilities.js packages/brain/src/__tests__/advancements-api.test.js
git commit -m "feat(brain): advancement_items 三 endpoint(GET聚合/POST建项/PATCH改状态) + mock-pool 行为测试"
```

---

### Task 4: 真 DB 冒烟（proven-to-fire 守卫，验真 SQL + 迁移 + FK）

> mock-pool 测不到真 SQL（COUNT FILTER / FK / CHECK）。这一步对着本地运行的 Brain 跑真 curl，是本 PR 的真实接缝守卫。需 Brain 重启加载新路由（migration 已在 Task 1 手工应用）。

**Files:** 无（验证步骤，结论写进 sprint 目录备份）

- [ ] **Step 1: 重启本地 Brain 加载新路由/迁移**

Run: `bash scripts/brain-deploy.sh`（或本地 dev 启动方式；确认 `curl -s localhost:5221/api/brain/health` version 已更新）
Expected: health ok。

- [ ] **Step 2: 取一个真 ability_id，跑完整 CRUD+聚合**

Run:
```bash
AB=$(psql -d cecelia -t -A -c "select id from journey_features where kind='ability' limit 1")
# 建 3 项
for t in 项一 项二 项三; do
  curl -s -X POST "localhost:5221/api/brain/abilities/$AB/advancements" -H 'Content-Type: application/json' -d "{\"title\":\"$t\"}" >/dev/null
done
# 聚合应为 0/3
curl -s "localhost:5221/api/brain/abilities/$AB/advancements" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('total',j.progress.total,'done',j.progress.done,'pct',j.progress.pct)})"
```
Expected: `total 3 done 0 pct 0`

- [ ] **Step 3: PATCH 一项 done → 聚合 1/3 pct=33 + done_at 非空**

Run:
```bash
ITEM=$(curl -s "localhost:5221/api/brain/abilities/$AB/advancements" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).items[0].id))")
curl -s -X PATCH "localhost:5221/api/brain/advancements/$ITEM" -H 'Content-Type: application/json' -d '{"status":"done","pr_url":"http://example/pr/1"}' >/dev/null
curl -s "localhost:5221/api/brain/abilities/$AB/advancements" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('done',j.progress.done,'pct',j.progress.pct)})"
psql -d cecelia -t -A -c "select (done_at is not null) from advancement_items where id='$ITEM'"
```
Expected: `done 1 pct 33` + `t`（done_at 非空）

- [ ] **Step 4: 反例——非法 ability_id POST → 404 且无孤儿行**

Run:
```bash
BEFORE=$(psql -d cecelia -t -A -c "select count(*) from advancement_items")
curl -s -o /dev/null -w "%{http_code}\n" -X POST "localhost:5221/api/brain/abilities/00000000-0000-0000-0000-000000000000/advancements" -H 'Content-Type: application/json' -d '{"title":"orphan"}'
AFTER=$(psql -d cecelia -t -A -c "select count(*) from advancement_items")
echo "before=$BEFORE after=$AFTER"
```
Expected: `404` + `before == after`（无孤儿行）

- [ ] **Step 5: 清理测试数据 + 记录冒烟结论**

Run:
```bash
psql -d cecelia -c "delete from advancement_items where ability_id='$AB'"
```
把 Step2-4 的实际输出粘进 `sprints/07081119-advancement-items-pr1/smoke-result.md` 并 commit。

---

### Task 5: 前端 groupByStatus 纯函数（TDD 单元）

**Files:**
- Create: `apps/dashboard/src/pages/warroom/advancement-util.ts`
- Test: `apps/dashboard/src/pages/warroom/__tests__/advancement-util.test.ts`

- [ ] **Step 1: 写 failing test**

```ts
import { describe, it, expect } from 'vitest';
import { groupByStatus, AdvancementItem } from '../advancement-util';

const mk = (status: AdvancementItem['status'], id: string): AdvancementItem =>
  ({ id, title: id, status });

describe('groupByStatus', () => {
  it('空列表 pct=0', () => {
    const g = groupByStatus([]);
    expect(g).toEqual({ done: [], doing: [], todo: [], total: 0, pct: 0 });
  });
  it('混合列表分栏 + pct', () => {
    const g = groupByStatus([mk('done','a'), mk('todo','b'), mk('todo','c'), mk('doing','d')]);
    expect(g.done).toHaveLength(1);
    expect(g.doing).toHaveLength(1);
    expect(g.todo).toHaveLength(2);
    expect(g.total).toBe(4);
    expect(g.pct).toBe(25);
  });
  it('全 done pct=100', () => {
    expect(groupByStatus([mk('done','a'), mk('done','b')]).pct).toBe(100);
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/advancement-util.test.ts`
Expected: FAIL（Cannot find module '../advancement-util'）

- [ ] **Step 3: 实现**

Create `apps/dashboard/src/pages/warroom/advancement-util.ts`:
```ts
export interface AdvancementItem {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  priority?: string;
  pr_url?: string | null;
}
export interface GroupedAdvancements {
  done: AdvancementItem[];
  doing: AdvancementItem[];
  todo: AdvancementItem[];
  total: number;
  pct: number;
}
// 推进项按状态分栏 + 算完成度百分比（done/total 四舍五入整数）。
export function groupByStatus(items: AdvancementItem[]): GroupedAdvancements {
  const done = items.filter(i => i.status === 'done');
  const doing = items.filter(i => i.status === 'doing');
  const todo = items.filter(i => i.status === 'todo');
  const total = items.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;
  return { done, doing, todo, total, pct };
}
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/advancement-util.test.ts`
Expected: PASS（3 passed）

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/warroom/advancement-util.ts apps/dashboard/src/pages/warroom/__tests__/advancement-util.test.ts
git commit -m "feat(dashboard): groupByStatus 推进项分栏纯函数 + 单测"
```

---

### Task 6: AbilityProgress 组件（进度条 + 三栏，组件测试）

**Files:**
- Create: `apps/dashboard/src/pages/warroom/AbilityProgress.tsx`
- Test: `apps/dashboard/src/pages/warroom/__tests__/AbilityProgress.test.tsx`

- [ ] **Step 1: 写 failing 组件测试**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AbilityProgress } from '../AbilityProgress';
import { AdvancementItem } from '../advancement-util';

const items: AdvancementItem[] = [
  { id: 'a', title: '做完的项', status: 'done' },
  { id: 'b', title: '在做的项', status: 'doing' },
  { id: 'c', title: '待做的项', status: 'todo' },
  { id: 'd', title: '另一待做', status: 'todo' },
];

describe('AbilityProgress', () => {
  it('渲染进度条宽度=pct 且三栏计数正确', () => {
    render(<AbilityProgress abilityName="测试能力" items={items} />);
    // 三栏计数（done1/doing1/todo2）
    expect(screen.getByTestId('col-done-count').textContent).toBe('1');
    expect(screen.getByTestId('col-doing-count').textContent).toBe('1');
    expect(screen.getByTestId('col-todo-count').textContent).toBe('2');
    // 进度条 pct=25
    const bar = screen.getByTestId('progress-fill');
    expect(bar.style.width).toBe('25%');
    // 三栏标题里能看到具体推进项标题
    expect(screen.getByText('做完的项')).toBeInTheDocument();
    expect(screen.getByText('待做的项')).toBeInTheDocument();
  });

  it('空列表 pct=0 不白屏', () => {
    render(<AbilityProgress abilityName="空能力" items={[]} />);
    expect(screen.getByTestId('progress-fill').style.width).toBe('0%');
    expect(screen.getByTestId('col-todo-count').textContent).toBe('0');
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/AbilityProgress.test.tsx`
Expected: FAIL（Cannot find module '../AbilityProgress'）

- [ ] **Step 3: 实现组件**

Create `apps/dashboard/src/pages/warroom/AbilityProgress.tsx`:
```tsx
import { groupByStatus, AdvancementItem } from './advancement-util';

interface Props {
  abilityName: string;
  items: AdvancementItem[];
}

const COLS: { key: 'done' | 'doing' | 'todo'; label: string; mark: string }[] = [
  { key: 'done', label: '已完成', mark: '✓' },
  { key: 'doing', label: '进行中', mark: '⟳' },
  { key: 'todo', label: '待推进', mark: '○' },
];

export function AbilityProgress({ abilityName, items }: Props) {
  const g = groupByStatus(items);
  return (
    <div className="ability-progress" style={{ padding: 12, borderBottom: '1px solid #2a2a2a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span>{abilityName}</span>
        <span data-testid="progress-pct">{g.pct}%（{g.done.length}/{g.total}）</span>
      </div>
      <div style={{ height: 8, background: '#333', borderRadius: 4, overflow: 'hidden' }}>
        <div
          data-testid="progress-fill"
          style={{ width: `${g.pct}%`, height: '100%', background: '#4caf50', transition: 'width .3s' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {COLS.map(col => (
          <div key={col.key} style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {col.mark} {col.label}（<span data-testid={`col-${col.key}-count`}>{g[col.key].length}</span>）
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
              {g[col.key].map(it => (<li key={it.id}>{it.title}</li>))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/AbilityProgress.test.tsx`
Expected: PASS（2 passed）

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pages/warroom/AbilityProgress.tsx apps/dashboard/src/pages/warroom/__tests__/AbilityProgress.test.tsx
git commit -m "feat(dashboard): AbilityProgress 进度条+三栏组件 + 组件测试"
```

---

### Task 7: 挂进 war room + DevGate + 收尾

**Files:**
- Modify: `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`（在选中 line/ability 详情区渲染 AbilityProgress，数据走 `GET /api/brain/abilities/:id/advancements`）

- [ ] **Step 1: 在 WarRoomPage 接入组件**

在 WarRoomPage.tsx 找到中栏 line/ability 详情渲染处，新增一个 useEffect fetch `/api/brain/abilities/:id/advancements`，把 `items` 传给 `<AbilityProgress abilityName={...} items={items} />`。fetch 失败时渲染"进度加载失败"占位（不白屏）。按文件现有 fetch/state 模式写（参考同文件已有的 fetch 调用）。

> 注：war room 现无独立 ability 选中态时，先挂在 line 详情区顶部，展示该 line 下有 advancement_items 的 ability。PR1 允许用手工试铺的单个 ability 验证；完整 ability 选中导航留后续迭代（记入 spec §6 未来项，不阻塞本 PR 的"进度条能亮"验收）。

- [ ] **Step 2: 前端整体测试 + 构建**

Run: `cd apps/dashboard && npx vitest run && npx tsc --noEmit`
Expected: 全绿，无类型错误。

- [ ] **Step 3: Brain 全量测试**

Run: `cd packages/brain && npm test`
Expected: 新增测试全过，无回归。

- [ ] **Step 4: DevGate（改 Brain 必过）**

Run:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三项全过。facts-check 若因新增表/路由报不一致 → 按其提示更新 DEFINITION.md 对应段；version-sync 若要求 bump → 按 memory `version-management` 四处同步 bump brain patch 版本。

- [ ] **Step 5: 更新 spec 未来项 + Commit 收尾**

```bash
git add apps/dashboard/src/pages/warroom/WarRoomPage.tsx docs/superpowers/specs/2026-07-08-advancement-items-model-design.md
git commit -m "feat(dashboard): war room 接入 AbilityProgress + spec 未来项补注"
```

---

## Self-Review

**Spec coverage：**
- 单元 A（表）→ Task 1 ✅
- 单元 B（3 API + 现算聚合）→ Task 2（纯函数）+ Task 3（handler）✅
- 单元 C（前端进度条三栏 + 纯函数单测）→ Task 5（纯函数）+ Task 6（组件）+ Task 7（接入）✅
- 错误处理（404/400/不建孤儿/前端占位）→ Task 3 测试 + Task 4 反例 + Task 7 Step1 占位 ✅
- 测试策略四档（integration/unit/E2E/迁移幂等）→ Task 3（行为）+ Task 2/5（unit）+ Task 4（真 DB 冒烟兼 E2E 前置）+ Task 1 Step3（幂等）✅
- 真 SQL 守卫缺口（mock pool 测不到 COUNT FILTER/FK）→ Task 4 真 DB 冒烟补齐 ✅

**Placeholder scan：** 无 TBD；每个代码 step 有完整代码；命令有预期输出。Task 7 Step1 的"按现有 fetch 模式写"是唯一非逐行处——因 WarRoomPage.tsx 有既定 state 约定，故指向参照而非硬编码，可接受。

**Type consistency：** `computeProgress` 入参 {done,doing,todo} 与 GET handler 传参一致；`groupByStatus`/`AdvancementItem`/`GroupedAdvancements` 在 Task 5 定义、Task 6 消费，签名一致；`AbilityProgress` props {abilityName,items} 在 Task 6 定义、Task 7 消费，一致。

**执行注记：** DevGate 版本 bump 若触发，按 version-management 记忆四处同步（package.json / selfcheck EXPECTED_SCHEMA_VERSION 视情 / 等）。全程在 worktree cp-07081119-advancement-items-pr1 内。
