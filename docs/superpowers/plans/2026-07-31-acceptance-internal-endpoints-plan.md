# Acceptance 内网端点扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Brain 内网 acceptance router 补齐 Staff Hub 需要的三个端点（待验收清单/历史查询/结果提交），并把结果提交的核心业务逻辑抽成公网/内网共享的函数，同时堵住驳回任务并发重复创建的竞态窗口。

**Architecture:** `packages/brain/src/routes/acceptance.js` 单文件扩展，不新建文件。核心提交逻辑抽成 `submitAcceptanceResults(pool, results)` 纯函数（返回结果或抛 `AcceptanceResultsError`），公网 `POST /acceptance/results` 与新增内网 `POST /results` 都只做鉴权外壳+调用这个函数。`GET pending` 同理抽 `loadPendingRuns(pool)` 共享。新增 migration 374 加两列一索引。

**Tech Stack:** Express, node-postgres (pg Pool)，vitest + supertest（mock 单测）+ 真实 Postgres 集成测试。

---

### Task 1: Migration 374 — 新增列 + 驳回任务去重唯一索引

**Files:**
- Create: `packages/brain/migrations/374_acceptance_staff_hub_columns.sql`

- [ ] **Step 1: 写 migration 文件**

```sql
-- Migration 374: acceptance_checks 加 detail/submitted_by 列 + 驳回任务去重唯一索引
-- Staff Hub 验收终局（决策 fc7b5dc0）Brain 内网端点扩展所需

ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS detail JSONB;
ALTER TABLE acceptance_checks ADD COLUMN IF NOT EXISTS submitted_by TEXT;

-- 同一个 acceptance run（按 run_key）在任意时刻最多只能有一条未终态的 [验收驳回] 任务，
-- 堵住内网 POST /results 与公网 POST /acceptance/results 并发触发 failed 转变沿时
-- 重复 INSERT 出两条驳回任务的竞态窗口。
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_acceptance_rejection_open
  ON tasks ((payload->>'acceptance_run_key'))
  WHERE status NOT IN ('completed','failed','cancelled')
    AND payload->>'acceptance_run_key' IS NOT NULL;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('374', 'acceptance_checks detail/submitted_by columns + rejection task dedup index', NOW())
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: 本地跑 migration 验证（DB_NAME 必须 cecelia_scratch，禁用生产库）**

Run: `DB_NAME=cecelia_scratch node packages/brain/src/migrate.js`

Expected: 输出包含 `374` 应用成功，无报错

- [ ] **Step 3: 验证唯一索引真的能拦住重复行（手工 psql 验证，proven-to-fire）**

Run:
```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d cecelia_scratch -c "
INSERT INTO tasks (title, task_type, status, payload) VALUES ('t1','dev','queued','{\"acceptance_run_key\":\"proof-run-1\"}'::jsonb);
INSERT INTO tasks (title, task_type, status, payload) VALUES ('t2','dev','queued','{\"acceptance_run_key\":\"proof-run-1\"}'::jsonb);
"
```
Expected: 第二条 INSERT 报 `duplicate key value violates unique constraint "uq_tasks_acceptance_rejection_open"`（亲眼看它报红，证明索引真的生效，不是摆设）

Run 清理: `PGPASSWORD=postgres psql -h localhost -U postgres -d cecelia_scratch -c "DELETE FROM tasks WHERE payload->>'acceptance_run_key' = 'proof-run-1';"`

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/374_acceptance_staff_hub_columns.sql
git commit -m "feat(brain): migration 374 — acceptance detail/submitted_by 列 + 驳回任务去重索引"
```

---

### Task 2: 抽取共享核心函数 submitAcceptanceResults，修复驳回任务并发去重

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`
- Test: `packages/brain/src/routes/__tests__/acceptance-public.test.js`（既有测试作回归网，行为不能变）

**背景**：现有 `POST /acceptance/results`（公网 router，第 169-274 行）要抽成独立函数 `submitAcceptanceResults(pool, results)`，供公网/内网两个 handler 共用。同时把"驳回任务 INSERT"从裸写改成"INSERT 失败且 code===23505 时静默忽略"（Task 1 的唯一索引已经是真正的并发防线，SELECT 只是快速路径优化，不是唯一防线）。

- [ ] **Step 1: 先跑一次现有测试，确认基线全绿（重构前的安全网）**

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance-public.test.js`
Expected: 全部 PASS（这是本次重构不能破坏的行为基线）

