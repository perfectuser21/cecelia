# harness 生命周期代码闸（刀B+刀C+收账权收归）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 harness pipeline 的生命周期/记账/验收判据从 SKILL 文本下沉为 Brain 代码机械闸（决策 dc18d43d）。

**Architecture:** 三块：①judge API 进 DeepSeek 前加纯代码机械闸（runMechanicalGate）②spawn 补 current_task_id / judge 自写 judge_verdict / skill-relay-spawn 事件三口收尾 ③新增 lib/harness-finalize.js 统一核验外部真相（PR MERGED + evaluator gate），四个 completed 入口全部接它。设计 SSOT：docs/superpowers/specs/2026-07-14-harness-lifecycle-gates-design.md。

**Tech Stack:** Node ESM + vitest（mock pool，范式取 packages/brain/src/__tests__/harness-relay-watchdog.test.js 的 vi.hoisted + 按 SQL 分派）。所有测试在 `cd packages/brain && npx vitest run <file>` 下跑。

**铁律：**
- TDD 死序：commit-1 = failing test（红）→ commit-2 = 实现（绿）。NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。
- 所有输出简体中文；不改任何 SKILL 文本（EVA v3 前冻结）。
- 每个 UPDATE/INSERT 用参数化占位符。
- non-fatal 原则：闸内 DB 副作用失败只 warn 不吞主裁决。

---

### Task 1: migration 342 — decisions.source_ref 列 + POST 写入口

**Files:**
- Create: `packages/brain/migrations/342_decisions_source_ref.sql`
- Modify: `packages/brain/src/routes/strategic-decisions.js:73-103`（POST /）
- Test: `packages/brain/src/routes/__tests__/strategic-decisions-source-ref.test.js`

- [ ] **Step 1: failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

const { default: router } = await import('../strategic-decisions.js');

