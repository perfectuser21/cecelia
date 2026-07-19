# 刀C全家:锚点回填四件套 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把锚点回填提案批准的 30 条存量写库,并建四件套(apply器/锚点哨兵/出生即焊/merge自动焊)让锚点覆盖率增量自动维护,不再退化成第二本死账。

**Architecture:** journey_features 表(unit_test_path/workflow_ref/guard_ref 三列已存在)不改表结构。补两个缺口路由(PATCH 补 workflow_ref、新增单行 GET)、新增一个图端点(anchor-coverage,复用已有 loadGraphContext/classifyFeatureAnchors)、POST 路由加一段创建时校验、两个新脚本(apply器+哨兵检查逻辑)、一个 shell 哨兵包一层 cron、harness-report.mjs 追加一步非致命的自动回填。

**Tech Stack:** Node.js ESM(packages/brain 下 `"type":"module"`)、Express、pg(经 `../../db.js` 的 pool,测试全部 mock)、vitest+supertest(brain 路由测试)、bash(scripts/patrol 哨兵,沿用 main-repo-sentinel.sh 的 stub 注入测试模式)。

---

### Task 1: PATCH /journey_features/:id 补 workflow_ref 字段

**Files:**
- Modify: `packages/brain/src/routes/journeys.js:250-287`
- Test: `packages/brain/src/routes/__tests__/journeys.test.js`

- [ ] **Step 1: 写失败测试**

在 `journeys.test.js` 里现有的 `describe('PATCH /journey_features/:id softness/group', ...)` 块后面新增一个 describe 块:

```js
describe('PATCH /journey_features/:id workflow_ref', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('workflow_ref 写入 UPDATE 语句', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', workflow_ref: 'e2e/foo.spec.ts' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .patch('/api/brain/journey_features/f1')
      .send({ workflow_ref: 'e2e/foo.spec.ts' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toContain('workflow_ref');
    expect(mockQuery.mock.calls[0][1]).toContain('e2e/foo.spec.ts');
  });

  it('workflow_ref 传 null 会清空字段', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', workflow_ref: null }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .patch('/api/brain/journey_features/f1')
      .send({ workflow_ref: null });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toContain('workflow_ref');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js -t "workflow_ref"`
Expected: FAIL(`updateSql` 不含 `'workflow_ref'`,因为 PATCH handler 当前没有这个字段的 SET 分支)

- [ ] **Step 3: 实现**

在 `packages/brain/src/routes/journeys.js:252` 把解构加上 `workflow_ref`:

```js
const { thickness, status, unit_test_path, version, guard_ref, softness, group, workflow_ref } = req.body;
```

在 `line 267`(`guard_ref` 的 SET 分支)后面插入:

```js
if (guard_ref !== undefined)        { sets.push(`guard_ref=$${idx++}`);       vals.push(guard_ref ?? null); }
if (workflow_ref !== undefined)     { sets.push(`workflow_ref=$${idx++}`);    vals.push(workflow_ref ?? null); }
if (softness !== undefined)         { sets.push(`softness=$${idx++}`);        vals.push(softness ?? null); }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js -t "workflow_ref"`
Expected: PASS(2 passed)