- [ ] **Step 2: 在 acceptance.js 顶部新增 AcceptanceResultsError 类与共享函数**

在文件第 15 行 `async function safeRollback(client) {...}` 之后、`async function loadChecks` 之前插入：

```javascript
export class AcceptanceResultsError extends Error {
  constructor(status, body) {
    super(body?.error || 'acceptance_results_error');
    this.status = status;
    this.body = body;
  }
}

export async function submitAcceptanceResults(pool, results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new AcceptanceResultsError(400, { error: 'results must be a non-empty array' });
  }
  const invalid = [];
  for (const [i, r] of results.entries()) {
    if (!r || !r.check_key) invalid.push({ index: i, error: 'check_key required' });
    else if (!ACCEPTANCE_RESULTS.includes(r.result)) {
      invalid.push({ index: i, check_key: r.check_key, error: `result must be one of: ${ACCEPTANCE_RESULTS.join(',')}` });
    }
  }
  if (invalid.length > 0) throw new AcceptanceResultsError(400, { error: 'invalid results', invalid });

  const seen = new Set();
  for (const r of results) {
    if (r?.check_key) {
      if (seen.has(r.check_key)) {
        throw new AcceptanceResultsError(400, { error: 'duplicate check_key in batch', check_key: r.check_key });
      }
      seen.add(r.check_key);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keys = results.map((r) => r.check_key);
    const { rows: found } = await client.query(
      'SELECT check_key, run_id FROM acceptance_checks WHERE check_key = ANY($1)',
      [keys]
    );
    const foundKeys = new Set(found.map((r) => r.check_key));
    const missing = keys.filter((k) => !foundKeys.has(k));
    if (missing.length > 0) {
      await safeRollback(client);
      throw new AcceptanceResultsError(400, { error: 'unknown check_key', missing });
    }
    for (const r of results) {
      await client.query(
        `UPDATE acceptance_checks SET result = $1, note = $2, submitted_by = $3, decided_at = NOW(), updated_at = NOW()
         WHERE check_key = $4`,
        [r.result, r.note || null, r.submitted_by || null, r.check_key]
      );
    }
    const runIds = [...new Set(found.map((r) => r.run_id))];
    const updatedRuns = [];
    for (const runId of runIds) {
      const { rows: counts } = await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE result = '通过')::int AS pass,
                COUNT(*) FILTER (WHERE result = '不通过')::int AS fail,
                COUNT(*) FILTER (WHERE result IS NULL)::int AS pending
           FROM acceptance_checks WHERE run_id = $1`,
        [runId]
      );
      const { total, pass, fail, pending } = counts[0];
      const passRate = total > 0 ? pass / total : 0;
      const status = pending > 0 ? 'in_review' : fail > 0 ? 'failed' : pass === total ? 'passed' : 'in_review';
      const { rows: prevRows } = await client.query(
        'SELECT status, title, gp_id, run_key FROM acceptance_runs WHERE id = $1',
        [runId]
      );
      const prev = prevRows[0];
      const { rows: updated } = await client.query(
        `UPDATE acceptance_runs SET pass_rate = $1, status = $2, updated_at = NOW()
         WHERE id = $3 RETURNING run_key, pass_rate, status`,
        [passRate, status, runId]
      );
      updatedRuns.push(updated[0]);

      if (prev && prev.status !== 'failed' && status === 'failed') {
        const { rows: existingTask } = await client.query(
          `SELECT 1 FROM tasks
           WHERE payload->>'acceptance_run_key' = $1
             AND status NOT IN ('completed','failed','cancelled') LIMIT 1`,
          [prev.run_key]
        );
        if (existingTask.length === 0) {
          const { rows: failedChecks } = await client.query(
            `SELECT check_key, name, note FROM acceptance_checks
             WHERE run_id = $1 AND result = '不通过' ORDER BY check_key`,
            [runId]
          );
          const detail = failedChecks.map((c) => `${c.check_key} ${c.name}${c.note ? `（${c.note}）` : ''}`).join('\n');
          try {
            await client.query(
              `INSERT INTO tasks (title, description, task_type, priority, status, payload)
               VALUES ($1, $2, 'dev', 'P1', 'queued', $3::jsonb)`,
              [
                `[验收驳回] ${prev.title}`,
                `人工验收不通过，需修复后重新验收。GP: ${prev.gp_id || '未知'}，验收单: ${prev.run_key}。\n不通过项：\n${detail}`,
                JSON.stringify({ acceptance_run_key: prev.run_key, gp_id: prev.gp_id, source: 'acceptance_rejection', harness_mode: false }),
              ]
            );
          } catch (taskErr) {
            // 唯一索引 uq_tasks_acceptance_rejection_open 命中：另一并发路径已抢先开出驳回任务，幂等忽略
            if (taskErr.code !== '23505') throw taskErr;
          }
        }
      }
    }
    await client.query('COMMIT');
    return { updated: results.length, runs: updatedRuns };
  } catch (err) {
    await safeRollback(client);
    if (err instanceof AcceptanceResultsError) throw err;
    console.error('[acceptance] submitAcceptanceResults error:', err.message);
    throw new AcceptanceResultsError(500, { error: 'internal_error' });
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: 把公网 `POST /acceptance/results` 改成薄外壳调用共享函数**

把第 169-274 行的整个 `router.post('/acceptance/results', ...)` handler 体替换为：

```javascript
  router.post('/acceptance/results', async (req, res) => {
    try {
      const result = await submitAcceptanceResults(pool, req.body?.results);
      return res.json(result);
    } catch (err) {
      if (err instanceof AcceptanceResultsError) return res.status(err.status).json(err.body);
      console.error('[acceptance] public POST /results error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });
```

- [ ] **Step 4: 重跑 Step 1 的测试，确认重构未改变外部行为**

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance-public.test.js`
Expected: 全部仍 PASS（行为完全一致，只是内部实现换了）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/acceptance.js
git commit -m "refactor(brain): 抽取 submitAcceptanceResults 共享核心函数 + 驳回任务并发去重兜底"
```

---

### Task 3: 并发去重 proven-to-fire 测试

**Files:**
- Modify: `packages/brain/src/__tests__/integration/acceptance.integration.test.js`
- Modify: `packages/brain/src/routes/__tests__/acceptance-public.test.js`

- [ ] **Step 1: 写集成测试，证明唯一索引真的挡住重复驳回任务（先跑此测试确认它能复现问题）**

在 `acceptance.integration.test.js` 文件末尾（`describe` 块内最后一个 `it` 之后）新增：

```javascript
  it('并发场景：同一 run_key 两次插入未终态驳回任务，第二次必须撞唯一索引', async () => {
    const runKey = `${RUN_KEY}-dedup`;
    await pool.query(
      `INSERT INTO tasks (title, task_type, status, payload)
       VALUES ('probe-1', 'dev', 'queued', $1::jsonb)`,
      [JSON.stringify({ acceptance_run_key: runKey })]
    );
    await expect(
      pool.query(
        `INSERT INTO tasks (title, task_type, status, payload)
         VALUES ('probe-2', 'dev', 'queued', $1::jsonb)`,
        [JSON.stringify({ acceptance_run_key: runKey })]
      )
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query(`DELETE FROM tasks WHERE payload->>'acceptance_run_key' = $1`, [runKey]);
  });
```

Run: `npx vitest run packages/brain/src/__tests__/integration/acceptance.integration.test.js`
Expected: PASS（唯一索引在 Task 1 已迁移的前提下会真的拒绝第二条 INSERT——先确认这条测试本身在 migration 374 应用前会失败/在应用后会通过，验证测试确实在测这件事而不是空转）

- [ ] **Step 2: 写单元测试，证明 submitAcceptanceResults 遇到 23505 会静默忽略而不是抛 500**

在 `acceptance-public.test.js` 文件里新增一个 `describe` 块：

```javascript
import { submitAcceptanceResults } from '../acceptance.js';

describe('submitAcceptanceResults 驳回任务并发去重', () => {
  it('INSERT tasks 撞 23505 时静默忽略，整体仍返回成功', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
          return { rows: [{ check_key: 'r1:001', run_id: 'run-1' }] };
        }
        if (sql.includes('UPDATE acceptance_checks SET result')) return { rows: [] };
        if (sql.includes('SELECT COUNT(*)::int AS total')) {
          return { rows: [{ total: 1, pass: 0, fail: 1, pending: 0 }] };
        }
        if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
          return { rows: [{ status: 'pending', title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
        }
        if (sql.includes('UPDATE acceptance_runs SET pass_rate')) {
          return { rows: [{ run_key: 'r1', pass_rate: 0, status: 'failed' }] };
        }
        if (sql.includes("SELECT 1 FROM tasks")) return { rows: [] };
        if (sql.includes('SELECT check_key, name, note FROM acceptance_checks')) return { rows: [] };
        if (sql.includes('INSERT INTO tasks')) {
          const err = new Error('duplicate key');
          err.code = '23505';
          throw err;
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const result = await submitAcceptanceResults(pool, [{ check_key: 'r1:001', result: '不通过' }]);
    expect(result.updated).toBe(1);
    expect(result.runs[0].status).toBe('failed');
  });
});
```

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance-public.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/__tests__/integration/acceptance.integration.test.js packages/brain/src/routes/__tests__/acceptance-public.test.js
git commit -m "test(brain): 驳回任务并发去重 proven-to-fire 测试"
```

---

### Task 4: 新增内网 `POST /api/brain/acceptance/results`

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`
- Test: `packages/brain/src/routes/__tests__/acceptance.test.js`

- [ ] **Step 1: 写失败测试**

在 `acceptance.test.js` 文件末尾新增：

```javascript
describe('POST /api/brain/acceptance/results（内网版）', () => {
  it('提交子集判定项：200，返回更新后的 run', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) {
        return { rows: [{ check_key: 'r1:001', run_id: 'run-uuid-1' }] };
      }
      if (sql.includes('UPDATE acceptance_checks SET result')) return { rows: [] };
      if (sql.includes('SELECT COUNT(*)::int AS total')) {
        return { rows: [{ total: 2, pass: 1, fail: 0, pending: 1 }] };
      }
      if (sql.includes('SELECT status, title, gp_id, run_key FROM acceptance_runs')) {
        return { rows: [{ status: 'pending', title: 'T', gp_id: 'gp1', run_key: 'r1' }] };
      }
      if (sql.includes('UPDATE acceptance_runs SET pass_rate')) {
        return { rows: [{ run_key: 'r1', pass_rate: 0.5, status: 'in_review' }] };
      }
      return { rows: [] };
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/results')
      .send({ results: [{ check_key: 'r1:001', result: '通过', submitted_by: 'alice@zenjoymedia.media' }] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.runs[0].status).toBe('in_review');
  });

  it('未知 check_key：400', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('SELECT check_key, run_id FROM acceptance_checks')) return { rows: [] };
      return { rows: [] };
    });
    const res = await request(makeApp(makePool(client)))
      .post('/api/brain/acceptance/results')
      .send({ results: [{ check_key: 'ghost:001', result: '通过' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown check_key');
  });
});
```

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance.test.js`
Expected: FAIL（`404 Not Found`，路由还不存在）

- [ ] **Step 2: 在内网 router 里加路由（`GET /runs/:run_key` 之后、`return router;` 之前）**

```javascript
  router.post('/results', async (req, res) => {
    try {
      const result = await submitAcceptanceResults(pool, req.body?.results);
      return res.json(result);
    } catch (err) {
      if (err instanceof AcceptanceResultsError) return res.status(err.status).json(err.body);
      console.error('[acceptance] internal POST /results error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });
```

- [ ] **Step 3: 重跑测试确认通过**

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/routes/acceptance.js packages/brain/src/routes/__tests__/acceptance.test.js
git commit -m "feat(brain): 内网 POST /api/brain/acceptance/results — Staff Hub 直连结果提交"
```

---

### Task 5: 抽取 loadPendingRuns 共享函数 + 新增内网 `GET /api/brain/acceptance/pending`

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`
- Test: `packages/brain/src/routes/__tests__/acceptance.test.js`
- Test: `packages/brain/src/routes/__tests__/acceptance-public.test.js`（回归网）

- [ ] **Step 1: 先跑现有公网 pending 测试确认基线**

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance-public.test.js`
Expected: 全部 PASS

- [ ] **Step 2: 抽取共享函数（`loadChecks` 定义之后插入）**

```javascript
export async function loadPendingRuns(pool) {
  const { rows: runs } = await pool.query(
    `SELECT * FROM acceptance_runs WHERE status IN ('pending','in_review') ORDER BY created_at`
  );
  const ids = runs.map((r) => r.id);
  let checkRows = [];
  if (ids.length > 0) {
    const { rows } = await pool.query(
      'SELECT * FROM acceptance_checks WHERE run_id = ANY($1) ORDER BY check_key',
      [ids]
    );
    checkRows = rows;
  }
  const byRun = new Map(runs.map((r) => [r.id, { ...r, checks: [] }]));
  for (const c of checkRows) byRun.get(c.run_id)?.checks.push(c);
  return [...byRun.values()];
}
```

- [ ] **Step 3: 把公网 `GET /acceptance/pending` 改成薄外壳**

把现有 `router.get('/acceptance/pending', ...)` handler 体（第 146-167 行）替换为：

```javascript
  router.get('/acceptance/pending', async (_req, res) => {
    try {
      const runs = await loadPendingRuns(pool);
      return res.json({ runs });
    } catch (err) {
      console.error('[acceptance] GET /pending error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });
```

- [ ] **Step 4: 重跑公网测试确认行为不变**

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance-public.test.js`
Expected: PASS

- [ ] **Step 5: 写内网 pending 端点的失败测试**

在 `acceptance.test.js` 新增：

```javascript
describe('GET /api/brain/acceptance/pending（内网版）', () => {
  it('返回团队共享的待验收清单（pending/in_review），附判定项', async () => {
    const client = makeClient(() => undefined);
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql) => {
        if (sql.includes("status IN ('pending','in_review')")) {
          return { rows: [{ id: 'run-1', run_key: 'r1', status: 'in_review' }] };
        }
        if (sql.includes('WHERE run_id = ANY')) {
          return { rows: [{ run_id: 'run-1', check_key: 'r1:001' }] };
        }
        return { rows: [] };
      }),
    };
    const res = await request(makeApp(pool)).get('/api/brain/acceptance/pending');
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].checks).toHaveLength(1);
  });
});
```

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance.test.js`
Expected: FAIL（`404 Not Found`）

