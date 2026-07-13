# T8: decisions 表去重 + 垃圾行清理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根治 decisions 表被 generateDecision 无条件 INSERT 灌水（9.6 万空白行），写入前同 trigger 内容比对去重 + 一次性 migration 清理历史垃圾行。

**Architecture:** 去重逻辑加在 `packages/brain/src/decision.js` 的 `generateDecision()` 内部（唯一写入点，覆盖 tick / consciousness_loop / manual 全部三个调用方）；用 PG jsonb 语义相等比较避免 JS 键序陷阱。历史清理走 migration 330（部署时自动执行）。push 前必须过独立 subagent 的 DELETE 复核门（主理人要求）。

**Tech Stack:** Node.js (ESM) / PostgreSQL / vitest（mock pool 模式，仿 `decision.test.js`）

Spec：`docs/superpowers/specs/2026-07-10-t8-decisions-dedup-cleanup-design.md`

---

### Task 1: 写入去重（TDD）

**Files:**
- Test: `packages/brain/src/__tests__/decision-dedup.test.js`（新建）
- Modify: `packages/brain/src/decision.js`（generateDecision，INSERT 前，约 295 行）

- [ ] **Step 1: 写 failing test**

```js
/**
 * Regression test: T8 decisions 表灌水去重
 * generateDecision 写入前必须比对同 trigger 上一条记录，内容相同跳过 INSERT。
 * 背景：consciousness_loop 每 20 分钟无条件写一条重复建议，累计 9.6 万垃圾行。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';
import { generateDecision } from '../decision.js';

/**
 * 按 SQL 文本路由 mock：
 * - goals UNION 查询 → 无活跃 goal（跳过 goal 循环）
 * - failed tasks 查询 → 1 个失败任务（产生 1 条 retry action）
 * - 去重前查（SELECT ... FROM decisions ... ORDER BY created_at DESC）→ 由各用例控制
 * - INSERT INTO decisions → 返回新 id
 */
function setupPool({ prevRows }) {
  pool.query.mockImplementation((sql) => {
    if (sql.includes('FROM key_results') || sql.includes('key_results')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("status = 'failed'")) {
      return Promise.resolve({ rows: [{ id: 'task-1', title: '失败任务', goal_id: null }] });
    }
    if (sql.includes('FROM decisions') && sql.includes('ORDER BY created_at DESC')) {
      return Promise.resolve({ rows: prevRows });
    }
    if (sql.includes('INSERT INTO decisions')) {
      return Promise.resolve({ rows: [{ id: 'new-decision-id' }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function insertCalls() {
  return pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO decisions'));
}

describe('generateDecision 写入去重（T8）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('上一条同 trigger 记录内容相同 → 跳过 INSERT，返回上一条 id + deduped', async () => {
    setupPool({ prevRows: [{ id: 'prev-decision-id', same: true }] });

    const result = await generateDecision({ trigger: 'consciousness_loop' });

    expect(insertCalls()).toHaveLength(0);
    expect(result.decision_id).toBe('prev-decision-id');
    expect(result.deduped).toBe(true);
    expect(result.actions).toHaveLength(1); // actions 照常返回，调用方 setGuidance 不受影响
  });

  it('上一条内容不同 → 照常 INSERT', async () => {
    setupPool({ prevRows: [{ id: 'prev-decision-id', same: false }] });

    const result = await generateDecision({ trigger: 'consciousness_loop' });

    expect(insertCalls()).toHaveLength(1);
    expect(result.decision_id).toBe('new-decision-id');
    expect(result.deduped).toBeUndefined();
  });

  it('无前置记录 → 照常 INSERT', async () => {
    setupPool({ prevRows: [] });

    const result = await generateDecision({ trigger: 'tick' });

    expect(insertCalls()).toHaveLength(1);
    expect(result.decision_id).toBe('new-decision-id');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/decision-dedup.test.js`
Expected: FAIL — 第 1 个用例 `insertCalls()` 长度为 1（当前代码无条件 INSERT）

- [ ] **Step 3: commit-1（failing test）**

```bash
git add packages/brain/src/__tests__/decision-dedup.test.js
git commit -m "test(brain): T8 failing test——generateDecision 同 trigger 内容相同应跳过 INSERT"
```

- [ ] **Step 4: 实现去重**

在 `packages/brain/src/decision.js` 的 `generateDecision()` 中，把现有 `// Store decision` INSERT 段改为：

