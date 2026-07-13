# T6 两轴衔接（KR↔Ability 轻边 + 对账端点）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KR 通过 `key_results.metadata.target_abilities` 指向能力，新端点 `GET /api/brain/okr/kr/:id/ability-progress` 输出 KR↔Ability 对账视图。

**Architecture:** 零 migration 轻边——PATCH /goals/:id 补 metadata merge 写入口（COALESCE 防 NULL 吞写）；okr-hierarchy.js 加只读对账端点，join journey_features + advancement_items 聚合，复用 computeProgress。

**Tech Stack:** Node.js ESM + Express + pg + vitest（mock pool）+ supertest。

**Spec:** docs/superpowers/specs/2026-07-11-t6-okr-ability-bridge-design.md

---

### Task 1: PATCH /goals/:id 支持 metadata（JSONB merge）

**Files:**
- Modify: `packages/brain/src/routes/task-goals.js:224`（PATCH handler 的 destructure 与 setClauses）
- Test: `packages/brain/src/__tests__/routes/task-goals.test.js`（既有文件追加 describe）

- [ ] **Step 1: 写 failing test**

在 `packages/brain/src/__tests__/routes/task-goals.test.js` 文件末尾（最外层 describe 内）追加：

```js
  describe('PATCH /goals/:id metadata merge (T6 两轴衔接)', () => {
    it('带 metadata → SQL 用 COALESCE merge 且参数为 JSON 字符串', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr1', metadata: { target_abilities: ['ab1'] } }],
      });

      const res = await request(app)
        .patch('/goals/kr1')
        .send({ metadata: { target_abilities: ['ab1'] } });

      expect(res.status).toBe(200);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain("metadata = COALESCE(metadata, '{}'::jsonb) ||");
      expect(params).toContain(JSON.stringify({ target_abilities: ['ab1'] }));
    });

    it('不带 metadata → SQL 不含 metadata（回归保护）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'x' }] });

      const res = await request(app).patch('/goals/kr1').send({ title: 'x' });

      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('metadata');
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/routes/task-goals.test.js -t "metadata merge" 2>&1 | tail -20`
Expected: 第一条 FAIL（400 "No fields to update"，因为 handler 还不认 metadata）

- [ ] **Step 3: 最小实现**

`packages/brain/src/routes/task-goals.js` PATCH handler：

destructure 行改为：
```js
    const { title, status, area_id, owner_role, custom_props, metadata } = req.body;
```

在 `if (custom_props !== undefined) {...}` 块之后追加：
```js
    if (metadata !== undefined) {
      // COALESCE 必须：objectives/key_results 的 metadata 列可空无默认，NULL || jsonb = NULL 会静默吞写
      setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIndex++}::jsonb`);
      params.push(JSON.stringify(metadata));
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/routes/task-goals.test.js 2>&1 | tail -10`
Expected: 全 PASS（含既有用例，确认无回归）

- [ ] **Step 5: Commit（两次，TDD 顺序）**

```bash
git add packages/brain/src/__tests__/routes/task-goals.test.js
git commit -m "test(brain): PATCH /goals/:id metadata merge failing test (T6)"
git add packages/brain/src/routes/task-goals.js
git commit -m "feat(brain): PATCH /goals/:id 支持 metadata JSONB merge——KR target_abilities 写入口 (T6)"
```

---

### Task 2: GET /okr/kr/:id/ability-progress 对账端点

**Files:**
- Modify: `packages/brain/src/routes/okr-hierarchy.js`（import + 文件尾部 export default 前加 handler）
- Test: Create `packages/brain/src/__tests__/okr-ability-progress.test.js`

- [ ] **Step 1: 写 failing test（新文件）**

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

describe('GET /kr/:id/ability-progress (T6 两轴对账)', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('../routes/okr-hierarchy.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('正常 join：abilities 带 thickness + advancement 聚合', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: { target_abilities: ['ab1', 'ab2'] } }] })
      .mockResolvedValueOnce({ rows: [
        { ability_id: 'ab1', name: '抖音发布', thickness: 'medium', status: 'working', done: '2', doing: '1', todo: '3' },
        { ability_id: 'ab2', name: '快手发布', thickness: 'thin', status: 'planned', done: '0', doing: '0', todo: '0' },
      ] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.success).toBe(true);
    expect(res._data.kr_title).toBe('KR一');
    expect(res._data.abilities).toHaveLength(2);
    expect(res._data.abilities[0]).toMatchObject({
      ability_id: 'ab1', thickness: 'medium',
      advancement: { done: 2, doing: 1, todo: 3, total: 6, pct: 33 },
    });
    expect(res._data.missing_ability_ids).toEqual([]);
    // join SQL 断言：走 journey_features + advancement_items，限定 kind=ability
    const [sql, params] = mockPool.query.mock.calls[1];
    expect(sql).toContain('journey_features');
    expect(sql).toContain('advancement_items');
    expect(sql).toContain("kind = 'ability'");
    expect(params).toEqual([['ab1', 'ab2']]);
  });

  it('metadata 无 target_abilities → 空 abilities + hint，不发第二条 SQL', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: null }] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.abilities).toEqual([]);
    expect(res._data.hint).toContain('target_abilities');
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('失联 ability id → 归入 missing_ability_ids', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: { target_abilities: ['ab1', 'ghost'] } }] })
      .mockResolvedValueOnce({ rows: [
        { ability_id: 'ab1', name: '抖音发布', thickness: 'thin', status: 'working', done: '0', doing: '0', todo: '1' },
      ] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._data.missing_ability_ids).toEqual(['ghost']);
  });

  it('KR 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'nope' });
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(res._data.success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/okr-ability-progress.test.js 2>&1 | tail -10`
Expected: FAIL with "No handler for get /kr/:id/ability-progress"

