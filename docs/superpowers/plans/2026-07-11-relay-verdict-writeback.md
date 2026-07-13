# PATCH relay-runs verdict/cost 写入 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** PATCH /api/brain/orchestrator/relay-runs/:initiative_id 接住 harness-controller 已在发送的 verdict/cost（及预留 evaluate_verdict），best-effort 落 initiative_runs.judge_verdict/evaluate_verdict/cost_usd。

**Architecture:** 单文件改动 packages/brain/src/routes/initiatives.js 的 PATCH handler：归一化（大写/Number），非法值忽略+warn+响应 warnings[]（绝不 400，防打回 phase=done 触发 watchdog 重点火），UPDATE 加三列 COALESCE，RETURNING 补三列。

**Tech Stack:** Express + pg pool；vitest + supertest + vi.mock('../db.js')。

## Global Constraints
- spec：docs/superpowers/specs/2026-07-11-relay-verdict-writeback-design.md（BLOCKER-1 铁律：新字段非法绝不 400）
- 合法值全大写：judge_verdict ∈ PASS/FAIL；evaluate_verdict ∈ PASS/FAIL/FIXED（migration 312 CHECK）
- COALESCE($n, col)：提供即覆盖、缺省保持；存量 NULL 不回填
- commit 顺序：commit-1 = 红测，commit-2 = 实现（TDD 铁律）
- 提交命令一律用 `git -C .` 形式（本仓 main-repo-write-guard 对裸 git 提交命令按文本匹配拦截）
- UPDATE 参数顺序：$1..$7 = [initiative_id, phase, failure_reason, pr_url, evaluateVerdict, judgeVerdict, costUsd]

---

### Task 1: 红测 — relay-runs-verdict-writeback.test.js

**Files:**
- Test: `packages/brain/src/__tests__/relay-runs-verdict-writeback.test.js`（新建）

**Interfaces:**
- Produces: 6 用例，断言 PATCH handler 的 SQL 文本与参数投影（params[4]=evaluate_verdict, params[5]=judge_verdict, params[6]=cost_usd）

- [ ] **Step 1: 写失败测试**（完整文件内容如下）

```js
/**
 * PATCH /api/brain/orchestrator/relay-runs/:initiative_id — verdict/cost 写入
 * P1 裁决结构化回写（spec 2026-07-11-relay-verdict-writeback-design.md）
 * TDD Red：handler 未扩字段前，SQL/参数断言全 FAIL
 * 铁律：verdict/cost 非法值绝不 400（否则打回 phase=done 终态 → watchdog 重点火）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

const INITIATIVE_ID = 'aaaabbbb-1111-2222-3333-444455556666';
const ROW = {
  id: 'r1', initiative_id: INITIATIVE_ID, phase: 'done', completed_at: null,
  failure_reason: null, pr_url: null, evaluate_verdict: null, judge_verdict: 'PASS', cost_usd: 1.23,
};

let app;
async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}
const lastCall = () => mockPool.query.mock.calls[mockPool.query.mock.calls.length - 1];

describe('PATCH /relay-runs/:id — verdict/cost best-effort 写入', () => {
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });

  it('verdict=PASS + cost=1.23 → 200，SQL 写 judge_verdict/cost_usd，参数投影正确', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [ROW] });
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', verdict: 'PASS', cost: 1.23, pr_url: 'https://github.com/x/y/pull/1' })
      .expect(200);
    const [sql, params] = lastCall();
    expect(sql).toMatch(/judge_verdict\s*=\s*COALESCE\(\$6,\s*judge_verdict\)/);
    expect(sql).toMatch(/evaluate_verdict\s*=\s*COALESCE\(\$5,\s*evaluate_verdict\)/);
    expect(sql).toMatch(/cost_usd\s*=\s*COALESCE\(\$7,\s*cost_usd\)/);
    expect(params[5]).toBe('PASS');
    expect(params[6]).toBe(1.23);
    expect(res.body).toHaveProperty('judge_verdict', 'PASS');
  });

  it('小写 verdict=pass → 归一大写 PASS 写入', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [ROW] });
    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', verdict: 'pass' })
      .expect(200);
    const [, params] = lastCall();
    expect(params[5]).toBe('PASS');
  });

  it('非法 verdict=MAYBE → 仍 200（phase 照写），judge_verdict 参数 null，响应含 warnings', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...ROW, judge_verdict: null }] });
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', verdict: 'MAYBE' })
      .expect(200);
    const [, params] = lastCall();
    expect(params[1]).toBe('done');
    expect(params[5]).toBeNull();
    expect(res.body.warnings).toContain('verdict_ignored');
  });

  it('cost 字符串 "1.23" 归一为数字；cost=-1 被忽略', async () => {
    mockPool.query.mockResolvedValue({ rows: [ROW] });
    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', cost: '1.23' })
      .expect(200);
    expect(lastCall()[1][6]).toBe(1.23);
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', cost: -1 })
      .expect(200);
    expect(lastCall()[1][6]).toBeNull();
    expect(res.body.warnings).toContain('cost_ignored');
  });

  it('evaluate_verdict=FIXED（合法前科值）→ 写入', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...ROW, evaluate_verdict: 'FIXED' }] });
    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'evaluate', evaluate_verdict: 'FIXED' })
      .expect(200);
    expect(lastCall()[1][4]).toBe('FIXED');
  });

  it('不带新字段 → 三个新参数全 null（现状行为不变，防回归）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [ROW] });
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done' })
      .expect(200);
    const [, params] = lastCall();
    expect(params[4]).toBeNull();
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
    expect(res.body).not.toHaveProperty('warnings');
  });
});
```

