# Startup Self-PID Claimed_by Dead-Lock Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain 容器重启（PID 复用）后，启动时自动清除自身 claimerId 的旧 claimed_by，消除 queued 任务永久死锁。

**Architecture:** 修改 `cleanupStaleClaims`，在现有 60 分钟时间窗口扫描前新增 self-PID cleanup 步骤；更新现有测试兼容新调用序列，新增 3 个针对 self-PID 行为的测试。

**Tech Stack:** Node.js, vitest mock, PostgreSQL pool mock

---

### Task 1: 写失败测试（TDD 第一步）

**Files:**
- Modify: `packages/brain/src/__tests__/cleanup-stale-claims.test.js:1-131`

**背景：** 修复后 `cleanupStaleClaims` 的 `pool.query` 调用序列变为：
1. `UPDATE`（self-PID 清除，新增）→ returns `{ rowCount: N, rows: [] }`
2. `SELECT`（60 分钟窗口扫描，WHERE 新增 `claimed_by != $1` 排除 selfClaimerId）
3. `UPDATE`（清除其他旧 claim，如有）

现有测试基于「Call 1 = SELECT, Call 2 = UPDATE」结构，需同步更新。

- [ ] **Step 1: 在文件末尾 `describe` 块内新增 3 个 failing test**

在 `cleanup-stale-claims.test.js` 的 `describe('cleanupStaleClaims', () => {` 块末尾（最后一个 `});` 之前）插入：

```javascript
  describe('self-PID cleanup（容器重启 PID 复用场景）', () => {
    it('新鲜 claim（< 60 min）且 claimed_by = selfClaimerId → 被无条件清除', async () => {
      const mockQuery = vi.fn()
        // Call 1: self-PID UPDATE → cleaned 1 row
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'task-1' }] })
        // Call 2: SELECT 60-min scan → empty (no other stale)
        .mockResolvedValueOnce({ rows: [] });

      const result = await cleanupStaleClaims({ query: mockQuery });

      expect(result.cleaned).toBe(1);
      expect(result.errors).toHaveLength(0);

      // 第一次调用必须是 UPDATE，带当前 PID 的 claimerId
      const [selfUpdateSql, selfUpdateArgs] = mockQuery.mock.calls[0];
      expect(selfUpdateSql).toMatch(/UPDATE tasks/i);
      expect(selfUpdateSql).toMatch(/claimed_by = NULL/);
      expect(selfUpdateSql).toMatch(/status = 'queued'/);
      expect(selfUpdateSql).toMatch(/claimed_by = \$1/);
      // claimerId 格式：brain-tick-<pid>
      expect(selfUpdateArgs[0]).toMatch(/^brain-tick-\d+$/);
    });

    it('不同 claimerId 的新鲜 claim → 不被 self-PID UPDATE 清除', async () => {
      const mockQuery = vi.fn()
        // Call 1: self-PID UPDATE → 0 rows（无自身 PID 的旧 claim）
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        // Call 2: SELECT 60-min scan → empty（fresh claim 不在 60 min 窗口外）
        .mockResolvedValueOnce({ rows: [] });

      const result = await cleanupStaleClaims({ query: mockQuery });

      expect(result.cleaned).toBe(0);
      // self-PID UPDATE 的 $1 参数不含 other-claimerId
      const selfUpdateArgs = mockQuery.mock.calls[0][1];
      expect(selfUpdateArgs[0]).not.toBe('brain-tick-other');
    });

    it('self-PID cleanup 与 60-min 扫描累加 cleaned 计数', async () => {
      const mockQuery = vi.fn()
        // Call 1: self-PID UPDATE → 2 rows
        .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'a' }, { id: 'b' }] })
        // Call 2: SELECT 60-min → 1 row (other stale)
        .mockResolvedValueOnce({
          rows: [{ id: 'c', claimed_by: 'brain-tick-old', claimed_at: new Date('2020-01-01') }],
        })
        // Call 3: UPDATE → 1 row
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'c' }] });

      const result = await cleanupStaleClaims({ query: mockQuery });

      expect(result.cleaned).toBe(3); // 2 self-PID + 1 stale
      expect(result.errors).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: 运行新 tests，确认全部失败**

```bash
cd /Users/administrator/worktrees/cecelia/fix-startup-claimed-by-deadlock
npx vitest run packages/brain/src/__tests__/cleanup-stale-claims.test.js 2>&1 | tail -20
```

预期：3 个新 test FAIL（`cleanupStaleClaims` 未实现 self-PID 逻辑）

- [ ] **Step 3: 同步更新现有测试，兼容新调用序列**

现有测试基于旧调用序列（Call 1 = SELECT），需在每个 `mockQuery` 前面加 self-PID UPDATE 的 mock。

修改 `'发现 2 行 stale task → UPDATE 被调用且清 2 行'` 测试（当前约 L35-56）：

```javascript
  it('发现 2 行 stale task → UPDATE 被调用且清 2 行', async () => {
    const mockQuery = vi.fn()
      // Call 1: self-PID UPDATE → 0 rows（当前 test 不关注 self-PID 场景）
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2: SELECT 返回 2 行 stale
      .mockResolvedValueOnce({
        rows: [
          { id: 101, claimed_by: 'brain-tick-1', claimed_at: new Date('2020-01-01').toISOString() },
          { id: 102, claimed_by: 'brain-tick-2', claimed_at: null },
        ],
      })
      // Call 3: UPDATE 返回 rowCount=2
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 101 }, { id: 102 }] });

    const result = await cleanupStaleClaims({ query: mockQuery }, { staleMinutes: 60 });

    expect(result.cleaned).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // 第二次调用是 SELECT 带 staleMinutes 参数
    const [selectSql, selectArgs] = mockQuery.mock.calls[1];
    expect(selectSql).toMatch(/SELECT/i);
    expect(selectSql).toMatch(/claimed_by IS NOT NULL/);
    expect(selectSql).toMatch(/status = 'queued'/);
    expect(selectArgs[1]).toBe(60);

    // 第三次调用是 UPDATE
    const [updateSql, updateArgs] = mockQuery.mock.calls[2];
    expect(updateSql).toMatch(/UPDATE tasks/i);
    expect(updateSql).toMatch(/claimed_by = NULL/);
    expect(updateArgs[0]).toEqual([101, 102]);
  });