// 直接从 router 栈取 POST / handler（与本仓 tasks-result-backfill.test.js 同法）
function findHandler(method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

describe('POST /strategic-decisions source_ref 写入口（刀B judgments 对账地基）', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'x' }] });
  });

  it('body 带 source_ref → INSERT 列含 source_ref 且参数透传', async () => {
    const handler = findHandler('post', '/');
    const res = mockRes();
    await handler({ body: { topic: 't', decision: 'd', category: 'judgment', source_ref: 'task-abc' } }, res);
    const call = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decisions/.test(sql));
    expect(call).toBeTruthy();
    expect(call[0]).toMatch(/source_ref/);
    expect(call[1]).toContain('task-abc');
  });

  it('body 不带 source_ref → 参数为 null，不报错', async () => {
    const handler = findHandler('post', '/');
    const res = mockRes();
    await handler({ body: { topic: 't', decision: 'd' } }, res);
    const call = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decisions/.test(sql));
    expect(call[0]).toMatch(/source_ref/);
    expect(call[1]).toContain(null);
  });
});
```

- [ ] **Step 2: 跑红** `cd packages/brain && npx vitest run src/routes/__tests__/strategic-decisions-source-ref.test.js` — 期望 FAIL（INSERT 无 source_ref）。commit-1：`test(brain): 刀B地基 decisions.source_ref 写入口 failing test [d0a668d9]`
- [ ] **Step 3: 实现**

migration `342_decisions_source_ref.sql`：
```sql
-- Migration 342: decisions 表加 source_ref（harness judgments 对账回指，设计 2026-07-14-harness-lifecycle-gates）
-- 注意：migration 302 只加了 level/target_type/target_id/scope，没有 source_ref（勿混）。
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_decisions_source_ref ON decisions (source_ref) WHERE source_ref IS NOT NULL;
```

strategic-decisions.js POST：解构加 `source_ref = null`，INSERT 列表加 `source_ref`、VALUES 加 `$12`（decided_at 顺延 $13？——注意现有 12 参 `'user'` 是字面量 trigger，实际占位符只有 $1-$11；把 source_ref 追加为 $12，params 数组尾部 push source_ref）。

- [ ] **Step 4: 跑绿** 同命令，期望 PASS。
- [ ] **Step 5: commit-2** `feat(brain): migration 342 decisions.source_ref + POST 写入口 [d0a668d9]`

---

### Task 2: 刀B — runMechanicalGate 机械闸

**Files:**
- Modify: `packages/brain/src/harness-judge.js`（新增 export runMechanicalGate + runJudgeGate 接线）
- Modify: `packages/brain/src/routes/harness.js:1886-1897`（/judge 传 dbPool）
- Test: `packages/brain/src/__tests__/harness-judge-mechanical-gate.test.js`

- [ ] **Step 1: failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { runMechanicalGate, runJudgeGate } from '../harness-judge.js';

// 通用 fixture：一个"全部合规"的输入，逐项破坏测各断言
function goodCtx(overrides = {}) {
  return {
    taskId: 'task-1111',
    worktreePath: '/wt',
    sprintDir: 'sprints/x',
    brainResult: { verdict: 'PASS', exit_code: 0, log_tail: 'npm test ok', judgments_written: 2, ...(overrides.brainResult || {}) },
    ...overrides,
  };
}

function makeDeps({ testFiles = ['a.test.ts'], behaviorCount = 3, env = 'local_api', judgmentRows = 2 } = {}) {
  return {
    // 注入文件扫描（生产实现真扫盘；测试注入）
    listTestFilesFn: vi.fn(async () => testFiles),
    readFileFn: vi.fn(async (p) => {
      if (String(p).includes('contract-dod')) return Array(behaviorCount).fill('- [ ] [BEHAVIOR] x').join('\n');
      throw new Error('ENOENT');
    }),
    dbPool: { query: vi.fn(async (sql) => {
      if (/target_environment|FROM tasks/.test(sql)) return { rows: [{ target_environment: env }] };
      if (/COUNT.*FROM decisions/is.test(sql)) return { rows: [{ count: String(judgmentRows) }] };
      return { rows: [] };
    }) },
  };
}

describe('runMechanicalGate（刀B：DeepSeek 前纯代码闸）', () => {
  it('全部合规 → pass:true', async () => {
    const r = await runMechanicalGate(goodCtx(), makeDeps());
    expect(r.pass).toBe(true);
  });

  it('behavior_tests=0（无测试文件且 contract-dod 无 [BEHAVIOR]）→ FAIL', async () => {
    const deps = makeDeps({ testFiles: [], behaviorCount: 0 });
    deps.readFileFn = vi.fn(async () => { throw new Error('ENOENT'); });
    const r = await runMechanicalGate(goodCtx(), deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/behavior_tests/);
  });

  it('.brain-result.json 缺 exit_code → FAIL', async () => {
    const ctx = goodCtx(); delete ctx.brainResult.exit_code;
    const r = await runMechanicalGate(ctx, makeDeps());
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/exit_code/);
  });

  it('local_api 环境 log_tail 空但有命令输出（agentStdout）→ 不误杀', async () => {
    const ctx = goodCtx({ agentStdout: '$ npm test\nall pass' }); ctx.brainResult.log_tail = '';
    const r = await runMechanicalGate(ctx, makeDeps({ env: 'local_api' }));
    expect(r.pass).toBe(true);
  });

  it('windows_wechat 真机环境 log_tail 空 → FAIL（证据要求按环境校准）', async () => {
    const ctx = goodCtx({ agentStdout: 'x' }); ctx.brainResult.log_tail = '';
    const r = await runMechanicalGate(ctx, makeDeps({ env: 'windows_wechat' }));
    expect(r.pass).toBe(false);
  });

  it('judgments_written=5 声明 > decisions 回读 0 → FAIL', async () => {
    const ctx = goodCtx(); ctx.brainResult.judgments_written = 5;
    const r = await runMechanicalGate(ctx, makeDeps({ judgmentRows: 0 }));
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/judgments/);
  });

  it('无 judgments_written 声明 → 该项跳过不 FAIL', async () => {
    const ctx = goodCtx(); delete ctx.brainResult.judgments_written;
    const r = await runMechanicalGate(ctx, makeDeps({ judgmentRows: 0 }));
    expect(r.pass).toBe(true);
  });

  it('target_environment 缺省 → 按 local_api 最宽口径', async () => {
    const deps = makeDeps();
    deps.dbPool.query = vi.fn(async (sql) => {
      if (/FROM tasks/.test(sql)) return { rows: [] }; // task 查不到 env
      if (/COUNT.*FROM decisions/is.test(sql)) return { rows: [{ count: '2' }] };
      return { rows: [] };
    });
    const ctx = goodCtx({ agentStdout: 'cmd out' }); ctx.brainResult.log_tail = '';
    const r = await runMechanicalGate(ctx, deps);
    expect(r.pass).toBe(true);
  });
});

describe('runJudgeGate 接线：机械闸 FAIL → 不调 DeepSeek', () => {
  it('behavior_tests=0 时 judgeFn 零调用且 verdict=FAIL judged=true', async () => {
    const judgeFn = vi.fn();
    const r = await runJudgeGate(
      { agentVerdict: 'PASS', worktreePath: '/wt', sprintDir: 'sprints/x', taskId: 't1',
        brainResult: { verdict: 'PASS', exit_code: 0, log_tail: 'ok' } },
      {
        judgeFn,
        listTestFilesFn: async () => [],
        collectEvidence: async () => ({ contractE2E: 'e2e', goldenPathSteps: ['s1'], transcript: '', agentStdout: '', brainResult: { verdict: 'PASS', exit_code: 0, log_tail: 'ok' } }),
        readFileFn: async () => { throw new Error('ENOENT'); },
        dbPool: { query: async () => ({ rows: [] }) },
      }
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.judged).toBe(true);
    expect(judgeFn).not.toHaveBeenCalled();
  });

  it('agentVerdict=FAIL 仍旧直接透传（机械闸只管 PASS 复核路径）', async () => {
    const r = await runJudgeGate({ agentVerdict: 'FAIL', agentFeedback: 'x' }, {});
    expect(r.verdict).toBe('FAIL');
    expect(r.judged).toBe(false);
  });
});
```

- [ ] **Step 2: 跑红**（runMechanicalGate 未定义）。commit-1：`test(brain): 刀B judge 机械闸 failing tests [d0a668d9]`
- [ ] **Step 3: 实现（harness-judge.js）**

新增（放在 runJudgeGate 之前）：