- [ ] **Step 3: 最小实现**

`packages/brain/src/routes/okr-hierarchy.js`：

import 区（`import pool from '../db.js';` 之后）加：
```js
import { computeProgress } from '../advancement-progress.js';
```

文件尾部 `export default router;` 之前加：
```js
// ─── T6 两轴衔接：KR↔Ability 对账视图 ─────────────────────────────────────────

/**
 * GET /api/brain/okr/kr/:id/ability-progress
 * 读 key_results.metadata.target_abilities，join journey_features(thickness) +
 * advancement_items 完成度，输出对账视图。失联引用进 missing_ability_ids。
 * 写入口：PATCH /api/brain/goals/:id（metadata merge）；
 * 禁用 PATCH /okr/key-results/:id 改 metadata（整体覆盖会吞掉 target_abilities）。
 */
router.get('/kr/:id/ability-progress', async (req, res) => {
  try {
    const { id } = req.params;
    const krResult = await pool.query('SELECT id, title, metadata FROM key_results WHERE id = $1', [id]);
    if (!krResult.rows.length) {
      return res.status(404).json({ success: false, error: 'KeyResult not found' });
    }
    const kr = krResult.rows[0];
    const targetIds = Array.isArray(kr.metadata?.target_abilities) ? kr.metadata.target_abilities : [];
    if (targetIds.length === 0) {
      return res.json({
        success: true, kr_id: kr.id, kr_title: kr.title,
        abilities: [], missing_ability_ids: [],
        hint: '该 KR 未登记 metadata.target_abilities（decomp 拆 KR 时写入）',
      });
    }

    const { rows } = await pool.query(`
      SELECT jf.id AS ability_id, jf.name, jf.thickness, jf.status,
             COUNT(ai.id) FILTER (WHERE ai.status = 'done')  AS done,
             COUNT(ai.id) FILTER (WHERE ai.status = 'doing') AS doing,
             COUNT(ai.id) FILTER (WHERE ai.status = 'todo')  AS todo
      FROM journey_features jf
      LEFT JOIN advancement_items ai ON ai.ability_id = jf.id
      WHERE jf.id = ANY($1) AND jf.kind = 'ability'
      GROUP BY jf.id, jf.name, jf.thickness, jf.status
    `, [targetIds]);

    const abilities = rows.map(r => ({
      ability_id: r.ability_id, name: r.name, thickness: r.thickness, status: r.status,
      advancement: computeProgress({ done: +r.done, doing: +r.doing, todo: +r.todo }),
    }));
    const foundIds = new Set(rows.map(r => r.ability_id));
    const missing_ability_ids = targetIds.filter(tid => !foundIds.has(tid));

    res.json({ success: true, kr_id: kr.id, kr_title: kr.title, abilities, missing_ability_ids });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/okr-ability-progress.test.js src/__tests__/routes/task-goals.test.js src/__tests__/advancements-api.test.js 2>&1 | tail -10`