- [ ] **Step 5: 跑全量 journeys.test.js 确认无回归**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/routes/journeys.js packages/brain/src/routes/__tests__/journeys.test.js
git commit -m "fix(brain): PATCH /journey_features/:id 补 workflow_ref 字段——POST 已支持但 PATCH 漏了"
```

---

### Task 2: 新增 GET /journey_features/:id 单行端点

**Files:**
- Modify: `packages/brain/src/routes/journeys.js`(在 `GET /journey_features`(line 171-191)之后、`POST /journey_features`(line 193)之前插入)
- Test: `packages/brain/src/routes/__tests__/journeys.test.js`

**为什么需要**:merge自动焊(Task 11)要在 harness-report.mjs 里查"这个 feature 当前锚点是否全为 null",现状只有列表端点(`GET /journey_features`,不支持按 id 精确取单行,`?journey_id=`/`?kind=`/`?area=`/`?status=` 都不是 id)和 `blast-radius` 端点,没有单行取值端点。

- [ ] **Step 1: 写失败测试**

在 `journeys.test.js` 里 `describe('GET /api/brain/journey_features'` 相关块附近(或文件末尾新增独立 describe)加:

```js
describe('GET /journey_features/:id', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('按 id 精确取单行', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Feature A', unit_test_path: null, workflow_ref: null, guard_ref: null }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features/f1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('f1');
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('WHERE id=$1');
  });

  it('不存在的 id → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features/nope');

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js -t "GET /journey_features/:id"`
Expected: FAIL(404 路由不存在,supertest 返回 404 是 express 默认行为但 body 不含预期字段/或被其他路由如 `/journey_features/:id/blast-radius` 的 `:id` 段吞掉产生非预期匹配——不管哪种失败原因,当前没有这个精确路由)

- [ ] **Step 3: 实现**

在 `packages/brain/src/routes/journeys.js` 第 191 行(`GET /journey_features` 结束的 `});` 之后)、第 193 行(`POST /journey_features` 之前)插入:

```js
// GET /api/brain/journey_features/:id — 单行精确取值(merge自动焊/apply器消费)
router.get('/journey_features/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM journey_features WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[journeys] GET /journey_features/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

> 注意路由顺序:Express 按注册顺序匹配,`GET /journey_features/:id` 必须放在 `GET /journey_features/:id/blast-radius`(line 150)之后仍能正常工作(不同路径深度,不冲突),但要放在 `GET /journey_features`(不带 :id 的列表端点)之后——否则 `:id` 会去匹配空字符串导致列表端点失效。按上面"第 191 行之后"的位置插入即满足这个顺序要求。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js -t "GET /journey_features/:id"`
Expected: PASS(2 passed)

- [ ] **Step 5: 跑全量确认无回归**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/routes/journeys.js packages/brain/src/routes/__tests__/journeys.test.js
git commit -m "feat(brain): GET /journey_features/:id 单行端点——merge自动焊需要查询当前锚点状态"
```

---

### Task 3: 新增 GET /api/brain/graph/anchor-coverage 端点

**Files:**
- Modify: `packages/brain/src/routes/graph.js`
- Test: `packages/brain/src/routes/__tests__/graph.test.js`

**为什么需要**:锚点哨兵(Task 8)要拿"全量断锚数",现有 5 个端点(locate/related/radius/island-check/claim-status)都是按查询条件返回,没有一个直接给出全量统计。`loadGraphContext()` 内部已经算出 `anchor_coverage`,只是没有独立端点暴露。

- [ ] **Step 1: 写失败测试**

在 `graph.test.js` 末尾(紧接最后一个 `describe` 块之后)新增:

```js
describe('GET /anchor-coverage', () => {
  it('返回全量锚点覆盖率与断锚数', async () => {
    const res = await request(app).get('/api/brain/graph/anchor-coverage');
    expect(res.status).toBe(200);
    expect(res.body.anchor_coverage).toEqual({ total_features: 2, anchored: 2, covered_by_graph: 1 });
    expect(res.body.broken).toBe(1);
    expect(res.body.freshness.stale).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/graph.test.js -t "anchor-coverage"`
Expected: FAIL(404,路由不存在)

- [ ] **Step 3: 实现**

在 `packages/brain/src/routes/graph.js` 里找到最后一个路由处理器(`GET /claim-status`)结束之后、`export default router;` 之前插入:

```js
// GET /api/brain/graph/anchor-coverage — 全量锚点覆盖率(nightly 断锚哨兵消费)
router.get('/anchor-coverage', async (_req, res) => {
  try {
    const { anchor_coverage, freshness } = await loadGraphContext();
    const broken = anchor_coverage.total_features - anchor_coverage.covered_by_graph;
    res.json({ anchor_coverage, freshness, broken });
  } catch (err) {
    console.error('[graph] GET /anchor-coverage error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/graph.test.js -t "anchor-coverage"`
Expected: PASS

- [ ] **Step 5: 跑全量确认无回归**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/graph.test.js`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/routes/graph.js packages/brain/src/routes/__tests__/graph.test.js
git commit -m "feat(brain): GET /api/brain/graph/anchor-coverage——锚点哨兵消费的全量断锚数端点"
```

---

### Task 4: 出生即焊——POST /journey_features 创建时校验

**Files:**
- Modify: `packages/brain/src/routes/journeys.js:194-247`
- Test: `packages/brain/src/routes/__tests__/journeys.test.js`

- [ ] **Step 1: 写失败测试**

新增 describe 块:

```js
describe('POST /journey_features 出生即焊校验', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('status=working 且无锚点 → 400', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'Feature X', status: 'working' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('锚点');
  });

  it('status=working 带 guard_ref → 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Feature X', status: 'working' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'Feature X', status: 'working', guard_ref: 'script:foo.ts' });

    expect(res.status).toBe(201);
  });

  it('status 不传(默认 planned)且无锚点 → 201(骨架阶段不强制)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Feature Y' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'Feature Y' });

    expect(res.status).toBe(201);
  });

  it('status=planned 显式传入且无锚点 → 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Feature Z' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'Feature Z', status: 'planned' });

    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js -t "出生即焊"`
Expected: FAIL(第一个用例:现状无校验,`status=working` 无锚点也会 201,不是预期的 400)

- [ ] **Step 3: 实现**

在 `packages/brain/src/routes/journeys.js:194-198`(`if (!name) ...` 校验之后)插入:

```js
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (status && status !== 'planned') {
      const hasAnchor = unit_test_path || workflow_ref || guard_ref;
      if (!hasAnchor) {
        return res.status(400).json({
          error: 'status 非 planned 时必须至少提供一个锚点字段(unit_test_path/workflow_ref/guard_ref)',
        });
      }
    }
    if (thickness && !VALID_THICKNESS.includes(thickness)) {
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js -t "出生即焊"`
Expected: PASS(4 passed)

- [ ] **Step 5: 跑全量确认无回归**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/journeys.test.js`
Expected: 全部 PASS(尤其确认现有"POST /journey_features 写入"用例——多数没传 status,走 planned 默认分支,不受影响)

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/routes/journeys.js packages/brain/src/routes/__tests__/journeys.test.js
git commit -m "feat(brain): 出生即焊——POST /journey_features status非planned时强制带锚点字段"
```

---

### Task 5: add-feature.js 加 --workflow-ref/--guard-ref 参数

**Files:**
- Modify: `packages/engine/skills/dev/scripts/add-feature.js`
- Test: `packages/engine/skills/dev/scripts/__tests__/add-feature.test.mjs`(新建)

- [ ] **Step 1: 写失败测试**

创建 `packages/engine/skills/dev/scripts/__tests__/add-feature.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { createServer } from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../add-feature.js');

function withFakeBrain(handler) {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, JSON.parse(body || '{}'), res));
    });
    server.listen(0, () => resolvePromise(server));
  });
}

describe('add-feature.js --workflow-ref/--guard-ref 透传', () => {
  let server;
  afterEach(() => { if (server) server.close(); });

  it('透传 workflow_ref 和 guard_ref 到 POST body', async () => {
    let capturedBody = null;
    server = await withFakeBrain((req, body, res) => {
      capturedBody = body;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'f1', name: body.name, thickness: body.thickness }));
    });
    const port = server.address().port;

    execFileSync('node', [
      SCRIPT, '--name', 'Test Feature', '--journey-id', 'j1',
      '--workflow-ref', 'e2e/foo.spec.ts', '--guard-ref', 'script:bar.ts',
    ], { env: { ...process.env, BRAIN_URL: `http://localhost:${port}` }, encoding: 'utf8' });

    expect(capturedBody.workflow_ref).toBe('e2e/foo.spec.ts');
    expect(capturedBody.guard_ref).toBe('script:bar.ts');
  });

  it('不传时 workflow_ref/guard_ref 为 null(向后兼容)', async () => {
    let capturedBody = null;
    server = await withFakeBrain((req, body, res) => {
      capturedBody = body;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'f1', name: body.name, thickness: body.thickness }));
    });
    const port = server.address().port;

    execFileSync('node', [SCRIPT, '--name', 'Test Feature'], {
      env: { ...process.env, BRAIN_URL: `http://localhost:${port}` }, encoding: 'utf8',
    });

    expect(capturedBody.workflow_ref).toBeNull();
    expect(capturedBody.guard_ref).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/engine && npx vitest run skills/dev/scripts/__tests__/add-feature.test.mjs`
Expected: FAIL(第一个用例:`capturedBody.workflow_ref` 是 `undefined` 不是 `'e2e/foo.spec.ts'`,因为脚本没透传)

- [ ] **Step 3: 实现**

在 `packages/engine/skills/dev/scripts/add-feature.js` 里找到 `body: JSON.stringify({...})` 段(现状只有 5 个字段),改为:

```js
    body: JSON.stringify({
      name: args.name,
      journey_id: args['journey-id'] || null,
      thickness,
      area: args.area || null,
      unit_test_path: args['unit-test-path'] || null,
      workflow_ref: args['workflow-ref'] || null,
      guard_ref: args['guard-ref'] || null,
    }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/engine && npx vitest run skills/dev/scripts/__tests__/add-feature.test.mjs`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/skills/dev/scripts/add-feature.js packages/engine/skills/dev/scripts/__tests__/add-feature.test.mjs
git commit -m "feat(engine): add-feature.js 加 --workflow-ref/--guard-ref 透传参数"
```

> 注意:改了 `packages/engine/skills/` 下的文件——按 CLAUDE.md engine hooks/scripts 改动约定,PR title 需要考虑是否要加 `[CONFIG]` 前缀 + 版本 bump(见 Task 12 收尾检查)。

---

### Task 6: apply器脚本 apply-anchors.mjs

**Files:**
- Create: `packages/brain/scripts/apply-anchors.mjs`
- Test: `packages/brain/scripts/__tests__/apply-anchors.test.mjs`

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/scripts/__tests__/apply-anchors.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { parseApprovedFile, resolveFeatureId, buildPatchPayload } from '../apply-anchors.mjs';

describe('parseApprovedFile', () => {
  it('解析 entries 数组,每条含 feature_id', () => {
    const json = JSON.stringify({ entries: [{ feature_id: 'abc123', unit_test_path: 'x.ts' }] });
    const entries = parseApprovedFile(json);
    expect(entries).toHaveLength(1);
    expect(entries[0].feature_id).toBe('abc123');
  });

  it('entries 缺失 → 抛错', () => {
    expect(() => parseApprovedFile(JSON.stringify({}))).toThrow(/entries/);
  });

  it('某条缺 feature_id → 抛错', () => {
    const json = JSON.stringify({ entries: [{ unit_test_path: 'x.ts' }] });
    expect(() => parseApprovedFile(json)).toThrow(/feature_id/);
  });
});

describe('buildPatchPayload', () => {
  it('只带非 null 字段', () => {
    const entry = { feature_id: 'abc', unit_test_path: 'x.ts', workflow_ref: null, guard_ref: null };
    expect(buildPatchPayload(entry)).toEqual({ unit_test_path: 'x.ts' });
  });

  it('多字段非 null 都带上', () => {
    const entry = { feature_id: 'abc', unit_test_path: 'x.ts', workflow_ref: 'y.spec.ts', guard_ref: null };
    expect(buildPatchPayload(entry)).toEqual({ unit_test_path: 'x.ts', workflow_ref: 'y.spec.ts' });
  });

  it('三字段全 null → 空对象', () => {
    const entry = { feature_id: 'abc', unit_test_path: null, workflow_ref: null, guard_ref: null };
    expect(buildPatchPayload(entry)).toEqual({});
  });
});

describe('resolveFeatureId', () => {
  it('单条命中 → 返回 uuid', async () => {
    const fakeQuery = async (sql, params) => {
      expect(sql).toContain('ILIKE');
      expect(params[0]).toBe('abc123%');
      return { rows: [{ id: 'abc12345-full-uuid' }] };
    };
    const id = await resolveFeatureId(fakeQuery, 'abc123');
    expect(id).toBe('abc12345-full-uuid');
  });

  it('零命中 → 返回 null', async () => {
    const fakeQuery = async () => ({ rows: [] });
    const id = await resolveFeatureId(fakeQuery, 'zzz999');
    expect(id).toBeNull();
  });

  it('多命中 → 抛错(短id应唯一,防御性检查)', async () => {
    const fakeQuery = async () => ({ rows: [{ id: 'a' }, { id: 'b' }] });
    await expect(resolveFeatureId(fakeQuery, 'dup')).rejects.toThrow(/多条/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run scripts/__tests__/apply-anchors.test.mjs`
Expected: FAIL(`../apply-anchors.mjs` 模块不存在,import error)

- [ ] **Step 3: 实现**

创建 `packages/brain/scripts/apply-anchors.mjs`:

```js
#!/usr/bin/env node
/**
 * apply-anchors.mjs — 锚点回填 apply器
 *
 * Usage:
 *   node packages/brain/scripts/apply-anchors.mjs --input <approved.json> [--dry-run] [--output <result.json>]
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ANCHOR_FIELDS = ['unit_test_path', 'workflow_ref', 'guard_ref'];

export function parseApprovedFile(jsonContent) {
  const data = JSON.parse(jsonContent);
  if (!Array.isArray(data.entries)) throw new Error('approved 文件缺少 entries 数组');
  for (const e of data.entries) {
    if (!e.feature_id) throw new Error('entries 中有一条缺少 feature_id: ' + JSON.stringify(e));
  }
  return data.entries;
}

export function buildPatchPayload(entry) {
  const payload = {};
  for (const field of ANCHOR_FIELDS) {
    if (entry[field] != null) payload[field] = entry[field];
  }
  return payload;
}

export async function resolveFeatureId(queryFn, shortId) {
  const { rows } = await queryFn(
    `SELECT id FROM journey_features WHERE id::text ILIKE $1 LIMIT 5`,
    [`${shortId}%`]
  );
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new Error(`短id "${shortId}" 命中多条(${rows.length})，需要人工核实唯一性`);
  return rows[0].id;
}

// ── CLI 入口(被直接执行时才跑;被 import 时跳过,方便单测) ──────────────────
async function main() {
  function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith('--')) {
        const key = argv[i].slice(2);
        result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      }
    }
    return result;
  }
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('用法: node apply-anchors.mjs --input <approved.json> [--dry-run] [--output <result.json>]');
    process.exit(1);
  }
  const dryRun = !!args['dry-run'];
  const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

  const { default: pg } = await import('pg');
  const pool = new pg.Pool();
  const queryFn = (sql, params) => pool.query(sql, params);

  const entries = parseApprovedFile(readFileSync(resolve(args.input), 'utf8'));
  const applied = [];
  const skipped = [];
  const failed = [];

  for (const entry of entries) {
    try {
      const featureId = await resolveFeatureId(queryFn, entry.feature_id);
      if (!featureId) {
        skipped.push({ feature_id: entry.feature_id, reason: 'not_found' });
        continue;
      }
      const payload = buildPatchPayload(entry);
      if (Object.keys(payload).length === 0) {
        skipped.push({ feature_id: entry.feature_id, reason: 'no_fields' });
        continue;
      }
      if (dryRun) {
        console.log(`[dry-run] ${entry.feature_id} → ${featureId}: ${JSON.stringify(payload)}`);
        applied.push({ feature_id: entry.feature_id, resolved_id: featureId, fields: payload, dry_run: true });
        continue;
      }
      const resp = await fetch(`${BRAIN_URL}/api/brain/journey_features/${featureId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        failed.push({ feature_id: entry.feature_id, reason: `HTTP ${resp.status}` });
        continue;
      }
      console.log(`[applied] ${entry.feature_id} → ${featureId}: ${JSON.stringify(payload)}`);
      applied.push({ feature_id: entry.feature_id, resolved_id: featureId, fields: payload });
    } catch (err) {
      failed.push({ feature_id: entry.feature_id, reason: err.message });
    }
  }

  await pool.end();

  const result = { applied, skipped, failed };
  console.log(`\n汇总: applied=${applied.length} skipped=${skipped.length} failed=${failed.length}`);
  if (args.output) {
    writeFileSync(resolve(args.output), JSON.stringify(result, null, 2));
    console.log(`结果已写入 ${args.output}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run scripts/__tests__/apply-anchors.test.mjs`
Expected: PASS(全部 passed)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/scripts/apply-anchors.mjs packages/brain/scripts/__tests__/apply-anchors.test.mjs
git commit -m "feat(brain): apply-anchors.mjs——锚点回填apply器,支持dry-run"
```

---

### Task 7: 用 apply器实际写入 30 条批准锚点

**Files:**
- 无代码改动,执行脚本 + 产出留痕文件到 sprint 目录

- [ ] **Step 1: dry-run 预览**

Run:
```bash
BRAIN_URL=http://localhost:5221 node packages/brain/scripts/apply-anchors.mjs \
  --input docs/proposals/anchor-approved-20260719.json --dry-run
```
Expected: 打印最多 30 行 `[dry-run] <feature_id> → <uuid>: {...}`,汇总行 `applied=N skipped=M failed=0`(N+M=30;`skipped` 允许存在,若某条 `feature_id` 短id在当前库里查不到,记入 skipped 不算失败)

- [ ] **Step 2: 检查 dry-run 输出里 skipped/failed 是否符合预期**

若 `failed > 0`:说明有短 id 命中多条(冲突),需要人工核对 `docs/proposals/anchor-approved-20260719.json` 里对应条目的 `feature_id` 补成更长前缀避免歧义,改完重跑 Step 1。
若 `skipped` 里出现 `reason: 'not_found'`:核对该 feature_id 是否在 `journey_features` 表里真实存在(`psql -c "SELECT id,name FROM journey_features WHERE id::text LIKE '<prefix>%'"`),确认是否提案批阅时 id 抄错。

- [ ] **Step 3: 真实执行**

Run:
```bash
BRAIN_URL=http://localhost:5221 node packages/brain/scripts/apply-anchors.mjs \
  --input docs/proposals/anchor-approved-20260719.json \
  --output sprints/07190650-knife-c-anchor-backfill/apply-anchors-result.json
```
Expected: 汇总行与 Step 1 dry-run 的 applied/skipped 数字一致(且 failed=0),`sprints/07190650-knife-c-anchor-backfill/apply-anchors-result.json` 文件生成

- [ ] **Step 4: psql 验证落库**

Run:
```bash
psql -h localhost -U postgres -d cecelia -c \
  "SELECT id, name, unit_test_path, workflow_ref, guard_ref FROM journey_features WHERE id::text IN (SELECT resolved_id FROM json_to_recordset('$(cat sprints/07190650-knife-c-anchor-backfill/apply-anchors-result.json | node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(0)).applied))")'::json) AS x(resolved_id text)) LIMIT 5;"
```
（若上面这条一次性 SQL 拼接太绕，改用更直接的方式：先 `cat` result.json 里的 `resolved_id` 列表，挑 3-5 条手动 `psql -c "SELECT unit_test_path,workflow_ref,guard_ref FROM journey_features WHERE id='<resolved_id>'"` 抽查，确认写入值与 `anchor-approved-20260719.json` 对应条目一致）

Expected: 抽查的每条 `unit_test_path`/`workflow_ref`/`guard_ref` 与 `anchor-approved-20260719.json` 里对应 entry 的值一致

- [ ] **Step 5: Commit 留痕文件**

```bash
git add sprints/07190650-knife-c-anchor-backfill/apply-anchors-result.json
git commit -m "chore(brain): apply-anchors执行留痕——30条批准锚点已写入journey_features"
```

---

### Task 8: 锚点哨兵检查逻辑 anchor-sentinel-check.mjs

**Files:**
- Create: `packages/brain/scripts/anchor-sentinel-check.mjs`
- Test: `packages/brain/scripts/__tests__/anchor-sentinel-check.test.mjs`

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/scripts/__tests__/anchor-sentinel-check.test.mjs`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { createServer } from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../anchor-sentinel-check.mjs');

describe('anchor-sentinel-check.mjs', () => {
  let server;
  afterEach(() => { if (server) server.close(); });

  it('打印 broken/total/covered 的 JSON', async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        anchor_coverage: { total_features: 10, anchored: 8, covered_by_graph: 6 },
        freshness: { stale: false },
        broken: 4,
      }));
    });
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    const out = execFileSync('node', [SCRIPT], {
      env: { ...process.env, BRAIN_URL: `http://localhost:${port}` },
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out.trim().split('\n').pop());
    expect(parsed.broken).toBe(4);
    expect(parsed.total).toBe(10);
    expect(parsed.covered).toBe(6);
  });

  it('Brain 不可达 → 非零退出', async () => {
    expect(() => execFileSync('node', [SCRIPT], {
      env: { ...process.env, BRAIN_URL: 'http://localhost:19998' },
      encoding: 'utf8',
    })).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run scripts/__tests__/anchor-sentinel-check.test.mjs`
Expected: FAIL(脚本不存在)

- [ ] **Step 3: 实现**

创建 `packages/brain/scripts/anchor-sentinel-check.mjs`:

```js
#!/usr/bin/env node
/**
 * anchor-sentinel-check.mjs — 锚点断锚数检查(nightly 哨兵调用)
 * 输出最后一行为 JSON: { broken, total, covered }
 */
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

async function main() {
  const resp = await fetch(`${BRAIN_URL}/api/brain/graph/anchor-coverage`);
  if (!resp.ok) {
    console.error(`anchor-coverage 端点返回 HTTP ${resp.status}`);
    process.exit(1);
  }
  const data = await resp.json();
  const result = {
    broken: data.broken,
    total: data.anchor_coverage.total_features,
    covered: data.anchor_coverage.covered_by_graph,
  };
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(`anchor-sentinel-check 失败: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run scripts/__tests__/anchor-sentinel-check.test.mjs`
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
git add packages/brain/scripts/anchor-sentinel-check.mjs packages/brain/scripts/__tests__/anchor-sentinel-check.test.mjs
git commit -m "feat(brain): anchor-sentinel-check.mjs——断锚数检查,读/api/brain/graph/anchor-coverage"
```

---

### Task 9: 抽取共享 notify() + 锚点哨兵 shell 包装

**Files:**
- Create: `scripts/patrol/lib/notify.sh`
- Modify: `scripts/patrol/main-repo-sentinel.sh`(改用共享 notify.sh，回归验证不破坏现状)
- Create: `scripts/patrol/anchor-sentinel.sh`
- Create: `scripts/__tests__/anchor-sentinel.test.sh`

- [ ] **Step 1: 抽取共享 notify.sh(先做这步,不改变行为,是纯重构)**

创建 `scripts/patrol/lib/notify.sh`:

```bash
#!/usr/bin/env bash
# notify.sh — 哨兵共享告警函数,POST Brain harness/notify
# 测试注入:NOTIFY_CMD(设置了就调用它而不是 curl)
notify() {
  local title="$1"
  local message="$2"
  if [ -n "${NOTIFY_CMD:-}" ]; then
    $NOTIFY_CMD "$message" || true
  else
    curl -s -m 5 -X POST localhost:5221/api/brain/harness/notify \
      -H 'Content-Type: application/json' \
      -d "{\"title\":\"${title}\",\"message\":\"${message}\"}" >/dev/null 2>&1 || true
  fi
}
```

> 与 `main-repo-sentinel.sh` 原有 `notify()` 的差异:原函数硬编码 `title="主仓哨兵"`、单参数(`notify "$1"`);共享版本改成两个参数(`title`, `message`),调用方各自传自己的 title。这是必要的接口调整,不是无关重构——两个哨兵标题不同,硬编码在共享函数里没法区分。

- [ ] **Step 2: 改 main-repo-sentinel.sh 用共享 notify.sh,跑现有测试确认不回归**

在 `scripts/patrol/main-repo-sentinel.sh` 顶部(`REPO_DIR=...` 那几行附近)加载共享函数:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/notify.sh"
```

删掉原有的内联 `notify()` 函数定义(line 30-36),把所有 `notify "$1"` 形式的调用改成 `notify "主仓哨兵" "$1"`（3 处调用，line 里搜 `notify "` 逐一替换第一个参数补上标题）。

Run: `bash scripts/__tests__/main-repo-sentinel.test.sh`
Expected: 全部 PASS(和改动前一致,因为 `main-repo-sentinel.test.sh` 用 `SENTINEL_NOTIFY_CMD` 注入 stub——需要同步确认:原脚本用的注入变量名是 `SENTINEL_NOTIFY_CMD` 不是 `NOTIFY_CMD`,所以脚本里除了 `source lib/notify.sh` 还要在调用 `notify` 前把 `NOTIFY_CMD` 设成 `${SENTINEL_NOTIFY_CMD:-}`，即在 `source` 那行之后加一行 `NOTIFY_CMD="${SENTINEL_NOTIFY_CMD:-}"`)

- [ ] **Step 3: 写锚点哨兵的失败测试**

创建 `scripts/__tests__/anchor-sentinel.test.sh`（照抄 `main-repo-sentinel.test.sh` 的 stub 注入风格）:

```bash
#!/usr/bin/env bash
# anchor-sentinel.test.sh — 锚点哨兵测试(stub check-script + notify,零 DB/网络依赖)
set -uo pipefail
ERRORS=0; PASS=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS+1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SCRIPT="$REPO_ROOT/scripts/patrol/anchor-sentinel.sh"
TMPD=$(mktemp -d -t anchor-sentinel-test.XXXXXX)
trap 'rm -rf "$TMPD"' EXIT

NOTIFY_LOG="$TMPD/notify.log"
NOTIFY_STUB="$TMPD/notify.sh"; printf '#!/usr/bin/env bash\necho "$1" >> "%s"\n' "$NOTIFY_LOG" > "$NOTIFY_STUB"; chmod +x "$NOTIFY_STUB"

CHECK_LOW="$TMPD/check-low.sh"; printf '#!/usr/bin/env bash\necho '"'"'{"broken":2,"total":10,"covered":8}'"'"'\n' > "$CHECK_LOW"; chmod +x "$CHECK_LOW"
CHECK_HIGH="$TMPD/check-high.sh"; printf '#!/usr/bin/env bash\necho '"'"'{"broken":5,"total":10,"covered":5}'"'"'\n' > "$CHECK_HIGH"; chmod +x "$CHECK_HIGH"

echo "=== anchor-sentinel 测试 ==="

# 场景1:首次跑(无状态文件),broken=2 → 不告警,状态文件写入2
STATE_FILE="$TMPD/state1"
rm -f "$STATE_FILE"
ANCHOR_SENTINEL_STATE_FILE="$STATE_FILE" ANCHOR_SENTINEL_CHECK_CMD="$CHECK_LOW" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" \
  bash "$SCRIPT" >/dev/null 2>&1
if [ ! -f "$NOTIFY_LOG" ] && [ "$(cat "$STATE_FILE")" = "2" ]; then
  pass "首次跑(broken=2,无历史)不告警,状态文件写入2"
else
  fail "首次跑行为不符预期"
fi

# 场景2:broken 从 2 → 2(不升)不告警
rm -f "$NOTIFY_LOG"
ANCHOR_SENTINEL_STATE_FILE="$STATE_FILE" ANCHOR_SENTINEL_CHECK_CMD="$CHECK_LOW" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" \
  bash "$SCRIPT" >/dev/null 2>&1
if [ ! -f "$NOTIFY_LOG" ]; then
  pass "broken持平(2→2)不告警"
else
  fail "broken持平却告警了"
fi

# 场景3:broken 从 2 → 5(上升)告警
rm -f "$NOTIFY_LOG"
ANCHOR_SENTINEL_STATE_FILE="$STATE_FILE" ANCHOR_SENTINEL_CHECK_CMD="$CHECK_HIGH" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" \
  bash "$SCRIPT" >/dev/null 2>&1
if [ -f "$NOTIFY_LOG" ] && grep -q "5" "$NOTIFY_LOG" && [ "$(cat "$STATE_FILE")" = "5" ]; then
  pass "broken上升(2→5)触发告警,状态文件更新为5"
else
  fail "broken上升未告警或状态文件未更新"
fi

echo ""
echo "=== 结果: $PASS passed, $ERRORS failed ==="
[ "$ERRORS" -eq 0 ] || exit 1
```

- [ ] **Step 4: 跑测试确认失败**

Run: `bash scripts/__tests__/anchor-sentinel.test.sh`
Expected: FAIL(`scripts/patrol/anchor-sentinel.sh` 不存在)

- [ ] **Step 5: 实现 anchor-sentinel.sh**

创建 `scripts/patrol/anchor-sentinel.sh`:

```bash
#!/usr/bin/env bash
# anchor-sentinel.sh — 锚点断锚数哨兵(刀C 件②,2026-07-19)
# 规矩:断锚数(unanchored+uncovered)只许降不许升,升了告警不阻断。
# cron 安装(SSOT):
#   0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh && bash scripts/patrol/anchor-sentinel.sh >> /tmp/anchor-sentinel.log 2>&1
# 测试注入:ANCHOR_SENTINEL_STATE_FILE / ANCHOR_SENTINEL_CHECK_CMD / SENTINEL_NOTIFY_CMD
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/notify.sh"
NOTIFY_CMD="${SENTINEL_NOTIFY_CMD:-}"

STATE_FILE="${ANCHOR_SENTINEL_STATE_FILE:-/tmp/anchor-sentinel-last-broken-count}"
CHECK_CMD="${ANCHOR_SENTINEL_CHECK_CMD:-node $SCRIPT_DIR/../../packages/brain/scripts/anchor-sentinel-check.mjs}"

result=$($CHECK_CMD 2>&1)
broken=$(echo "$result" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).broken))" 2>/dev/null)

if [ -z "$broken" ]; then
  echo "ALERT: 锚点检查失败,输出: $result"
  exit 1
fi

last=$(cat "$STATE_FILE" 2>/dev/null || echo 0)

if [ "$broken" -gt "$last" ]; then
  echo "ALERT: 断锚数上升 $last → $broken"
  notify "锚点哨兵" "断锚数上升: $last → $broken,查 /api/brain/graph/locate 排查"
else
  echo "OK: 断锚数 $broken(历史最高 $last)"
fi

echo "$broken" > "$STATE_FILE"
exit 0
```

- [ ] **Step 6: 跑测试确认通过**

Run: `bash scripts/__tests__/anchor-sentinel.test.sh`
Expected: `=== 结果: 3 passed, 0 failed ===`

- [ ] **Step 7: 跑 main-repo-sentinel 测试确认共享重构无回归(再确认一遍)**

Run: `bash scripts/__tests__/main-repo-sentinel.test.sh`
Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add scripts/patrol/lib/notify.sh scripts/patrol/main-repo-sentinel.sh scripts/patrol/anchor-sentinel.sh scripts/__tests__/anchor-sentinel.test.sh
git commit -m "feat(patrol): 锚点哨兵anchor-sentinel.sh + 抽取共享notify.sh(main-repo-sentinel同步改用)"
```

---

### Task 10: 安装 crontab

**Files:**
- 无代码改动,直接操作本机 crontab(这台机器的 crontab 是运行时状态,不在 git 里,历史上 run-all-scans/rescan-if-changed/main-repo-sentinel 都是这样直接装的)

- [ ] **Step 1: 确认当前 crontab 无重复项**

Run: `crontab -l | grep anchor-sentinel`
Expected: 无输出(还没装过)

- [ ] **Step 2: 追加一行**

Run:
```bash
(crontab -l 2>/dev/null; echo "0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh && bash scripts/patrol/anchor-sentinel.sh >> /tmp/anchor-sentinel.log 2>&1") | crontab -
```

> 注意:这一行接在 `run-all-scans.sh` 之后同一条 crontab 项里(用 `&&` 串联),不是新增一条独立的 `0 5 * * *`——避免和已有的 `0 5 * * * ... run-all-scans.sh` 那条产生竞态(两条同时 5:00 触发,哨兵可能读到扫描一半的 graph_edges)。

- [ ] **Step 3: 验证安装成功**

Run: `crontab -l | grep anchor-sentinel`
Expected: 打印出刚装的那一行

- [ ] **Step 4: 手动跑一次验证真实环境可用(非 dry-run,连真实 Brain)**

Run: `cd /Users/administrator/perfect21/cecelia && bash scripts/patrol/anchor-sentinel.sh`
Expected: 输出 `OK: 断锚数 N(历史最高 M)` 或首次跑的等价信息,不报错;`/tmp/anchor-sentinel-last-broken-count` 文件生成

> 这一步不涉及 git commit(crontab 不是仓库文件)。

---

### Task 11: harness-report.mjs 追加 merge自动焊(S6b)

**Files:**
- Modify: `packages/brain/scripts/harness-report.mjs`
- Test: `packages/brain/scripts/__tests__/harness-report.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `packages/brain/scripts/__tests__/harness-report.test.mjs` 末尾追加(需要额外 import `createServer`/`writeFileSync`/`chmodSync`):

```js
import { createServer } from 'http';
import { writeFileSync as writeFileSyncFs, chmodSync } from 'fs';

describe('harness-report.mjs S6b — 锚点自动焊', () => {
  let server, dir, ghStub;
  afterEach(() => {
    if (server) server.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('feature 三锚字段皆空 → 用PR changed files里的测试文件回填unit_test_path', async () => {
    let patchedBody = null;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (req.method === 'GET' && req.url.includes('/journey_features/feat-empty')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'feat-empty', unit_test_path: null, workflow_ref: null, guard_ref: null }));
        } else if (req.method === 'PATCH' && req.url.includes('/journey_features/feat-empty')) {
          patchedBody = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'feat-empty', ...patchedBody }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        }
      });
    });
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    dir = makeFixture();
    const ghStubPath = join(dir, 'gh-stub.sh');
    writeFileSyncFs(ghStubPath, '#!/usr/bin/env bash\necho "src/foo.ts"\necho "src/__tests__/foo.test.ts"\n');
    chmodSync(ghStubPath, 0o755);

    runScript(
      ['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
       '--pr-url', 'https://github.com/test/repo/pull/1', '--feature-id', 'feat-empty'],
      { BRAIN_URL: `http://localhost:${port}`, GH_CMD: ghStubPath }
    );

    expect(patchedBody).toEqual({ unit_test_path: 'src/__tests__/foo.test.ts' });
  });

  it('feature 已有锚点 → 不覆盖,不调用PATCH', async () => {
    let patchCalled = false;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (req.method === 'GET' && req.url.includes('/journey_features/feat-anchored')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'feat-anchored', unit_test_path: 'already/set.test.ts', workflow_ref: null, guard_ref: null }));
        } else if (req.method === 'PATCH' && req.url.includes('/journey_features/feat-anchored')) {
          patchCalled = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        }
      });
    });
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    dir = makeFixture();
    const ghStubPath = join(dir, 'gh-stub.sh');
    writeFileSyncFs(ghStubPath, '#!/usr/bin/env bash\necho "src/__tests__/other.test.ts"\n');
    chmodSync(ghStubPath, 0o755);

    runScript(
      ['--sprint-dir', dir, '--task-id', '00000000-0000-0000-0000-000000000001',
       '--pr-url', 'https://github.com/test/repo/pull/1', '--feature-id', 'feat-anchored'],
      { BRAIN_URL: `http://localhost:${port}`, GH_CMD: ghStubPath }
    );

    expect(patchCalled).toBe(false);
  });
});
```

（这段测试要放在文件已有的 `import` 之后、已有 `describe` 块之外新增，`makeFixture`/`runScript`/`join`/`rmSync` 复用文件顶部已有的辅助函数，不重复定义）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run scripts/__tests__/harness-report.test.mjs -t "S6b"`
Expected: FAIL(`patchedBody` 是 `null`,因为 S6b 逻辑还不存在)