```

修改 `'SELECT 返回空 → cleaned=0 且不触发 UPDATE'` 测试：

```javascript
  it('SELECT 返回空 → cleaned=0 且不触发 UPDATE', async () => {
    const mockQuery = vi.fn()
      // Call 1: self-PID UPDATE → 0 rows
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // Call 2: SELECT → empty
      .mockResolvedValueOnce({ rows: [] });

    const result = await cleanupStaleClaims({ query: mockQuery });

    expect(result.cleaned).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/SELECT/i);
  });
```

修改其余使用 `mockResolvedValueOnce({ rows: [] })` 的测试（`'claimed_at 在 staleMinutes 内'`, `'SQL WHERE 子句含'`, `'staleMinutes 默认 60'`, `'自定义 staleMinutes'`），在每个 `mockQuery` 开头加：

```javascript
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // Call 1: self-PID UPDATE
```

并将 `selectArgs` 断言的下标从 `[0]` 改为 `[1]`（SELECT 现在是 Call 2）：
- `mockQuery.mock.calls[0][1]` → `mockQuery.mock.calls[1][1]`

- [ ] **Step 4: 运行全部 stale-claims 测试，确认全部失败（预期：新 3 个 FAIL，旧 7 个也 FAIL）**

```bash
cd /Users/administrator/worktrees/cecelia/fix-startup-claimed-by-deadlock
npx vitest run packages/brain/src/__tests__/cleanup-stale-claims.test.js 2>&1 | tail -30
```

预期：全部 test FAIL

- [ ] **Step 5: 提交 failing tests**

```bash
cd /Users/administrator/worktrees/cecelia/fix-startup-claimed-by-deadlock
git add packages/brain/src/__tests__/cleanup-stale-claims.test.js
git commit -m "test(brain): cleanupStaleClaims self-PID 清除行为测试（TDD 红灯）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 实现 self-PID cleanup

**Files:**
- Modify: `packages/brain/src/startup-recovery.js:257-305`

- [ ] **Step 1: 将 `cleanupStaleClaims` 函数替换为以下实现**

