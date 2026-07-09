# task-tasks.js POST /tasks 服务端去重护栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/brain/tasks` 在建任务前检查是否已存在同 title/goal_id/project_id 且状态仍是 queued/in_progress 的任务，命中则返回已有任务不新建，堵住 2026-07-09 实测的"同一功能跨时间窗口独立重复点火"问题（issue 655691d2）。

**Architecture:** 单文件核心改动（`task-tasks.js` 加一段 SELECT 查询），配套更新同目录下已有测试文件（因为新增的 SELECT 会让每个请求多一次 `pool.query` 调用，原有测试里所有 `mockPool.query.mock.calls[0]` 的下标引用需要相应调整）。

**Tech Stack:** Node.js（Express route），vitest + supertest（测试，沿用文件已有的 mock 模式）。

## Global Constraints

- 只加去重查询，不改变现有成功路径的响应结构（除新增可选的 `deduplicated` 字段）
- 只做精确 title 匹配，不做语义/模糊匹配（已在 spec 里明确排除）
- 不加数据库 unique constraint（已在 spec 里明确排除，不做 migration）
- 参考实现必须对齐 `packages/brain/src/actions.js` `createTask()` 第107-118行的查询写法（`IS NOT DISTINCT FROM` 处理 null）

---

### Task 1: 去重查询 + 测试

**Files:**
- Modify: `packages/brain/src/routes/task-tasks.js`（`POST /` handler，第131-133行之间插入）
- Modify: `packages/brain/src/routes/__tests__/task-tasks.test.js`（全文件替换，见下方完整内容）

**Interfaces:**
- Consumes：`pool.query`（已在文件顶部 import，`import pool from '../db.js'`）
- Produces：无新增导出，只改动路由内部行为——命中去重时响应体新增 `deduplicated: true` 字段

- [ ] **Step 1: 写失败测试（含新增 dedup 测试 + 修复现有测试的 mock 调用序）**

用下面的完整内容**整体替换** `packages/brain/src/routes/__tests__/task-tasks.test.js`：