- [ ] **Step 2: 跑测确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/relay-runs-verdict-writeback.test.js`
Expected: 至少 5 用例 FAIL（SQL 无 COALESCE($5/$6/$7)、params 只有 4 个、无 warnings）

- [ ] **Step 3: 只提交测试（commit-1）**

```bash
git -C . add packages/brain/src/__tests__/relay-runs-verdict-writeback.test.js
git -C . commit -m "test(brain): relay-runs PATCH verdict/cost 写入红测（P1 裁决结构化回写 commit-1）"
```

---

### Task 2: 实现 — initiatives.js PATCH handler 扩三字段

**Files:**
- Modify: `packages/brain/src/routes/initiatives.js`（PATCH /relay-runs/:initiative_id handler，约 405-441 行）

**Interfaces:**
- Consumes: Task 1 参数顺序 $1..$7 = [initiative_id, phase, failure_reason, pr_url, evaluateVerdict, judgeVerdict, costUsd]
- Produces: 响应 row 增 evaluate_verdict/judge_verdict/cost_usd；有忽略字段时增 warnings: string[]

- [ ] **Step 1: 改 handler**。在现有 pr_url 校验之后、try 之前插入：

```js
  // ---- verdict/cost best-effort 归一（P1 裁决结构化回写）----
  // 铁律：非法值忽略+warn，绝不 400——400 会连带打回 phase=done 终态写入，
  // watchdog（phase NOT IN done/failed 判据）会把已完成 run 重新点火（spec BLOCKER-1）。
  const warnings = [];
  const normVerdict = (raw, allowed, field) => {
    if (raw === undefined || raw === null) return null;
    const v = String(raw).trim().toUpperCase();
    if (allowed.includes(v)) return v;
    console.warn(`[PATCH /orchestrator/relay-runs] ${field} 非法值被忽略: ${JSON.stringify(raw)}`);
    warnings.push(`${field}_ignored`);
    return null;
  };
  const judgeVerdict = normVerdict(req.body?.verdict, ['PASS', 'FAIL'], 'verdict');
  const evaluateVerdict = normVerdict(req.body?.evaluate_verdict, ['PASS', 'FAIL', 'FIXED'], 'evaluate_verdict');
  let costUsd = null;
  const rawCost = req.body?.cost;
  if (rawCost !== undefined && rawCost !== null) {
    const n = Number(rawCost);
    if (Number.isFinite(n) && n >= 0) {
      costUsd = n;
    } else {
      console.warn(`[PATCH /orchestrator/relay-runs] cost 非法值被忽略: ${JSON.stringify(rawCost)}`);
      warnings.push('cost_ignored');
    }
  }
```

UPDATE 语句改为（既有三行不动，追加三行 + RETURNING 扩列 + 参数扩 $7）：

```js
    const result = await pool.query(
      `UPDATE initiative_runs
         SET phase = $2,
             completed_at = CASE WHEN $2 IN ('done','failed') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
             failure_reason = COALESCE($3, failure_reason),
             pr_url = COALESCE($4, pr_url),
             evaluate_verdict = COALESCE($5, evaluate_verdict),
             judge_verdict = COALESCE($6, judge_verdict),
             cost_usd = COALESCE($7, cost_usd)
       WHERE initiative_id = $1 AND orchestrator_version = 'v2'
       RETURNING id, initiative_id, phase, completed_at, failure_reason, pr_url,
                 evaluate_verdict, judge_verdict, cost_usd`,
      [initiative_id, phase, failure_reason || null, pr_url || null, evaluateVerdict, judgeVerdict, costUsd]
    );
```

成功响应改为：

```js
    return res.json(warnings.length ? { ...result.rows[0], warnings } : result.rows[0]);
```

- [ ] **Step 2: 跑新测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/relay-runs-verdict-writeback.test.js`
Expected: 6 passed

- [ ] **Step 3: 跑相邻回归套件**

Run: `cd packages/brain && npx vitest run src/__tests__/relay-v101.test.js src/__tests__/relay-runs.test.js src/__tests__/relay-runs-create.test.js src/__tests__/relay-runs-filter.test.js src/__tests__/relay-runs-verdicts.test.js`
Expected: 全绿（relay-v101 的 params.toContain/SQL 正则断言不受追加参数影响——spec 已核）

- [ ] **Step 4: 提交实现（commit-2）**

```bash
git -C . add packages/brain/src/routes/initiatives.js
git -C . commit -m "feat(brain): PATCH relay-runs 接住 verdict/cost/evaluate_verdict——裁决结构化落库（P1 commit-2）"
```