```javascript
export async function cleanupStaleClaims(pool, opts = {}) {
  const stats = { cleaned: 0, errors: [] };
  if (!pool || typeof pool.query !== 'function') {
    stats.errors.push('pool not provided');
    return stats;
  }

  const staleMinutes = Number.isFinite(opts.staleMinutes) ? opts.staleMinutes : 60;
  // Any queued task still claimed by THIS process's ID must be a leftover from a
  // previous crashed run (Docker Brain always starts as PID 7, so claimerId recurs).
  // Clear them unconditionally — we haven't made any claims yet at startup.
  const selfClaimerId = process.env.BRAIN_RUNNER_ID || `brain-tick-${process.pid}`;

  try {
    // Step 1: Clear all claims by this process's claimerId (previous-crash leftovers).
    const selfResult = await pool.query(
      `UPDATE tasks
          SET claimed_by = NULL, claimed_at = NULL
        WHERE status = 'queued'
          AND claimed_by = $1
      RETURNING id`,
      [selfClaimerId]
    );
    if (selfResult.rowCount > 0) {
      console.log(
        `[StartupRecovery:cleanupStaleClaims] cleared ${selfResult.rowCount} self-PID claims (${selfClaimerId})`,
        JSON.stringify({ cleanup_type: 'self_pid_claim', cleaned: selfResult.rowCount })
      );
      stats.cleaned += selfResult.rowCount;
    }

    // Step 2: Clear stale claims from other claimerIds (time-window based).
    const { rows } = await pool.query(
      `SELECT id, claimed_by, claimed_at
         FROM tasks
        WHERE status = 'queued'
          AND claimed_by IS NOT NULL
          AND claimed_by != $1
          AND (claimed_at IS NULL OR claimed_at < NOW() - ($2::int * INTERVAL '1 minute'))`,
      [selfClaimerId, staleMinutes]
    );

    if (rows.length === 0) {
      if (stats.cleaned === 0) {
        console.log('[StartupRecovery:cleanupStaleClaims] no stale claims found');
      }
      return stats;
    }

    const taskIds = rows.map(r => r.id);
    const result = await pool.query(
      `UPDATE tasks
          SET claimed_by = NULL,
              claimed_at = NULL
        WHERE id = ANY($1::uuid[])
      RETURNING id`,
      [taskIds]
    );

    const otherCleaned = result.rowCount || 0;
    stats.cleaned += otherCleaned;
    const sample = rows.slice(0, 5).map(r => `${r.id}@${r.claimed_by}`);
    console.log(
      `[StartupRecovery:cleanupStaleClaims] cleared ${otherCleaned} stale claims from other pids (staleMinutes=${staleMinutes})`,
      JSON.stringify({ cleanup_type: 'stale_claim', cleaned: otherCleaned, sample })
    );
  } catch (e) {
    stats.errors.push(e.message);
    console.warn('[StartupRecovery:cleanupStaleClaims] failed:', e.message);
  }

  return stats;
}
```

- [ ] **Step 2: 运行全部 stale-claims 测试，确认全部通过**

```bash
cd /Users/administrator/worktrees/cecelia/fix-startup-claimed-by-deadlock
npx vitest run packages/brain/src/__tests__/cleanup-stale-claims.test.js 2>&1 | tail -20
```

预期：`10 passed`（原 7 + 新 3）

- [ ] **Step 3: 运行 brain-unit 全量测试确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/fix-startup-claimed-by-deadlock
npx vitest run packages/brain 2>&1 | tail -10
```

预期：pass 数量与 main 基线持平或更多

- [ ] **Step 4: 提交实现**

```bash
cd /Users/administrator/worktrees/cecelia/fix-startup-claimed-by-deadlock
git add packages/brain/src/startup-recovery.js
git commit -m "fix(brain): cleanupStaleClaims 启动时无条件清除 self-PID claimed_by 死锁

Docker 容器中 Brain 始终以 PID 7 启动，claimerId brain-tick-7 在重启后循环复用，
60 分钟时间窗口无法清除新近崩溃的 self-PID claims，导致 queued 任务永久锁死。

修法：在 60 分钟扫描之前，先无条件清除 claimed_by = selfClaimerId 的所有
queued 任务（这些必定是上次崩溃的遗留，当前进程还未做任何 claim）。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