Expected: 全 PASS（连带确认 advancements/task-goals 无回归）

- [ ] **Step 5: Commit（两次，TDD 顺序）**

```bash
git add packages/brain/src/__tests__/okr-ability-progress.test.js
git commit -m "test(brain): /okr/kr/:id/ability-progress 对账端点 failing test (T6)"
git add packages/brain/src/routes/okr-hierarchy.js
git commit -m "feat(brain): GET /okr/kr/:id/ability-progress——KR↔Ability 对账视图 join thickness+推进项完成度 (T6)"
```

---

### Task 3: 版本 bump + DevGate 校验

**Files:**
- Modify: `packages/brain/package.json` / `packages/brain/package-lock.json`（npm version 自动改）
- Modify: `.brain-versions`（末行）
- Modify: `DEFINITION.md`（Brain 版本行）

- [ ] **Step 1: minor bump（新端点=feature）**

```bash
cd packages/brain && npm version minor --no-git-tag-version && node -p "require('./package.json').version" && cd ../..
```
记下输出的新版本号 `<NEW_VERSION>`，用于下两步。

- [ ] **Step 2: 同步 .brain-versions 与 DEFINITION.md**

```bash
# .brain-versions 末行追加/更新为新版本（先看现有格式再改，保持格式一致）
tail -3 .brain-versions
grep -n "Brain 版本\|brain.*version" DEFINITION.md | head -5
```
按现有格式把两处版本号改为 `<NEW_VERSION>`（用 Edit 工具改，不用 sed）。

- [ ] **Step 3: DevGate 三连**

```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三个全过。任一失败 → 按报错修，禁止绕过。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): version bump <NEW_VERSION> (T6 两轴衔接)"
```

---

### Task 4: PRD/DoD/Learning 收尾文件（push 前硬门槛）

**Files:**
- Create: `PRD.md`（worktree 根，若 devgate 需要）或按 repo 既有惯例位置
- Create: `DoD.md`
- Create: `docs/learnings/cp-07111236-t6-okr-ability-bridge.md`

- [ ] **Step 1: 写 DoD.md（含 [BEHAVIOR] 条目，manual: 命令必须 CI 兼容）**

```markdown
# DoD: T6 两轴衔接——KR metadata 轻边 + ability-progress 对账端点

- [x] [BEHAVIOR] PATCH /goals/:id 带 metadata 时用 COALESCE merge 写入 key_results.metadata
  Test: tests/ packages/brain/src/__tests__/routes/task-goals.test.js
- [x] [BEHAVIOR] GET /okr/kr/:id/ability-progress 返回 abilities(thickness+advancement) 与 missing_ability_ids
  Test: tests/ packages/brain/src/__tests__/okr-ability-progress.test.js
- [x] [BEHAVIOR] metadata 无 target_abilities 时端点返回空 abilities + hint 且不发 join SQL
  Test: tests/ packages/brain/src/__tests__/okr-ability-progress.test.js
- [x] 版本四处同步（package.json/package-lock/.brain-versions/DEFINITION.md）
  Test: manual: bash scripts/check-version-sync.sh
- [x] CI 全绿
```

（写完后按实际执行状态勾选，push 前全部 [x]。）

- [ ] **Step 2: 写 PRD.md（含 ## 成功标准 二级标题）**

```markdown
# PRD: T6 两轴衔接——KR↔Ability 轻边 + 对账端点

OKR 轴够不着能力轴，季度意志无法对账成资产。KR 通过 metadata.target_abilities
指向 journey_features 能力，对账端点算出各能力厚度与推进项完成度。
架构：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md（T6）。

## 成功标准
- PATCH /api/brain/goals/:kr_id 可 merge 写入 metadata.target_abilities（NULL 列不吞写）
- GET /api/brain/okr/kr/:id/ability-progress 输出对账视图，数字与 journey_features/advancement_items 直查一致
- 失联 ability id 进 missing_ability_ids 暴露而非静默丢弃
```