```javascript
/**
 * task-tasks.test.js (routes/__tests__) — lint-test-pairing 配套
 *
 * B51: harness_initiative 任务创建缺 journey_id 时返回 warnings 字段。
 * journey_id 顶层字段合并进 payload（Line 指挥页全景图关联）。
 * C3: POST /tasks 服务端去重护栏（issue 655691d2）——title+goal_id/project_id 精确匹配
 * + status IN (queued,in_progress) 命中则返回已有任务不新建。
 *
 * 注意：加了去重查询后，每个成功请求会先跑一次 SELECT（去重检查）再跑 INSERT，
 * 所以下面所有已有测试的 mock 调用顺序都要先给一次「无命中」的空结果
 * （mockResolvedValueOnce({ rows: [] })），INSERT 相关的 mock.calls 下标也从
 * [0] 移到 [1]。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../domain-detector.js', () => ({ detectDomain: () => ({ domain: 'agent_ops' }) }));

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../task-tasks.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/tasks', router);
  return app;
}

describe('task-tasks routes — B51 journey_id warning', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('harness_initiative 缺 journey_id → 201 + warnings', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'hi-1', title: 'Init', status: 'queued', task_type: 'harness_initiative' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Init',
      task_type: 'harness_initiative',
      payload: { sprint_dir: 'sprints/t' },
    });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings[0]).toMatch(/journey_id/);
  });

  it('harness_initiative 含 journey_id → 201 无 warnings', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'hi-2', title: 'Init', status: 'queued', task_type: 'harness_initiative' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Init',
      task_type: 'harness_initiative',
      payload: { sprint_dir: 'sprints/t', journey_id: 'j-1' },
    });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });

  it('非 harness_initiative 缺 journey_id → 无 warnings', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-1', title: 'Dev Task', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send({ title: 'Dev Task' });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
  });
});

describe('task-tasks routes — 顶层 journey_id 合并进 payload', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('顶层 journey_id → payload.journey_id 写入 INSERT', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-j1', title: 'Task with journey', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Task with journey',
      journey_id: 'j-line01',
    });
    expect(res.status).toBe(201);
    const [sql, params] = mockPool.query.mock.calls[1];
    expect(sql).toMatch(/payload/);
    const payloadArg = params.find(p => typeof p === 'string' && p.includes('journey_id'));
    expect(payloadArg).toBeTruthy();
    expect(JSON.parse(payloadArg)).toMatchObject({ journey_id: 'j-line01' });
  });

  it('顶层 journey_id 与已有 payload 合并（不覆盖其他字段）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-j2', title: 'Task', status: 'queued', task_type: 'harness_initiative' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Task',
      task_type: 'harness_initiative',
      journey_id: 'j-line04',
      payload: { sprint_dir: 'sprints/abc' },
    });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toBeUndefined();
    const [, params] = mockPool.query.mock.calls[1];
    const payloadArg = params.find(p => typeof p === 'string' && p.includes('journey_id'));
    const parsed = JSON.parse(payloadArg);
    expect(parsed).toMatchObject({ journey_id: 'j-line04', sprint_dir: 'sprints/abc' });
  });

  it('payload 已含 journey_id 且顶层无传 → 不被清除', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-j3', title: 'Task', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Task',
      payload: { journey_id: 'j-already', extra: 'data' },
    });
    expect(res.status).toBe(201);
    const [, params] = mockPool.query.mock.calls[1];
    const payloadArg = params.find(p => typeof p === 'string' && p.includes('journey_id'));
    expect(JSON.parse(payloadArg)).toMatchObject({ journey_id: 'j-already', extra: 'data' });
  });
});

describe('task-tasks routes — ability_id 十字边', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('创建任务时 ability_id 透传到 INSERT 参数并回显', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-9', title: 'Build douyin publish', status: 'queued', task_type: 'dev', ability_id: 'ab-1' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Build douyin publish',
      ability_id: 'ab-1',
    });
    expect(res.status).toBe(201);
    // INSERT 参数数组含 ability_id
    const params = mockPool.query.mock.calls[1][1];
    expect(params).toContain('ab-1');
    // SQL 文本含 ability_id 列
    expect(mockPool.query.mock.calls[1][0]).toMatch(/ability_id/);
    expect(res.body.ability_id).toBe('ab-1');
  });

  it('不传 ability_id 时为 null，不报错', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: 无命中
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'dev-10', title: 'Plain task', status: 'queued', task_type: 'dev', ability_id: null }],
    });
    const res = await request(app).post('/tasks').send({ title: 'Plain task' });
    expect(res.status).toBe(201);
    const params = mockPool.query.mock.calls[1][1];
    expect(params[params.length - 1]).toBeNull();
  });
});

describe('task-tasks routes — C3 服务端去重护栏（issue 655691d2）', () => {
  let app;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('同 title + 同 goal_id(null) + 同 project_id(null) + status=queued 已存在 → 200 + deduplicated:true，不新建', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'existing-1', title: 'nightly-real-machine-staging', status: 'queued',
        task_type: 'dev', priority: 'P1', project_id: null, area_id: null,
        goal_id: null, okr_initiative_id: null, ability_id: null, payload: null,
        created_at: '2026-07-09T00:00:00.000Z',
      }],
    });
    const res = await request(app).post('/tasks').send({ title: 'nightly-real-machine-staging' });
    expect(res.status).toBe(200);
    expect(res.body.deduplicated).toBe(true);
    expect(res.body.id).toBe('existing-1');
    // 去重命中就不应该再有第二次 query 调用（没有走 INSERT）
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('同 title 但已有任务是 completed 状态 → 不去重，正常走 INSERT', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: WHERE status IN (queued,in_progress) 查不到
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'new-1', title: 'skill-eval-4page', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send({ title: 'skill-eval-4page' });
    expect(res.status).toBe(201);
    expect(res.body.deduplicated).toBeUndefined();
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('title 不同 → 不去重，正常走 INSERT', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: title 不匹配查不到
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'new-2', title: 'decomp-check合并', status: 'queued', task_type: 'dev' }],
    });
    const res = await request(app).post('/tasks').send({ title: 'decomp-check合并' });
    expect(res.status).toBe(201);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('goal_id 不同（两者都非 null 但值不同）→ 不去重，正常走 INSERT', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // dedup: goal_id 不匹配查不到
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'new-3', title: 'Same title different goal', status: 'queued', task_type: 'dev', goal_id: 'goal-b' }],
    });
    const res = await request(app).post('/tasks').send({
      title: 'Same title different goal',
      goal_id: 'goal-b',
    });
    expect(res.status).toBe(201);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    // 去重查询的第二个参数应该是本次请求的 goal_id
    const dedupParams = mockPool.query.mock.calls[0][1];
    expect(dedupParams).toContain('goal-b');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/task-tasks.test.js`