- [ ] **Step 6: 内网 router 加路由**

```javascript
  router.get('/pending', async (_req, res) => {
    try {
      const runs = await loadPendingRuns(pool);
      return res.json({ runs });
    } catch (err) {
      console.error('[acceptance] internal GET /pending error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });
```

- [ ] **Step 7: 重跑测试确认通过**

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance.test.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/brain/src/routes/acceptance.js packages/brain/src/routes/__tests__/acceptance.test.js
git commit -m "feat(brain): 内网 GET /api/brain/acceptance/pending — 抽取 loadPendingRuns 共享函数"
```

---

### Task 6: 新增内网 `GET /api/brain/acceptance/runs?gp_id=` 历史查询

**Files:**
- Modify: `packages/brain/src/routes/acceptance.js`
- Test: `packages/brain/src/routes/__tests__/acceptance.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
describe('GET /api/brain/acceptance/runs?gp_id=（历史查询）', () => {
  it('缺 gp_id：400', async () => {
    const client = makeClient(() => undefined);
    const res = await request(makeApp(makePool(client))).get('/api/brain/acceptance/runs');
    expect(res.status).toBe(400);
  });

  it('按 gp_id 查历史，按 created_at 倒序，附每单判定项', async () => {
    const client = makeClient((sql) => {
      if (sql.includes('WHERE gp_id = $1')) {
        return { rows: [
          { id: 'run-2', run_key: 'r2', gp_id: 'gp1', version: '1.22', created_at: '2026-07-20' },
          { id: 'run-1', run_key: 'r1', gp_id: 'gp1', version: '1.21', created_at: '2026-07-10' },
        ] };
      }
      if (sql.includes('WHERE run_id = ANY')) {
        return { rows: [{ run_id: 'run-2', check_key: 'r2:001', result: '通过' }] };
      }
      return { rows: [] };
    });
    const res = await request(makeApp(makePool(client)))
      .get('/api/brain/acceptance/runs')
      .query({ gp_id: 'gp1' });
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.runs[0].run_key).toBe('r2');
    expect(res.body.runs[0].checks).toHaveLength(1);
    expect(res.body.runs[1].checks).toHaveLength(0);
  });
});
```

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance.test.js`
Expected: FAIL（`404 Not Found`）