```js
// ── 刀B：机械闸（决策 dc18d43d 无闸不成文）。纯代码判定，在 DeepSeek 之前执行；
// 任一不过 → FAIL 打回 fix loop，不浪费裁判调用。证据要求按 target_environment 校准（铁律 9216d107）。
const DEVICE_LOG_ENVS = new Set(['windows_wechat']); // 真机环境：log_tail 必须来自 .brain-result.json 本体
const TEST_FILE_RE = /\.test\.(ts|js|mjs|sh)$/;

async function defaultListTestFiles(worktreePath, sprintDir) {
  const { readdir } = await import('node:fs/promises');
  const roots = [path.join(worktreePath, sprintDir, 'tests'), path.join(worktreePath, sprintDir)];
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (TEST_FILE_RE.test(e.name)) found.push(full);
    }
  };
  for (const r of roots) await walk(r, 0);
  return [...new Set(found)];
}

export async function runMechanicalGate(ctx, deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFile(p, 'utf8'));
  const listTestFilesFn = deps.listTestFilesFn || ((wt, sd) => defaultListTestFiles(wt, sd));
  const dbPool = deps.dbPool || null;
  const reasons = [];
  const br = ctx.brainResult || {};

  // 1. behavior_tests 非空：测试文件 或 contract-dod [BEHAVIOR] 条目，二者全 0 → FAIL
  let testCount = 0;
  try { testCount = (await listTestFilesFn(ctx.worktreePath, ctx.sprintDir)).length; } catch { testCount = 0; }
  if (testCount === 0) {
    let behaviorCount = 0;
    try {
      const dod = await readFileFn(path.join(ctx.worktreePath, ctx.sprintDir, 'contract-dod.md'));
      behaviorCount = (String(dod).match(/\[BEHAVIOR\]/g) || []).length;
    } catch { behaviorCount = 0; }
    if (behaviorCount === 0) reasons.push('behavior_tests=0：sprint 无 *.test.{ts,js,mjs,sh} 且 contract-dod.md 无 [BEHAVIOR] 条目');
  }

  // 2. verdict 证据完整（按 target_environment 校准）
  let env = 'local_api';
  if (dbPool && ctx.taskId) {
    try {
      const q = await dbPool.query(`SELECT payload->>'target_environment' AS target_environment FROM tasks WHERE id = $1`, [ctx.taskId]);
      env = q.rows?.[0]?.target_environment || 'local_api';
    } catch { env = 'local_api'; }
  }
  if (br.exit_code === undefined || br.exit_code === null) {
    reasons.push('.brain-result.json 缺 exit_code（0 也必须写）');
  }
  const logTail = String(br.log_tail || '').trim();
  const fallbackOut = String(ctx.agentStdout || ctx.transcript || '').trim();
  if (!logTail && (DEVICE_LOG_ENVS.has(env) || !fallbackOut)) {
    reasons.push(DEVICE_LOG_ENVS.has(env)
      ? `log_tail 为空：target_environment=${env} 为真机环境，必须携带设备端日志`
      : 'log_tail 为空且无任何命令输出转录（agentStdout/transcript 皆空）');
  }

  // 3. judgments_written 对账（无声明→跳过；有声明→回读 decisions.source_ref 计数）
  const declared = br.judgments_written;
  if (declared !== undefined && declared !== null && dbPool && ctx.taskId) {
    try {
      const q = await dbPool.query(
        `SELECT COUNT(*)::int AS count FROM decisions WHERE category = 'judgment' AND source_ref = $1`,
        [String(ctx.taskId)]
      );
      const actual = Number(q.rows?.[0]?.count ?? 0);
      if (Number(declared) > actual) {
        reasons.push(`judgments_written 虚报：声明 ${declared} 条，decisions 表回读 ${actual} 条（category=judgment AND source_ref=task_id）`);
      }
    } catch (err) {
      console.warn(`[judge][mechanical] judgments 对账查询失败（non-fatal，跳过该项）：${err.message}`);
    }
  }

  return { pass: reasons.length === 0, reasons, env };
}
```

runJudgeGate 接线（在 `const ev = await collectFn(...)` 之后、证据门之前插入）：

```js
  // 刀B：机械闸先行（纯代码，FAIL 不调 DeepSeek）
  const mech = await runMechanicalGate(
    { ...ctx, brainResult: ev.brainResult || ctx.brainResult, agentStdout: ev.agentStdout, transcript: ev.transcript },
    opts
  );
  if (!mech.pass) {
    const fb = `机械闸 FAIL（无闸不成文 dc18d43d）：\n- ${mech.reasons.join('\n- ')}`;
    await persistJudgeArtifact({
      worktreePath: ctx.worktreePath,
      instanceLabel: ctx.instanceLabel,
      payload: { agentVerdict, mechanicalGate: mech, finalVerdict: 'FAIL' },
    }, opts);
    console.warn(`[judge] 机械闸 FAIL → 不调 DeepSeek：${mech.reasons.join('；')}`);
    return { verdict: 'FAIL', feedback: fb, judged: true };
  }
```

routes/harness.js /judge 的 runJudgeGate 调用 opts 加 `dbPool: pool`（第二参数传 `{ dbPool: pool }`）。

- [ ] **Step 4: 跑绿** + 全量回归 `npx vitest run src/__tests__/harness-judge*.test.js src/__tests__/harness-judge-cli*.test.js`（如有既有 judge 测试必须仍绿）。
- [ ] **Step 5: commit-2** `feat(brain): 刀B judge API 机械闸——behavior_tests/证据/judgments 对账 [d0a668d9]`

---

### Task 3: 刀C1+C2 — current_task_id 补写 + judge_verdict 自写

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js:296-301`（codex INSERT）与 `:546-551`（headed INSERT）
- Modify: `packages/brain/src/routes/harness.js`（/judge 返回前自写 judge_verdict）
- Test: `packages/brain/src/__tests__/harness-relay-current-task-id.test.js`

- [ ] **Step 1: failing test**

```js
import { describe, it, expect, vi } from 'vitest';

describe('C1: spawn INSERT initiative_runs 带 current_task_id', () => {
  it('既有 harness-skill-relay 测试文件中 INSERT 断言需扩展——本文件直接断言 SQL 文本', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../harness-skill-relay.js', import.meta.url), 'utf8');
    const inserts = src.match(/INSERT INTO initiative_runs[\s\S]{0,400}?\)/g) || [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const ins of inserts) {
      expect(ins).toMatch(/current_task_id/);
    }
  });
});
```

> 注：C1 的行为级断言走既有 `harness-skill-relay.test.js` 的 happy path 用例扩展（该文件已有"INSERT INTO initiative_runs"断言，给它加 current_task_id 参数检查）；上面的源码级断言是防回退哨兵。

C2 测试加进 `packages/brain/src/routes/__tests__/harness-judge-verdict-writeback.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));
// judge 门直接注入：返回 judged:true PASS
vi.mock('../../harness-judge.js', () => ({
  runJudgeGate: vi.fn(async () => ({ verdict: 'PASS', feedback: null, judged: true })),
}));