- [ ] **Step 3: 实现**

在 `packages/brain/scripts/harness-report.mjs` 顶部 import 区(line 15 附近)加:

```js
import { execFileSync } from 'child_process';
```

在文件里 S6 代码块(`if (FEATURE_ID) { ... } else { console.log('[S6] feature-id empty, skipping'); }`)结束之后、S7 开始之前插入:

```js
// ── S6b: 锚点自动焊(merge自动焊)——三锚字段皆空时用PR changed files回填unit_test_path ──
function getPrChangedFiles(prUrl) {
  const ghCmd = process.env.GH_CMD || 'gh';
  try {
    const out = execFileSync(ghCmd, ['pr', 'view', prUrl, '--json', 'files', '-q', '.files[].path'], {
      encoding: 'utf8',
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    console.warn(`[S6b] gh pr view 失败(非致命): ${err.message}`);
    return [];
  }
}

if (FEATURE_ID) {
  try {
    const getResp = await fetch(`${BRAIN_URL}/api/brain/journey_features/${FEATURE_ID}`);
    if (getResp.ok) {
      const feature = await getResp.json();
      const hasAnyAnchor = feature.unit_test_path || feature.workflow_ref || feature.guard_ref;
      if (!hasAnyAnchor) {
        const changedFiles = getPrChangedFiles(PR_URL);
        const testFile = changedFiles.find((f) => /\.(test|spec)\.[jt]sx?$|_test\.py$|test_.*\.py$/.test(f));
        if (testFile) {
          const patchResp = await brainPatch(`/journey_features/${FEATURE_ID}`, { unit_test_path: testFile });
          if (patchResp.ok) {
            console.log(`[S6b] 锚点自动焊: unit_test_path=${testFile}`);
          } else {
            console.warn(`[S6b] 锚点回填 PATCH 返回 HTTP ${patchResp.status} — non-fatal`);
          }
        } else {
          console.log('[S6b] PR changed files 中未找到测试文件，跳过自动焊');
        }
      } else {
        console.log('[S6b] feature 已有锚点，不覆盖');
      }
    } else {
      console.warn(`[S6b] GET journey_features 返回 HTTP ${getResp.status} — 跳过自动焊`);
    }
  } catch (err) {
    console.error(`[S6b] FAIL: ${err.message}`);
    connectionErrors.push(`S6b: ${err.message}`);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run scripts/__tests__/harness-report.test.mjs -t "S6b"`