- [ ] **Step 2: 内网 router 加路由（`GET /runs/:run_key` 之前插入，避免 `/runs` 被误当成 `:run_key` 之外的静态段——Express 按注册顺序+段数匹配，两者不冲突，但为可读性放在前面）**

```javascript
  router.get('/runs', async (req, res) => {
    const { gp_id } = req.query;
    if (!gp_id) return res.status(400).json({ error: 'gp_id query param required' });
    const client = await pool.connect();
    try {
      const { rows: runs } = await client.query(
        'SELECT * FROM acceptance_runs WHERE gp_id = $1 ORDER BY created_at DESC',
        [gp_id]
      );
      const ids = runs.map((r) => r.id);
      let checkRows = [];
      if (ids.length > 0) {
        const { rows } = await client.query(
          'SELECT * FROM acceptance_checks WHERE run_id = ANY($1) ORDER BY check_key',
          [ids]
        );
        checkRows = rows;
      }
      const byRun = new Map(runs.map((r) => [r.id, { ...r, checks: [] }]));
      for (const c of checkRows) byRun.get(c.run_id)?.checks.push(c);
      return res.json({ runs: [...byRun.values()] });
    } catch (err) {
      console.error('[acceptance] GET /runs error:', err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });
```

- [ ] **Step 3: 重跑测试确认通过**

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/routes/acceptance.js packages/brain/src/routes/__tests__/acceptance.test.js
git commit -m "feat(brain): 内网 GET /api/brain/acceptance/runs?gp_id= — 验收历史查询"
```

---

### Task 7: smoke 脚本扩展 + 全量测试收尾

**Files:**
- Modify: `.github/workflows/scripts/smoke/acceptance-endpoints-smoke.sh`

- [ ] **Step 1: 读现有 smoke 脚本，追加新端点的最小校验**

在文件末尾追加（沿用文件已有的 `BASE_URL`/`curl` 惯例，若变量名不同以文件实际定义为准）：

```bash
echo "-- 内网 pending 端点存在性 --"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/brain/acceptance/pending")
[ "$STATUS" = "200" ] || { echo "FAIL: pending 端点非200，实得 $STATUS"; exit 1; }