- [ ] **Step 3: 写 Learning 文件**

`docs/learnings/cp-07111236-t6-okr-ability-bridge.md`：

```markdown
# Learning: T6 两轴衔接——JSONB 可空列 merge 的 NULL 吞写坑

### 根本原因
objectives/key_results 的 metadata 列是可空无 DEFAULT 的 jsonb，照抄 custom_props 的
`col || $n::jsonb` 写法在 NULL 行上得 NULL，写入被静默吞掉——SQL 语义坑而非代码 bug。

### 下次预防
- [ ] 对可空 jsonb 列做 merge 一律 `COALESCE(col, '{}'::jsonb) || $n::jsonb`（kr-verifier/okr-tick 已有惯例）
- [ ] 同一列存在 merge 与整体覆盖两种 PATCH 路径时，在端点注释里写明互斥使用规则
```

- [ ] **Step 4: Commit**

```bash
git add DoD.md PRD.md docs/learnings/cp-07111236-t6-okr-ability-bridge.md
git commit -m "docs: T6 PRD/DoD/Learning 收尾文件"
```

---

### Task 5: decomp skill 加 target_abilities 写入步骤（zenithjoy-skills repo，独立 PR）

**Files:**
- Modify: `/Users/administrator/perfect21/zenithjoy-skills/decomp/SKILL.md`（Phase 1 KR 拆解段）

- [ ] **Step 1: 在 zenithjoy-skills repo 开分支**

```bash
cd /Users/administrator/perfect21/zenithjoy-skills && git checkout main && git pull && git checkout -b cp-07111236-decomp-target-abilities
```

- [ ] **Step 2: 修改 decomp SKILL.md**

在 Phase 1 OKR/KR 拆解的写库说明处（"写入目标表 goals 表（type=kr）"相关段落之后）追加死步骤：

```markdown
**拆完 KR 必做（T6 两轴衔接，2026-07-11 起）**：每个新建/更新的 KR 必须把它要推进的
ability id 列表写进 `key_results.metadata.target_abilities`：

​```bash
# ability id 从 journey_features catalog 语义匹配（禁凭空造）
curl -s "localhost:5221/api/brain/journey_features?limit=50"
# 写轻边（merge 语义，不会覆盖 metadata 其他 key）
curl -s -X PATCH "localhost:5221/api/brain/goals/<kr_id>" \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"target_abilities":["<ability_id>","..."]}}'
​```

季度末对账：`GET /api/brain/okr/kr/<kr_id>/ability-progress`（thickness + 推进项完成度视图）。
⚠️ 禁用 `PATCH /okr/key-results/:id` 改 metadata——那条路是整体覆盖，会吞掉 target_abilities。
```

同时 bump SKILL.md frontmatter 的 version（若有）并在 changelog 段（若有）追加一行。

- [ ] **Step 3: 提交并开 PR**

```bash
cd /Users/administrator/perfect21/zenithjoy-skills
git add decomp/SKILL.md
git commit -m "feat(decomp): 拆KR后强制写 key_results.metadata.target_abilities——九要素T6两轴衔接"
git push -u origin cp-07111236-decomp-target-abilities
gh pr create --title "feat(decomp): 拆KR写target_abilities轻边（九要素T6）" --body "配套 cecelia T6 PR（PATCH /goals/:id metadata merge + GET /okr/kr/:id/ability-progress）。架构依据 cecelia docs/architecture/2026-07-10-nine-elements-integrity/architecture.md T6 行。

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: merge 后刷 dist（skills-dist 分发链）**

按 skills-architecture 惯例：merge 后触发 dist 刷新（sync-skills-snapshot 会把快照带回 cecelia）。
```

---

## Self-Review 结论

- Spec coverage：变更1→Task1，变更2→Task2，变更3→Task5，版本/门禁→Task3，测试策略→Task1/2 内嵌。manual 验收在 engine-ship 前由主 session 真库执行。无缺口。
- Placeholder：`<NEW_VERSION>` 是执行时确定的真实值占位（bump 输出），非 TBD。
- 类型一致性：computeProgress 返回 `{done,doing,todo,total,pct}`，测试断言与实现一致；路由 path `/kr/:id/ability-progress` 全文一致。