describe('C2: /judge 判定后自写 initiative_runs.judge_verdict', () => {
  beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [], rowCount: 0 }); });

  it('judged=true → UPDATE initiative_runs SET judge_verdict，条件含 current_task_id 与 IS DISTINCT FROM', async () => {
    const { default: router } = await import('../harness.js');
    const layer = router.stack.find((l) => l.route && l.route.path === '/judge' && l.route.methods.post);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await handler({ body: { task_id: 't-1', sprint_dir: 's', worktree: process.cwd(), agent_verdict: 'PASS' } }, res);
    const upd = mockQuery.mock.calls.find(([sql]) => /UPDATE initiative_runs\s+SET judge_verdict/i.test(sql));
    expect(upd).toBeTruthy();
    expect(upd[0]).toMatch(/current_task_id/);
    expect(upd[0]).toMatch(/IS DISTINCT FROM 'PASS'/);
    expect(res.json).toHaveBeenCalled(); // 裁决照常返回
  });

  it('judge_verdict UPDATE 抛错 → non-fatal，res.json 仍带 verdict', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const { default: router } = await import('../harness.js');
    const layer = router.stack.find((l) => l.route && l.route.path === '/judge' && l.route.methods.post);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    await handler({ body: { task_id: 't-1', sprint_dir: 's', worktree: process.cwd(), agent_verdict: 'PASS' } }, res);
    expect(res.json).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑红**。commit-1：`test(brain): 刀C1/C2 current_task_id+judge_verdict 自写 failing tests [d0a668d9]`
- [ ] **Step 3: 实现**

harness-skill-relay.js 两处 INSERT 改为（codex 处，headed 同理加 current_task_id 列与参数）：

```js
      `INSERT INTO initiative_runs
         (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at, ability_id, current_task_id)
       VALUES ($1, 'A_planning', $2, 'v2', $3, NOW() + INTERVAL '${deadlineHours} hours', $4, $5)`,
      [initiativeId, task.payload?.journey_id || null, orchestratorHost, abilityId, task.id]
```

routes/harness.js /judge 在 `return res.json(result)` 之前插入：

```js
    // C2（决策 dc18d43d）：judge 自写 judge_verdict，不依赖 controller 二次 curl 上报。
    // 只写 judged=true 的真实裁决；FAIL→PASS 允许收敛，PASS 禁被回退；0 行/异常 non-fatal。
    if (result?.judged === true) {
      try {
        await pool.query(
          `UPDATE initiative_runs SET judge_verdict = $1
            WHERE id = (SELECT id FROM initiative_runs
                         WHERE current_task_id = $2 AND orchestrator_version = 'v2'
                         ORDER BY started_at DESC LIMIT 1)
              AND judge_verdict IS DISTINCT FROM 'PASS'`,
          [result.verdict, String(task_id)]
        );
      } catch (jvErr) {
        console.warn(`[POST /harness/judge] judge_verdict 落库失败（non-fatal）：${jvErr.message}`);
      }
    }
```

同时扩展既有 `src/__tests__/harness-skill-relay.test.js` 的 happy path 断言：INSERT 参数数组包含 task.id（current_task_id）。

- [ ] **Step 4: 跑绿** + `npx vitest run src/__tests__/harness-skill-relay.test.js`。
- [ ] **Step 5: commit-2** `feat(brain): 刀C1/C2 spawn 写 current_task_id + judge 自写 judge_verdict [d0a668d9]`

---

### Task 4: 收账权收归 — lib/harness-finalize.js + 四入口

**Files:**
- Create: `packages/brain/src/lib/harness-finalize.js`
- Modify: `packages/brain/src/callback-processor.js`（completed 降级）
- Modify: `packages/brain/src/routes/tasks.js:357+`、`packages/brain/src/routes/task-tasks.js:253+`、`packages/brain/src/routes/harness.js:1485+`（/complete）
- Test: `packages/brain/src/lib/__tests__/harness-finalize.test.js` + `packages/brain/src/__tests__/harness-completion-authority.test.js`

- [ ] **Step 1: failing test（harness-finalize.test.js）**

```js
import { describe, it, expect, vi } from 'vitest';
import { finalizeHarnessTask, isHarnessRelayTask } from '../harness-finalize.js';

function makePool({ task, gate = true } = {}) {
  return { query: vi.fn(async (sql, params) => {
    if (/SELECT.*FROM tasks WHERE id/is.test(sql)) return { rows: task ? [task] : [] };
    if (/initiative_run_events/.test(sql)) return { rows: gate ? [{ 1: 1 }] : [] };
    if (/UPDATE tasks/.test(sql)) return { rowCount: 1 };
    return { rows: [] };
  }) };
}
const relayTask = (extra = {}) => ({
  id: 't-1', status: 'in_progress', task_type: 'harness_initiative', pr_url: 'https://github.com/o/r/pull/9',
  payload: { orchestrator: 'skill-relay' }, ...extra,
});

describe('finalizeHarnessTask：终态绑定外部真相', () => {
  it('非 harness relay 任务 → applies:false（不拦普通任务）', async () => {
    const pool = makePool({ task: { id: 't', task_type: 'dev', payload: {} } });
    const r = await finalizeHarnessTask('t', { pool, execFn: vi.fn() });
    expect(r.applies).toBe(false);
  });

  it('PR MERGED + evaluator gate → allow:true', async () => {
    const execFn = vi.fn(() => JSON.stringify({ state: 'MERGED' }));
    const r = await finalizeHarnessTask('t-1', { pool: makePool({ task: relayTask(), gate: true }), execFn });
    expect(r.applies).toBe(true);
    expect(r.allow).toBe(true);
  });

  it('PR 仍 OPEN → allow:false + 降级写 generator_done', async () => {
    const pool = makePool({ task: relayTask(), gate: true });
    const execFn = vi.fn(() => JSON.stringify({ state: 'OPEN' }));
    const r = await finalizeHarnessTask('t-1', { pool, execFn });
    expect(r.allow).toBe(false);
    const upd = pool.query.mock.calls.find(([sql]) => /generator_done/.test(sql));
    expect(upd).toBeTruthy();
  });

  it('无 pr_url 且 GitHub 反查无命中 → allow:false', async () => {
    const task = relayTask({ pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: 'https://github.com/o/r' } });
    const execFn = vi.fn(() => JSON.stringify([]));
    const r = await finalizeHarnessTask('t-1', { pool: makePool({ task }), execFn });
    expect(r.allow).toBe(false);
  });

  it('MERGED 但无 evaluator gate → allow:false（reason 注明缺 gate）', async () => {
    const execFn = vi.fn(() => JSON.stringify({ state: 'MERGED' }));
    const r = await finalizeHarnessTask('t-1', { pool: makePool({ task: relayTask(), gate: false }), execFn });
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/evaluator/);
  });

  it('gh 命令抛错 → allow:false 保守拒绝（不误放行）', async () => {
    const execFn = vi.fn(() => { throw new Error('gh down'); });
    const r = await finalizeHarnessTask('t-1', { pool: makePool({ task: relayTask() }), execFn });
    expect(r.allow).toBe(false);
  });
});
```

harness-completion-authority.test.js（四入口行为）：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 统一 mock finalize：按用例切换 allow
const finalizeMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/harness-finalize.js', () => ({
  finalizeHarnessTask: finalizeMock,
  isHarnessRelayTask: (t) => t?.task_type === 'harness_initiative' && t?.payload?.orchestrator === 'skill-relay',
}));