Expected: PASS(2 passed)

- [ ] **Step 5: 跑全量 harness-report 测试确认无回归**

Run: `cd packages/brain && npx vitest run scripts/__tests__/harness-report.test.mjs`
Expected: 全部 PASS(尤其原有"三文件生成"用例——`--feature-id fake` 打到死端口 `localhost:19999`，S6b 的 fetch 会抛网络错误，被 try/catch 吞掉记入 connectionErrors，不影响 S1-S4 产出的三个文件)

- [ ] **Step 6: Commit**

```bash
git add packages/brain/scripts/harness-report.mjs packages/brain/scripts/__tests__/harness-report.test.mjs
git commit -m "feat(brain): harness-report.mjs S6b——merge自动焊,sprint产出测试文件自动回填空锚点feature"
```

---

### Task 12: 全量回归 + PR 收尾检查

**Files:**
- 无代码改动,验证+收尾

- [ ] **Step 1: 跑 packages/brain 全量测试**

Run: `cd packages/brain && npm test`
Expected: 全部 PASS,无新增失败

- [ ] **Step 2: 跑 packages/engine 全量测试**

Run: `cd packages/engine && npm test`
Expected: 全部 PASS

- [ ] **Step 3: 跑根目录 vitest(sprints/tests 范围)**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 4: 跑所有 scripts/__tests__/*.sh**

Run:
```bash
for f in scripts/__tests__/*.test.sh; do
  echo "=== $f ==="
  bash "$f" || echo "FAILED: $f"
done
```
Expected: 全部脚本输出 `0 failed`,汇总无 `FAILED:` 行

- [ ] **Step 5: DevGate 三件套(改了 brain 代码，按 CLAUDE.md 强制门禁)**

Run:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三个都 PASS(如果 `check-version-sync.sh` 报版本不同步，按其提示 bump `packages/brain/package.json` 等对应版本号文件后重跑)

- [ ] **Step 6: 确认 PrepPRD 验收标准逐条打勾**

对照 `sprints/07190650-knife-c-anchor-backfill/prep-prd.md` 的验收标准清单，逐条确认：
- [ ] apply器 `--dry-run` 已跑（Task 7 Step 1）
- [ ] apply器实际执行30条已落库（Task 7 Step 3-4）
- [ ] 锚点哨兵 proven-to-fire 已验证（Task 9 Step 6，场景3覆盖"断锚数上升→告警"）
- [ ] POST /journey_features 两个分支已测（Task 4）
- [ ] harness-report.mjs 两个分支已测（Task 11）
- [ ] CI 全绿（Step 1-5 已确认）

- [ ] **Step 7: 更新 sprint 目录留痕，最终 commit**

```bash
git add -A
git status --short
git commit -m "chore(sprint): 刀C全家收尾——DevGate通过,PrepPRD验收标准全部打勾" --allow-empty
```

（若 `git status --short` 无新变化，跳过这个 commit，`--allow-empty` 只是防御性写法，实际预期到这一步工作区应该已经干净）