echo "-- 内网历史查询缺 gp_id 应 400 --"
STATUS2=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/brain/acceptance/runs")
[ "$STATUS2" = "400" ] || { echo "FAIL: runs 缺gp_id应400，实得 $STATUS2"; exit 1; }

echo "-- 内网 results 端点空数组应 400 --"
STATUS3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/brain/acceptance/results" \
  -H "Content-Type: application/json" -d '{"results":[]}')
[ "$STATUS3" = "400" ] || { echo "FAIL: results 空数组应400，实得 $STATUS3"; exit 1; }

echo "acceptance-endpoints-smoke: Staff Hub 内网端点 PASS"
```

- [ ] **Step 2: 本地起 Brain 真实跑一次 smoke 脚本验证**

Run: `bash .github/workflows/scripts/smoke/acceptance-endpoints-smoke.sh`
Expected: 全部 PASS，无 FAIL 输出

- [ ] **Step 3: 全量测试跑一次**

Run: `npx vitest run packages/brain/src/routes/__tests__/acceptance.test.js packages/brain/src/routes/__tests__/acceptance-public.test.js packages/brain/src/__tests__/acceptance-aging.test.js packages/brain/src/__tests__/integration/acceptance.integration.test.js`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/scripts/smoke/acceptance-endpoints-smoke.sh
git commit -m "test(brain): smoke 脚本覆盖 Staff Hub 内网新端点"
```