describe('收账权收归：completed 入口全部过 finalize', () => {
  beforeEach(() => finalizeMock.mockReset());

  it('callback completed + finalize 拒绝 → task 不落 completed（降级 in_progress）', async () => {
    finalizeMock.mockResolvedValue({ applies: true, allow: false, reason: 'pr_not_merged' });
    const calls = [];
    const client = { query: vi.fn(async (sql, p) => { calls.push(sql); return { rows: [], rowCount: 1 }; }), release: vi.fn() };
    const pool = {
      connect: async () => client,
      query: vi.fn(async (sql) => {
        if (/failure_class/.test(sql)) return { rows: [{ failure_class: null, task_type: 'harness_initiative', orchestrator: 'skill-relay' }] };
        return { rows: [], rowCount: 0 };
      }),
    };
    const { processExecutionCallback } = await import('../callback-processor.js');
    await processExecutionCallback({ task_id: 't-1', status: 'completed', result: { merged: false } }, pool);
    const upd = calls.find((sql) => /UPDATE tasks/.test(sql) && /status = \$2/.test(sql));
    // 断言实际落库的 status 参数不是 completed（被降级）
    const updCall = client.query.mock.calls.find(([sql]) => /UPDATE\s+tasks/.test(sql));
    expect(updCall[1][1]).not.toBe('completed');
  });

  it('PATCH /tasks/:id completed + finalize 拒绝 → 200 accepted:false 非 409', async () => {
    finalizeMock.mockResolvedValue({ applies: true, allow: false, reason: 'no_evaluator_gate' });
    // 按 tasks-result-backfill.test.js 同法取 handler、mock db
    // 断言：res.statusCode===200 且 body.accepted===false 且 status 未变
  });

  it('PATCH /tasks/:id completed + finalize 放行 → 正常 completed', async () => {
    finalizeMock.mockResolvedValue({ applies: true, allow: true, prUrl: 'https://github.com/o/r/pull/9' });
    // 断言 UPDATE 含 status 参数 completed
  });

  it('POST /harness/complete + finalize 拒绝 → 200 accepted:false，UPDATE 不含 completed', async () => {
    finalizeMock.mockResolvedValue({ applies: true, allow: false, reason: 'pr_not_merged' });
    // 取 /complete handler，断言 res.json 带 accepted:false 且无 status='completed' 的 UPDATE
  });

  it('非 harness 任务（applies:false）→ 一切照旧', async () => {
    finalizeMock.mockResolvedValue({ applies: false });
    // PATCH completed 走原逻辑
  });
});
```

> 上面三条骨架用例的取 handler/mock db 细节照抄 `src/routes/__tests__/tasks-result-backfill.test.js` 现成范式，实现者补全为可执行断言，**禁止留 TODO**。

- [ ] **Step 2: 跑红**。commit-1：`test(brain): 收账权收归 finalize+四入口 failing tests [d0a668d9]`
- [ ] **Step 3: 实现 lib/harness-finalize.js**

```js
/**
 * harness-finalize — 收账权收归（决策 dc18d43d/c3f473eb）。
 * harness_initiative(skill-relay) 的任何 completed 请求一律当"申请"：
 * Brain 机械核验外部真相（PR MERGED + evaluator gate 事件）后才放行终态。
 * 不信任任何请求体自声明（LLM 跑 curl 可伪造）。核验失败保守拒绝。
 */