Expected: 新增的"C3 服务端去重护栏"describe 块里的 4 个测试 FAIL（去重查询还不存在，`POST /tasks`
永远直接 INSERT，返回 201 而不是去重命中的 200，`mockPool.query` 调用次数不匹配预期）。
已有的其他 describe 块测试也会 FAIL（因为它们现在多 mock 了一次 `{rows:[]}` 但实际代码还只调用
一次 query，导致 mock 序列错位）——这是预期的，Step 4 实现后会一起变绿。

- [ ] **Step 3: 实现修复**

编辑 `packages/brain/src/routes/task-tasks.js`，在第131行（B51 warning 判断结束）之后、
第133行 `const result = await pool.query(` 之前，插入：

```js
    // C3: 服务端去重护栏（issue 655691d2）——title 精确匹配 + goal_id/project_id 一致
    // + 仍是活跃状态，命中则直接返回已有任务，不重新 INSERT。
    // 防止外部 agent/人工反复对同一意图重新注册 task（2026-07-09 实测 5 个重复 PR 的根因）。
    const dedupResult = await pool.query(
      `SELECT id, title, status, task_type, priority, project_id, area_id, goal_id, okr_initiative_id, ability_id, payload, created_at
       FROM tasks
       WHERE title = $1
         AND (goal_id IS NOT DISTINCT FROM $2)
         AND (project_id IS NOT DISTINCT FROM $3)
         AND status IN ('queued', 'in_progress')
       LIMIT 1`,
      [title.trim(), goal_id, project_id]
    );
    if (dedupResult.rows.length > 0) {
      return res.status(200).json({ ...dedupResult.rows[0], deduplicated: true });
    }

```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/task-tasks.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 跑 task-tasks 相关全部测试确认无回归**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/task-tasks*.test.js`
Expected: 全部 PASS（含本文件和其他 `task-tasks-*.test.js` 命名的兄弟测试文件，如果存在）

- [ ] **Step 6: Commit（TDD 两段式）**

```bash
git add packages/brain/src/routes/__tests__/task-tasks.test.js
git commit -m "test(brain): POST /tasks 服务端去重护栏失败测试(TDD red)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"

git add packages/brain/src/routes/task-tasks.js
git commit -m "fix(brain): task-tasks.js POST /tasks 补服务端去重护栏

issue 655691d2 根因：POST /api/brain/tasks 路由完全没有去重逻辑，
2026-07-09 实测同一功能需求被跨时间窗口独立重复点火3组（共5个冗余PR
已关闭）。对比同库 actions.js 的 createTask()（L107-118）已有精确
title+goal_id/project_id 匹配去重，这个路由是完全裸露的。

新增去重查询（仿 actions.js 模式）：title 精确匹配 + goal_id/project_id
一致（IS NOT DISTINCT FROM 处理 null）+ status IN (queued,in_progress)，
命中返回已有任务（200 + deduplicated:true）不重新 INSERT。

比已修的 /dev skill Phase 0(claim)/2.5(GitHub检查) 更底层——那两处是
skill 层客户端纪律，这里下沉到 API 本身，不管谁调用都拦得住。

已知不完整（spec 已明确排除，非本次范围）：只做精确 title 匹配不做
语义/模糊匹配；不加 DB 层 unique constraint，亚秒级并发竞态仍可能
双写——今天实测的重复都是分钟到小时级独立点火，本方案已覆盖真实场景。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