```js
  // Determine if approval is required
  const requiresApproval = confidence < HIGH_CONFIDENCE_THRESHOLD ||
    actions.some(a => a.type === 'escalate');

  const contextPayload = {
    comparison_summary: comparison.overall_health,
    goal_count: comparison.goals.length
  };

  // T8 写入去重：同 trigger 上一条内容相同则跳过 INSERT（jsonb 语义相等，避免 JS 键序陷阱）
  // 背景：consciousness_loop 每 20 分钟触发一次，失败任务状态不变时内容完全重复，
  // 曾累计 9.6 万空白行（migration 330 已清理）。
  const prevResult = await pool.query(`
    SELECT id, (actions = $2::jsonb AND context = $3::jsonb) AS same
    FROM decisions
    WHERE trigger = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [trigger, JSON.stringify(actions), JSON.stringify(contextPayload)]);

  if (prevResult.rows[0]?.same) {
    return {
      decision_id: prevResult.rows[0].id,
      actions,
      confidence,
      requires_approval: requiresApproval,
      deduped: true,
      context: {
        trigger,
        overall_health: comparison.overall_health,
        goals_analyzed: comparison.goals.length
      }
    };
  }

  // Store decision
  const decisionResult = await pool.query(`
    INSERT INTO decisions (trigger, context, actions, confidence, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [
    trigger,
    JSON.stringify(contextPayload),
    JSON.stringify(actions),
    confidence,
    requiresApproval ? 'pending' : 'approved'
  ]);
```

注意：原代码里 `requiresApproval` 的计算在 INSERT 之前已存在——不要重复声明，把去重块插在它之后；原 INSERT 的 context 参数改用 `contextPayload` 变量（内容不变）。

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/decision-dedup.test.js src/__tests__/decision.test.js`
Expected: 全 PASS（含旧 decision.test.js 不回归）。禁止跑 brain 全量 vitest（OOM 前科）。

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/decision.js
git commit -m "fix(brain): generateDecision 同 trigger 内容去重，根治 decisions 表灌水"
```

---

### Task 2: 历史垃圾清理 migration

**Files:**
- Create: `packages/brain/migrations/330_decisions_blank_cleanup.sql`
- Test: `packages/brain/src/__tests__/decision-dedup.test.js`（追加一个 describe）

- [ ] **Step 1: 写 migration**

```sql
-- packages/brain/migrations/330_decisions_blank_cleanup.sql
-- T8 一次性清理：decisions 表历史空白垃圾行（topic/decision 均空的遥测记录）
-- 取证（2026-07-10）：96,322 行 = tick 93,702（05-04 后已停写）+ consciousness_loop 2,618（灌水源，
-- 已在 decision.js 加写入去重）+ NULL trigger 2。
-- trigger 白名单收紧：只删审计确认的三类来源，防止误删其他来源的空 topic 行。
-- 安全审计（addendum-01）：topic IS NULL 的行未被任何查询用 topic 做筛选条件。
DELETE FROM decisions
WHERE (topic IS NULL OR topic = '')
  AND (decision IS NULL OR decision = '')
  AND (trigger IN ('tick', 'consciousness_loop') OR trigger IS NULL);
```

- [ ] **Step 2: 给 migration 加守卫测试（追加到 decision-dedup.test.js 末尾）**

```js
describe('migration 330 清理条件（T8）', () => {
  it('DELETE 必须同时限定 topic 空 + decision 空 + trigger 白名单三重条件', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(
      new URL('../../migrations/330_decisions_blank_cleanup.sql', import.meta.url),
      'utf8'
    );
    expect(sql).toContain("(topic IS NULL OR topic = '')");
    expect(sql).toContain("(decision IS NULL OR decision = '')");
    expect(sql).toContain("trigger IN ('tick', 'consciousness_loop')");
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `cd packages/brain && npx vitest run src/__tests__/decision-dedup.test.js`
Expected: 全 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/migrations/330_decisions_blank_cleanup.sql packages/brain/src/__tests__/decision-dedup.test.js
git commit -m "feat(brain): migration 330 一次性清理 decisions 表 9.6 万历史空白行"
```

---

### Task 3: DELETE 复核门（主理人强制要求，push 前硬门槛）

**Files:** 无代码改动；产出复核结论（写入 handoff）

- [ ] **Step 1: 派独立 subagent 复核 DELETE WHERE 条件**

用 Agent tool 派一个独立 subagent（非主线程），prompt 要求它连生产 DB
（`PGPASSWORD=cecelia psql -h localhost -p 5432 -U cecelia -d cecelia`）执行只读复核：
1. 用 migration 330 完全相同的 WHERE 跑 `SELECT count(*)`，确认量级 ≈ 96,322
2. 抽样 ≥10 条待删行（含 tick / consciousness_loop / NULL trigger 三类），逐条确认无业务内容
3. 边界误删检查：会被删的行里有没有 `made_by='user'`、`category IS NOT NULL`、`topic 非空但 decision 空`（或反之）的行
4. 漏删检查：条件外是否还有 topic/decision 均空的残留行（预期只剩本条件覆盖不到的来源，应为 0 或可解释）
返回 PASS/FAIL + 证据。

- [ ] **Step 2: FAIL 则修正 WHERE 后重新复核；PASS 才允许进入 Task 4**

---

### Task 4: DevGate + 版本 bump + push + PR

- [ ] **Step 1: DevGate 三查**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全部通过（失败则按输出修复后重跑）

- [ ] **Step 2: brain 版本 bump（patch）**

按 `check-version-sync.sh` 要求同步四处版本号（packages/brain/package.json 等），commit：
```bash
git add -A && git commit -m "chore(brain): bump version for T8 decisions dedup"
```

- [ ] **Step 3: 语法冒烟（brain deploy 前置铁律）**

```bash
node --check packages/brain/src/decision.js && node --check packages/brain/src/server.js
```
Expected: 无输出（通过）

- [ ] **Step 4: push + 开 PR（走 finishing/engine-ship 链）**