import { execSync } from 'node:child_process';
import { _parseBaseRepo, _hasEvaluatorGate } from '../harness-relay-watchdog.js';

export function isHarnessRelayTask(task) {
  return task?.task_type === 'harness_initiative' && task?.payload?.orchestrator === 'skill-relay';
}

function shortId(id) { return String(id).replace(/-/g, '').slice(0, 8); }

export async function finalizeHarnessTask(taskId, deps = {}) {
  const pool = deps.pool;
  const execFn = deps.execFn || ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 10000 }));
  const { rows } = await pool.query(
    `SELECT id, status, task_type, pr_url, payload FROM tasks WHERE id = $1`, [taskId]
  );
  const task = rows[0];
  if (!task || !isHarnessRelayTask(task)) return { applies: false };

  const demote = async (reason) => {
    try {
      await pool.query(
        `UPDATE tasks SET payload = COALESCE(payload,'{}'::jsonb)
           || jsonb_build_object('generator_done', true, 'generator_done_at', to_jsonb(NOW()))
         WHERE id = $1 AND status = 'in_progress'`, [taskId]
      );
    } catch (err) { console.warn(`[harness-finalize] generator_done 降级写失败（non-fatal）：${err.message}`); }
    return { applies: true, allow: false, reason };
  };

  // 1. 定位 PR：tasks.pr_url → payload.pr_url → GitHub 按分支名反查
  let prUrl = [task.pr_url, task.payload?.pr_url].find(
    (u) => typeof u === 'string' && u.startsWith('https://github.com/')
  ) || null;
  let prState = null;
  try {
    if (prUrl) {
      prState = JSON.parse(execFn(`gh pr view "${prUrl}" --json state`)).state;
    } else {
      const repo = _parseBaseRepo(task.payload?.base_repo);
      if (repo) {
        const prs = JSON.parse(execFn(`gh pr list --repo "${repo}" --state all --limit 100 --json headRefName,url,state`));
        const hit = (Array.isArray(prs) ? prs : []).filter((p) => String(p?.headRefName || '').includes(shortId(taskId)));
        const merged = hit.find((p) => p.state === 'MERGED');
        if (merged) { prUrl = merged.url; prState = 'MERGED'; }
      }
    }
  } catch (err) {
    return demote(`pr_verify_failed: ${err.message}`); // 核验失败=保守拒绝
  }
  if (prState !== 'MERGED') return demote(prUrl ? `pr_not_merged: state=${prState}` : 'pr_not_found');

  // 2. evaluator gate（外部真相第二判据）
  const gated = await _hasEvaluatorGate(pool, taskId);
  if (!gated) return demote('no_evaluator_gate: PR 已 MERGED 但 evaluator 从未 done——需补验收');

  return { applies: true, allow: true, prUrl };
}
```

四入口接线：
1. **callback-processor.js**：terminalCheck 查询扩为 `SELECT payload->>'failure_class' AS failure_class, task_type, payload->>'orchestrator' AS orchestrator FROM tasks WHERE id=$1`；当 `newStatus==='completed'` 且 task_type='harness_initiative' 且 orchestrator='skill-relay' → `const fin = await finalizeHarnessTask(task_id, { pool })`；`fin.applies && !fin.allow` → `newStatus = 'in_progress'`（后续大 UPDATE 照跑：pr_url/result 照记，isCompleted 自然为 false，completed_at 不写，promoteRegression 不触发），并 console.warn 降级原因。
2. **routes/tasks.js PATCH**：初始 SELECT 扩 `task_type, payload->>'orchestrator' AS orchestrator`；`status==='completed' && !isStatusNoop` 且是 harness relay → finalize；拒绝 → 剔除 status 相关 setClauses（保留 result 合并照常执行），响应 `res.json({ success: true, accepted: false, reason: fin.reason, status: currentStatus })`（HTTP 200）。
3. **routes/task-tasks.js PATCH**：同款守卫插在状态机校验后。
4. **routes/harness.js /complete**：UPDATE 前 finalize；拒绝 → 不跑 completed UPDATE，改写 result 字段合并（保留 pr_url/screenshots 落 result），返回 `res.json({ ok: true, accepted: false, reason: fin.reason })`。

- [ ] **Step 4: 跑绿** + 回归 `npx vitest run src/routes/__tests__/tasks-result-backfill.test.js src/__tests__/callback*.test.js`（既有收账测试必须仍绿；若有用例断言"callback completed→completed"且用的是 harness relay fixture，按新语义更新并在 commit message 注明）。
- [ ] **Step 5: commit-2** `feat(brain): 收账权收归——四 completed 入口统一 finalize 外部真相核验 [d0a668d9]`

---

### Task 5: watchdog — generator_done 短路 + 6h 超时 + C3 事件三口收尾

**Files:**
- Modify: `packages/brain/src/harness-relay-watchdog.js`（_finalizeMergedRun / attempt-cap / scanStuckHarness / resumeStalledRelayRuns）
- Test: `packages/brain/src/__tests__/harness-relay-watchdog-gates.test.js`

- [ ] **Step 1: failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { resumeStalledRelayRuns, _finalizeMergedRun, scanStuckHarness, GENERATOR_DONE_TIMEOUT_MS } from '../harness-relay-watchdog.js';

// mock pool 范式照抄 harness-relay-watchdog.test.js（按 SQL 分派）
function makePool({ runRows = [], task, eventGate = true }) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    calls.push([sql, params]);
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) return { rows: runRows };
    if (/SELECT id, status, title/.test(sql)) return { rows: task ? [task] : [] };
    if (/initiative_run_events WHERE initiative_id=\$1 AND node='evaluator'/.test(sql)) return { rows: eventGate ? [{ 1: 1 }] : [] };
    return { rows: [], rowCount: 1 };
  });
  return { query, calls };
}

describe('C3: skill-relay-spawn 事件收尾', () => {
  it('_finalizeMergedRun → 关闭 running 的 skill-relay-spawn 事件为 done', async () => {
    const pool = makePool({ eventGate: true });
    await _finalizeMergedRun(pool, 'i-1', 'https://github.com/o/r/pull/1', { mergedPr: 0, mergedWithoutGate: 0 });
    const close = pool.query.mock.calls.find(([sql]) =>
      /UPDATE initiative_run_events/.test(sql) && /skill-relay-spawn/.test(sql) && /running/.test(sql));
    expect(close).toBeTruthy();
  });

  it('scanStuckHarness 逾期收尸 → 同步关闭 spawn 事件为 failed', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/deadline_at < NOW\(\)/.test(sql)) return { rows: [{ id: 1, initiative_id: 'i-2', orchestrator_host: 'skill-relay-codex', phase: 'gan', deadline_at: new Date(0) }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    await scanStuckHarness({ pool });
    const close = pool.query.mock.calls.find(([sql]) =>
      /UPDATE initiative_run_events/.test(sql) && /skill-relay-spawn/.test(sql));
    expect(close).toBeTruthy();
    expect(close[0]).toMatch(/'failed'/);
  });
});

describe('收账权收归 watchdog 侧：generator_done 短路 + 超时', () => {
  const baseRun = { initiative_id: 't-3', phase: 'generate', deadline_at: null, pr_url: null, orchestrator_host: 'skill-relay-session', attempts: '1' };

  it('generator_done=true 容器消失且无 PR → 不重点火（spawnFn 零调用）', async () => {
    const task = { id: 't-3', status: 'in_progress', payload: { orchestrator: 'skill-relay', generator_done: true, generator_done_at: new Date().toISOString() } };
    const pool = makePool({ runRows: [baseRun], task });
    const spawnFn = vi.fn();
    const execFn = vi.fn((cmd) => { if (/docker ps/.test(cmd)) return ''; throw new Error('no gh'); });
    await resumeStalledRelayRuns({ pool, execFn, spawnFn });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('generator_done 超 6h 无 MERGED → task 标 failed（不永挂）', async () => {
    const stale = new Date(Date.now() - GENERATOR_DONE_TIMEOUT_MS - 1000).toISOString();
    const task = { id: 't-3', status: 'in_progress', payload: { orchestrator: 'skill-relay', generator_done: true, generator_done_at: stale } };
    const pool = makePool({ runRows: [baseRun], task });
    const execFn = vi.fn((cmd) => { if (/docker ps/.test(cmd)) return ''; throw new Error('no gh'); });
    await resumeStalledRelayRuns({ pool, execFn, spawnFn: vi.fn() });
    const failUpd = pool.query.mock.calls.find(([sql]) => /UPDATE tasks SET status\s*=\s*'failed'/.test(sql) || (/UPDATE tasks/.test(sql) && /'failed'/.test(sql)));
    expect(failUpd).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑红**。commit-1：`test(brain): watchdog generator_done 短路+超时+C3 事件收尾 failing tests [d0a668d9]`
- [ ] **Step 3: 实现（harness-relay-watchdog.js）**

新增常量与 helper：

```js
export const GENERATOR_DONE_TIMEOUT_MS = 6 * 60 * 60 * 1000; // generator 完成后 6h 无 MERGED → failed（防 e90c0fbb pr_url 空永挂）

