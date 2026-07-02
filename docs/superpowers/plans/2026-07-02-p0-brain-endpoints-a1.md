# P0 Brain 端点补齐（A1 硬前置）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two read-only Brain endpoints that A1 (harness-planner Step 0.4) depends on: per-journey golden-path aggregation and a clean invariant reader.

**Architecture:** Both endpoints go in `packages/brain/src/routes/abilities.js` (all golden_path / decisions read-write endpoints live there). Endpoint 1 joins `golden_path → tasks → journey_features` to aggregate a line's accepted behaviors, grouped by `owner_task_id` (ability:run = 1:N — grouping by ability would interleave order_no from different tasks). Endpoint 2 reads the `decisions` table (`category='invariant' AND status='active'`) — NOT the `decision_log` audit table that the broken `GET /decisions` reads.

**Tech Stack:** Node.js/Express, pg (mocked in tests), vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-07-02-p0-brain-endpoints-a1-design.md` (committed in this worktree).

**Worktree:** `/Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1` — Bash cwd resets to the main repo every call; prefix EVERY command with `cd /Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1 &&`.

---

### Task 1: Failing tests for both endpoints

**Files:**
- Modify: `packages/brain/src/routes/__tests__/abilities.test.js` (append new describe blocks at the end of the file, before the final closing)

- [ ] **Step 1: Read the current test file end**

Read `packages/brain/src/routes/__tests__/abilities.test.js` to find where the top-level `describe('abilities routes', ...)` block closes. The new describes go INSIDE that top-level describe (they reuse `mockQuery` reset from its `beforeEach`) or as sibling top-level describes — match whichever structure the file actually uses (it has a single top-level `describe('abilities routes', ...)`; append the two new `describe` blocks right before its closing `});`).

- [ ] **Step 2: Append the failing tests**

```javascript
  // ── P0（A1 硬前置）: GET /journeys/:journey_id/golden-paths ──
  describe('GET /journeys/:journey_id/golden-paths', () => {
    it('按 owner_task_id 分组聚合，附 ability 元数据，组内按 order_no 排序', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { ability_id: 'ab1', ability_name: '发抖音视频', ability_status: 'done', owner_task_id: 't1', id: 'g1', order_no: 1, feature_id: 'f1', note: 'step1' },
          { ability_id: 'ab1', ability_name: '发抖音视频', ability_status: 'done', owner_task_id: 't1', id: 'g2', order_no: 2, feature_id: 'f2', note: 'step2' },
          { ability_id: 'ab2', ability_name: '快手发布', ability_status: 'done', owner_task_id: 't2', id: 'g3', order_no: 1, feature_id: 'f3', note: 'other' },
        ],
      });
      const res = await (await req())(await makeApp()).get('/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const t1 = res.body.find((g) => g.owner_task_id === 't1');
      expect(t1.ability_id).toBe('ab1');
      expect(t1.ability_name).toBe('发抖音视频');
      expect(t1.ability_status).toBe('done');
      expect(t1.steps.map((s) => s.order_no)).toEqual([1, 2]);
      expect(t1.steps[0]).toEqual({ id: 'g1', order_no: 1, feature_id: 'f1', note: 'step1' });
      // SQL 走三表桥：golden_path → tasks(ability_id) → journey_features(journey_id)
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toMatch(/JOIN\s+tasks/i);
      expect(sql).toMatch(/JOIN\s+journey_features/i);
      expect(sql).toMatch(/journey_id/);
    });

    it('status 参数过滤 journey_features.status，且非法值 400', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const ok = await (await req())(await makeApp()).get('/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths?status=done');
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual([]);
      expect(mockQuery.mock.calls[0][1]).toContain('done');

      const bad = await (await req())(await makeApp()).get('/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths?status=nonsense');
      expect(bad.status).toBe(400);
    });

    it('非法 journey_id uuid → 400 而非 500', async () => {
      mockQuery.mockRejectedValueOnce(Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }));
      const res = await (await req())(await makeApp()).get('/api/brain/journeys/not-a-uuid/golden-paths');
      expect(res.status).toBe(400);
    });
  });

  // ── P0（A1 硬前置）: GET /invariants ──
  describe('GET /invariants', () => {
    it('读 decisions 表 category=invariant AND status=active，返回数组', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1', category: 'invariant', level: 'area', topic: '[系统]租户隔离' }] });
      const res = await (await req())(await makeApp()).get('/api/brain/invariants');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toMatch(/FROM\s+decisions/i);
      expect(sql).toMatch(/category\s*=\s*'invariant'/i);
      expect(sql).toMatch(/status\s*=\s*'active'/i);
      expect(sql).not.toMatch(/decision_log/i);
    });

    it('level 过滤进 SQL 参数；非法 level → 400', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const ok = await (await req())(await makeApp()).get('/api/brain/invariants?level=area');
      expect(ok.status).toBe(200);
      expect(mockQuery.mock.calls[0][1]).toContain('area');

      const bad = await (await req())(await makeApp()).get('/api/brain/invariants?level=galaxy');
      expect(bad.status).toBe(400);
    });

    it('target_type + target_id 过滤进 SQL 参数', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp()).get('/api/brain/invariants?target_type=journey_feature&target_id=ab1');
      expect(res.status).toBe(200);
      expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['journey_feature', 'ab1']));
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail (routes don't exist → 404)**

Run: `cd /Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1/packages/brain && npx vitest run src/routes/__tests__/abilities.test.js`
Expected: the 6 new tests FAIL (404 instead of 200/400 — routes not defined); all pre-existing tests still PASS.

- [ ] **Step 4: Commit (commit-1, test only)**

```bash
cd /Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1 && git add packages/brain/src/routes/__tests__/abilities.test.js && git commit -m "test: failing tests for journey golden-paths aggregation + invariants endpoints (A1 P0)"
```

---

### Task 2: Implement both endpoints

**Files:**
- Modify: `packages/brain/src/routes/abilities.js` (append before `export default router;`)

- [ ] **Step 1: Append the two routes**

Add right before `export default router;` (line ~270):

```javascript
// ---------- A1 P0 端点（harness 验证模型重构 HANDOFF 第 5 节）----------

// GET /api/brain/journeys/:journey_id/golden-paths?status=done
//   按 line 聚合已验收 ability 的 golden_path（累积 FR）。
//   桥：golden_path.owner_task_id → tasks.ability_id → journey_features.journey_id。
//   按 owner_task_id 分组（ability:run=1:N，按 ability 分组会让不同 task 的 order_no 交错）。
//   无匹配返回空数组（200，不报错）。
router.get('/journeys/:journey_id/golden-paths', async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !ABILITY_STATUS.includes(status))
      return res.status(400).json({ error: `status must be one of: ${ABILITY_STATUS.join(',')}` });
    const params = [req.params.journey_id];
    let sql = `
      SELECT jf.id AS ability_id, jf.name AS ability_name, jf.status AS ability_status,
             gp.owner_task_id, gp.id, gp.order_no, gp.feature_id, gp.note
      FROM golden_path gp
      JOIN tasks t ON gp.owner_task_id = t.id
      JOIN journey_features jf ON t.ability_id = jf.id
      WHERE jf.journey_id = $1`;
    if (status) { params.push(status); sql += ` AND jf.status = $${params.length}`; }
    sql += ` ORDER BY gp.owner_task_id, gp.order_no ASC`;
    let rows;
    try {
      ({ rows } = await pool.query(sql, params));
    } catch (err) {
      if (err.code === '22P02')
        return res.status(400).json({ error: `invalid journey_id: ${req.params.journey_id}` });
      throw err;
    }
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.owner_task_id)) {
        groups.set(r.owner_task_id, {
          ability_id: r.ability_id,
          ability_name: r.ability_name,
          ability_status: r.ability_status,
          owner_task_id: r.owner_task_id,
          steps: [],
        });
      }
      groups.get(r.owner_task_id).steps.push({
        id: r.id, order_no: r.order_no, feature_id: r.feature_id, note: r.note,
      });
    }
    res.json([...groups.values()]);
  } catch (err) {
    console.error('[abilities] GET /journeys/:journey_id/golden-paths error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/invariants?level=&target_type=&target_id=
//   干净的 invariant 读取端点：读 decisions 表（非 decision_log 审计表）。
//   替代坏的 GET /decisions?category=（status.js:270 读错表且忽略 category）。
router.get('/invariants', async (req, res) => {
  try {
    const { level, target_type, target_id } = req.query;
    if (level && !DECISION_LEVELS.includes(level))
      return res.status(400).json({ error: `level must be one of: ${DECISION_LEVELS.join(',')}` });
    const params = [];
    let sql = `SELECT * FROM decisions WHERE category='invariant' AND status='active'`;
    if (level)       { params.push(level);       sql += ` AND level=$${params.length}`; }
    if (target_type) { params.push(target_type); sql += ` AND target_type=$${params.length}`; }
    if (target_id)   { params.push(target_id);   sql += ` AND target_id=$${params.length}`; }
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /invariants error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Run the test file — all pass**

Run: `cd /Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1/packages/brain && npx vitest run src/routes/__tests__/abilities.test.js`
Expected: PASS (all, including the 6 new).

- [ ] **Step 3: Run the routes test directory for regressions**

Run: `cd /Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1/packages/brain && npx vitest run src/routes/__tests__/`
Expected: PASS (no new failures vs main).

- [ ] **Step 4: Commit (commit-2, implementation)**

```bash
cd /Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1 && git add packages/brain/src/routes/abilities.js && git commit -m "feat(brain): journey golden-paths aggregation + invariants endpoints (A1 P0)"
```

---

### Task 3: DevGate + real-machine verification

- [ ] **Step 1: DevGate**

Run: `cd /Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1 && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh`
Expected: all green (this PR adds routes only; no DEFINITION.md-tracked facts or versions change).

- [ ] **Step 2: Real verification against the running Brain**

The running `cecelia-node-brain` container serves the OLD code (image snapshot). To verify the new endpoints against real data WITHOUT redeploying, run the router in-place against the real DB via a scratch script — OR simpler and just as convincing: run the SQL directly. Do BOTH of these:

```bash
# (a) 聚合 SQL 真数据冒烟（Cecelia harness line）
psql -h localhost -U postgres -d cecelia -c "
SELECT jf.id AS ability_id, jf.name, gp.owner_task_id, gp.order_no
FROM golden_path gp
JOIN tasks t ON gp.owner_task_id = t.id
JOIN journey_features jf ON t.ability_id = jf.id
WHERE jf.journey_id = 'bb8cc561-b3ee-4fec-b74d-2255694bd963'
ORDER BY gp.owner_task_id, gp.order_no LIMIT 10;"

# (b) invariant SQL 真数据冒烟（应返回 7 行 area 级系统铁律）
psql -h localhost -U postgres -d cecelia -c "
SELECT count(*) FROM decisions WHERE category='invariant' AND status='active' AND level='area';"
```

Expected: (a) returns rows without error (may be 0 rows if that line has no golden_path yet — no-error is the assertion); (b) returns 7. Paste both outputs into the PR body. (Endpoint-level curl verification happens post-merge when brain-deploy rebuilds the image — the unit tests already assert the route wiring.)

---

### Task 4: Ship

- [ ] **Step 1: Push (run_in_background — pre-push quickcheck takes 5-10 min)**

```bash
cd /Users/administrator/worktrees/cecelia/p0-brain-endpoints-a1 && git push -u origin cp-0702105602-p0-brain-endpoints-a1
```

- [ ] **Step 2: PR + watchdog**

`gh pr create` per repo convention (title `feat(brain): journey golden-paths aggregation + invariants endpoints (A1 P0)`), then the post-PR hook forces `Skill(engine-pr-watchdog)` — block until merged.

- [ ] **Step 3: Post-merge**

Update `docs/current/harness-verify-redesign/HANDOFF.md` 第 5 节: P0 端点已补（附 PR 链接），A1 解除阻塞 — separate docs branch + PR per the no-main-commit rule.