/** C3：按 initiative 批量关闭 skill-relay-spawn 事件（写点在 executor.js spawn，写完即弃无 id）。 */
async function _closeSpawnEvents(dbPool, initiativeId, status) {
  try {
    await dbPool.query(
      `UPDATE initiative_run_events SET status = '${status === 'done' ? 'done' : 'failed'}', ts_end = $2
        WHERE initiative_id = $1 AND node = 'skill-relay-spawn' AND status = 'running'`,
      [initiativeId, Date.now()]
    );
  } catch (err) { console.warn(`[relay-watchdog] spawn 事件收尾失败（non-fatal）：${err.message}`); }
}
```

接线三处：`_finalizeMergedRun` 末尾（taskSql 之后）`await _closeSpawnEvents(dbPool, initiativeId, 'done')`；attempt-cap 分支 `out.capped++` 前 `await _closeSpawnEvents(dbPool, run.initiative_id, 'failed')`；`scanStuckHarness` 循环内 task 标 failed 后 `await _closeSpawnEvents(dbPool, row.initiative_id, 'failed')`。

generator_done 短路 + 超时（resumeStalledRelayRuns，插在 `if (running) continue;` 之后、PR 前置检查之前）：

```js
      // 收账权收归：generator 已完成（callback 降级标记）→ 绝不二次 spawn generator（防重复 PR）。
      // 超 6h 仍无 MERGED → 标 failed 不永挂（e90c0fbb 缓解）。MERGED 自然路径仍走下方 PR 检查收口。
      if (task.payload?.generator_done === true) {
        const doneAt = task.payload?.generator_done_at ? new Date(task.payload.generator_done_at).getTime() : 0;
        if (doneAt && Date.now() - doneAt > GENERATOR_DONE_TIMEOUT_MS) {
          // 先给 PR 检查一次机会：下方逻辑若发现 MERGED 会 finalize——这里只处理"查不到 PR/未合并"的到期
          const rawPr = run.pr_url || task.pr_url || task.payload?.pr_url || null;
          let mergedLate = false;
          if (typeof rawPr === 'string' && rawPr.startsWith('https://github.com/')) {
            try { mergedLate = JSON.parse(execFn(`gh pr view "${rawPr}" --json state`)).state === 'MERGED'; } catch { mergedLate = false; }
          }
          if (mergedLate) { await _finalizeMergedRun(dbPool, run.initiative_id, rawPr, out); continue; }
          await dbPool.query(
            `UPDATE initiative_runs SET phase='failed', completed_at=NOW(), failure_reason='generator_done_timeout'
              WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
            [run.initiative_id]);
          await dbPool.query(
            `UPDATE tasks SET status='failed', completed_at=NOW(),
                    error_message='generator 完成后 ' || $2 || 'h 内 PR 未 MERGED（收账权收归超时兜底）'
              WHERE id=$1 AND status='in_progress'`,
            [run.initiative_id, String(GENERATOR_DONE_TIMEOUT_MS / 3600000)]);
          await _closeSpawnEvents(dbPool, run.initiative_id, 'failed');
          out.capped++;
          continue;
        }
        // 未到期：只做 PR 状态检查（下方既有逻辑），检查完 continue 到下一 run——绝不落到重点火
      }
```

并在函数尾部重点火调用点前加保险：`if (task.payload?.generator_done === true) { console.log(...跳过重点火); continue; }`（headed needsRefire 分支同样在 spawn 前加此判断）。

- [ ] **Step 4: 跑绿** + 回归 `npx vitest run src/__tests__/harness-relay-watchdog.test.js`（既有 watchdog 测试全绿）。
- [ ] **Step 5: commit-2** `feat(brain): watchdog generator_done 短路+6h 超时兜底+spawn 事件三口收尾 [d0a668d9]`

---

### Task 6: smoke.sh + allowlist + 版本 bump + 收尾核验

**Files:**
- Create: `packages/brain/scripts/smoke/harness-lifecycle-gates-smoke.sh`（照抄 task-result-backfill-smoke.sh 结构）
- Modify: `packages/quality/smoke-allowlist.txt`（登记新 smoke）
- Modify: `packages/brain/package.json` + 根 `package-lock.json` + `packages/brain/package-lock.json` + `.brain-versions`（version bump，参照 PR #3848 的 bump 面）

- [ ] **Step 1: smoke 脚本**（静态断言型，CI 兼容：node -e readFileSync；不 curl 不 psql）

```bash
#!/usr/bin/env bash
# harness-lifecycle-gates smoke — 验证刀B/C/收账权收归的代码闸真实在位（决策 dc18d43d）
set -euo pipefail
cd "$(dirname "$0")/../.."

node -e "
const { readFileSync } = require('fs');
const judge = readFileSync('src/harness-judge.js','utf8');
if (!/runMechanicalGate/.test(judge)) { console.error('FAIL: 机械闸缺失'); process.exit(1); }
const relay = readFileSync('src/harness-skill-relay.js','utf8');
const inserts = relay.match(/INSERT INTO initiative_runs[\s\S]{0,400}?\)/g) || [];
if (!inserts.every((s) => /current_task_id/.test(s))) { console.error('FAIL: INSERT 缺 current_task_id'); process.exit(1); }
const fin = readFileSync('src/lib/harness-finalize.js','utf8');
if (!/finalizeHarnessTask/.test(fin)) { console.error('FAIL: finalize 缺失'); process.exit(1); }
for (const f of ['src/callback-processor.js','src/routes/tasks.js','src/routes/task-tasks.js','src/routes/harness.js']) {
  if (!/finalizeHarnessTask|harness-finalize/.test(readFileSync(f,'utf8'))) { console.error('FAIL: ' + f + ' 未接 finalize'); process.exit(1); }
}
const mig = readFileSync('migrations/342_decisions_source_ref.sql','utf8');
if (!/source_ref/.test(mig)) { console.error('FAIL: migration 342 缺失'); process.exit(1); }
console.log('PASS: harness-lifecycle-gates 全部闸在位');
"
```

- [ ] **Step 2: allowlist 登记**（packages/quality/smoke-allowlist.txt 追加一行，格式照文件内既有条目）
- [ ] **Step 3: 版本 bump**：packages/brain/package.json version minor+1（以 origin/main 当前为准，feat 级）；同步两个 package-lock（`cd packages/brain && npm install --package-lock-only` + 根同理）；.brain-versions 按 #3848 同款格式追加。
- [ ] **Step 4: 全量收尾核验**：`node --check packages/brain/src/server.js`（brain-deploy 冒烟铁律）+ `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js src/__tests__/harness-skill-relay.test.js src/routes/__tests__/ src/lib/__tests__/ 2>&1 | tail -20` + `bash scripts/smoke/harness-lifecycle-gates-smoke.sh`
- [ ] **Step 5: commit** `chore(brain): smoke+allowlist+版本 bump——harness-lifecycle-gates 收尾 [d0a668d9]`

---

## Learning（第一次 push 前写好，命名 docs/learnings/cp-07140720-harness-lifecycle-gates.md）

含 `### 根本原因`（生命周期靠 SKILL 文本约束 LLM=结构性失效，f35db586 成批实证）+ `### 下次预防`（`- [ ] 新增 pipeline 验收/记账逻辑时默认写成代码闸，SKILL 文本只做说明书`；`- [ ] completed 类终态写入点新增时必须接 finalizeHarnessTask 或说明豁免理由`）。

## PR 说明要点
- PR title：`feat(brain): harness 生命周期/记账/验收判据下沉代码闸——刀B+刀C+收账权收归 [d0a668d9]`
- body 引决策 dc18d43d/c3f473eb、issue 3c541792、spec/plan 路径；注明 e90c0fbb 部分缓解不全销
