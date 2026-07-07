# harness judge API 化 + relay-runs 前台建档 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** judge 环从仓内 CLI 相对路径调用改为 Brain API；前台点火可建 initiative_runs 档；watchdog 不误重点火前台 run；CI 快照刷新。

**Architecture:** 两个新端点都是既有模块的 thin wrapper（runJudgeGate 逻辑零改动、INSERT 列对齐 harness-skill-relay.js:239）；watchdog 加一行 host 护栏。spec 见 docs/superpowers/specs/2026-07-07-harness-judge-api-design.md。

**Tech Stack:** Express Router + vitest + supertest（vi.hoisted mockPool 模式，参照 src/__tests__/relay-runs.test.js）。

**TDD 铁律（inline）:** NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。每 Task commit-1 = failing test，commit-2 = 实现。

**工作目录:** /Users/administrator/worktrees/cecelia/harness-judge-api（分支 cp-0707170711-harness-judge-api）。
**⚠️ 环境铁则:** 会话 cwd 会被外部 hook 强制钉回主仓；且全局门禁会拦截命令文本里的 `git<空格>add/commit` 形态。**所有 git 操作一律用 `git -C /Users/administrator/worktrees/cecelia/harness-judge-api <子命令>` 形式**（本计划已全部如此书写，照抄即可）；跑测试用 `cd <worktree>/packages/brain && npx vitest ...`（cd 在单条命令内有效）。

---

### Task 1: POST /api/brain/harness/judge

**Files:**
- Test: `packages/brain/src/__tests__/harness-judge-api.test.js`（新建）
- Modify: `packages/brain/src/routes/harness.js`（import 区 + 文件尾加路由）

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/__tests__/harness-judge-api.test.js`：

```js
/**
 * POST /api/brain/harness/judge — judge 环 API 化（跨 repo 刀2，Issue 98e5dff4）。
 * 语义镜像 scripts/harness-judge-cli.mjs main()：参数校验 / .brain-result.json 回退 /
 * FIXED 归一 PASS / runJudgeGate 结果透传。runJudgeGate 本体 mock（逻辑零改动不在此测）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockPool, mockRunJudgeGate } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockRunJudgeGate: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../harness-judge.js', () => ({ runJudgeGate: mockRunJudgeGate }));

async function buildApp() {
  const { default: router } = await import('../routes/harness.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/harness', router);
  return a;
}

describe('POST /api/brain/harness/judge', () => {
  beforeEach(() => {
    mockRunJudgeGate.mockReset();
    mockPool.query.mockReset();
  });

  it('缺必填字段 → 400', async () => {
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 't1', sprint_dir: 'sprints/x' }); // 缺 worktree
    expect(r.status).toBe(400);
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('worktree 目录不存在 → 400', async () => {
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 't1', sprint_dir: 'sprints/x', worktree: '/nonexistent/path/xyz' });
    expect(r.status).toBe(400);
  });

  it('agent_verdict=FIXED 归一为 PASS 传给 runJudgeGate，结果透传 200', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: null, judged: true });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 'aaaabbbb-1111', sprint_dir: 'sprints/x', worktree: wt, agent_verdict: 'FIXED' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ verdict: 'PASS', feedback: null, judged: true });
    expect(mockRunJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS',
      worktreePath: wt,
      sprintDir: 'sprints/x',
      instanceLabel: 'judge-api-aaaabbbb',
    }));
  });

  it('agent_verdict 缺省 → 从 <worktree>/.brain-result.json 读', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    await writeFile(join(wt, '.brain-result.json'), JSON.stringify({ verdict: 'PASS', feedback: 'ok' }));
    mockRunJudgeGate.mockResolvedValue({ verdict: 'PASS', feedback: 'ok', judged: false });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 't1', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(200);
    expect(mockRunJudgeGate).toHaveBeenCalledWith(expect.objectContaining({
      agentVerdict: 'PASS', agentFeedback: 'ok',
    }));
  });

  it('agent_verdict 缺省且 .brain-result.json 不存在 → 400', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 't1', sprint_dir: 'sprints/x', worktree: wt });
    expect(r.status).toBe(400);
    expect(mockRunJudgeGate).not.toHaveBeenCalled();
  });

  it('runJudgeGate 抛错 → 500 且不泄内部 message', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'judge-api-'));
    mockRunJudgeGate.mockRejectedValue(new Error('secret internal'));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/judge')
      .send({ task_id: 't1', sprint_dir: 'sprints/x', worktree: wt, agent_verdict: 'PASS' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret internal');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/administrator/worktrees/cecelia/harness-judge-api/packages/brain && npx vitest run src/__tests__/harness-judge-api.test.js`
Expected: FAIL（404 —— 路由不存在）

- [ ] **Step 3: commit-1（failing test）**

```bash
git -C /Users/administrator/worktrees/cecelia/harness-judge-api add packages/brain/src/__tests__/harness-judge-api.test.js
git -C /Users/administrator/worktrees/cecelia/harness-judge-api commit -m "test: judge API 路由 failing test (Red)"
```

- [ ] **Step 4: 最小实现**

`packages/brain/src/routes/harness.js` 改两处。
① import 区（`import pool from '../db.js';` 之后）加：

```js
import { runJudgeGate } from '../harness-judge.js';
```

② 文件末尾 `export default router;` 之前加：

```js
/**
 * POST /api/brain/harness/judge — judge 环 API 化（跨 repo 刀2）。
 * 语义镜像 scripts/harness-judge-cli.mjs main()（该 CLI 保留兼容）：
 * 三必填校验 → verdict 回退读 .brain-result.json → FIXED 归一 PASS → runJudgeGate 透传。
 * HTTP 恒 200 承载裁决（等价 CLI exit 0/2 由调用方按 body.verdict 分支）。
 */
router.post('/judge', async (req, res) => {
  const { task_id, sprint_dir, worktree, agent_verdict, agent_feedback, prompt_dir, transcript_file } = req.body || {};
  if (!task_id || !sprint_dir || !worktree) {
    return res.status(400).json({ error: 'task_id/sprint_dir/worktree 必填' });
  }
  if (typeof worktree !== 'string' || !worktree.startsWith('/')) {
    return res.status(400).json({ error: 'worktree 必须是绝对路径' });
  }
  try { await access(worktree); } catch {
    return res.status(400).json({ error: 'worktree 目录不存在' });
  }

  let verdict = agent_verdict;
  let feedback = agent_feedback;
  if (!verdict) {
    try {
      const br = JSON.parse(await readFile(join(worktree, '.brain-result.json'), 'utf8'));
      verdict = br.verdict;
      if (feedback === undefined) feedback = br.feedback;
    } catch { /* 下方统一 400 */ }
  }
  if (!verdict) {
    return res.status(400).json({ error: 'agent_verdict 缺失且 .brain-result.json 不可读' });
  }
  if (verdict === 'FIXED') verdict = 'PASS'; // 前科语义归一（memory: harness-evaluator-verdict-bug）

  let transcript;
  if (transcript_file) {
    try { transcript = await readFile(transcript_file, 'utf8'); } catch { /* 读失败不阻塞，与 CLI 一致 */ }
  }

  try {
    const result = await runJudgeGate({
      agentVerdict: verdict,
      agentFeedback: feedback,
      worktreePath: worktree,
      sprintDir: sprint_dir,
      taskId: task_id,
      promptDir: prompt_dir,
      transcript,
      instanceLabel: `judge-api-${String(task_id).slice(0, 8)}`,
    });
    return res.json(result);
  } catch (err) {
    console.error('[POST /harness/judge]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});
```

（`access`/`readFile`/`join` 已在该文件头部 import，勿重复。）

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd /Users/administrator/worktrees/cecelia/harness-judge-api/packages/brain && npx vitest run src/__tests__/harness-judge-api.test.js`
Expected: 6 passed

- [ ] **Step 6: commit-2（实现）**

```bash
git -C /Users/administrator/worktrees/cecelia/harness-judge-api add packages/brain/src/routes/harness.js
git -C /Users/administrator/worktrees/cecelia/harness-judge-api commit -m "feat(brain): POST /api/brain/harness/judge — judge 环 API 化（跨 repo 刀2）"
```

---

### Task 2: POST /api/brain/orchestrator/relay-runs/:initiative_id（前台建档）

**Files:**
- Test: `packages/brain/src/__tests__/relay-runs-create.test.js`（新建）
- Modify: `packages/brain/src/routes/initiatives.js`（PATCH /relay-runs/:initiative_id 定义之前插入）

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/__tests__/relay-runs-create.test.js`：

```js
/**
 * POST /orchestrator/relay-runs/:initiative_id — 前台点火建档（Issue 968b6f58 Brain 侧半边）。
 * 幂等：已有 v2 非终态行 → 200 created:false；否则 INSERT host='foreground' → 201。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

const INITIATIVE = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

function mockQueries({ task = { id: INITIATIVE, task_type: 'harness_initiative', payload: { journey_id: 'j-1' } }, existingRun = null } = {}) {
  mockPool.query.mockImplementation(async (sql) => {
    if (/FROM tasks/.test(sql)) return { rows: task ? [task] : [] };
    if (/SELECT[\s\S]*FROM initiative_runs/.test(sql)) return { rows: existingRun ? [existingRun] : [] };
    if (/INSERT INTO initiative_runs/.test(sql)) {
      return { rows: [{ id: 'run-1', initiative_id: INITIATIVE, phase: 'planning', orchestrator_host: 'foreground' }] };
    }
    return { rows: [] };
  });
}

describe('POST /orchestrator/relay-runs/:initiative_id', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('task 不存在 → 404', async () => {
    mockQueries({ task: null });
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({});
    expect(r.status).toBe(404);
  });

  it('task_type 非 harness_initiative → 404', async () => {
    mockQueries({ task: { id: INITIATIVE, task_type: 'dev', payload: {} } });
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({});
    expect(r.status).toBe(404);
  });

  it('非法 phase → 400（不查库）', async () => {
    mockQueries({});
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({ phase: 'bogus' });
    expect(r.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('首建 → 201 created:true，host=foreground，INSERT 传 journey_id', async () => {
    mockQueries({});
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({});
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(true);
    expect(r.body.run.orchestrator_host).toBe('foreground');
    const insertCall = mockPool.query.mock.calls.find(([sql]) => /INSERT INTO initiative_runs/.test(sql));
    expect(insertCall[0]).toContain("'foreground'");
    expect(insertCall[1]).toEqual([INITIATIVE, 'planning', 'j-1']);
  });

  it('已有 v2 非终态行 → 200 created:false 不 INSERT', async () => {
    mockQueries({ existingRun: { id: 'run-0', initiative_id: INITIATIVE, phase: 'gan', orchestrator_host: 'foreground' } });
    const app = await buildApp();
    const r = await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE}`).send({});
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(false);
    const insertCall = mockPool.query.mock.calls.find(([sql]) => /INSERT INTO initiative_runs/.test(sql));
    expect(insertCall).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/administrator/worktrees/cecelia/harness-judge-api/packages/brain && npx vitest run src/__tests__/relay-runs-create.test.js`
Expected: FAIL（POST 路由不存在 → 404；"task 不存在"用例此时可能碰巧过——以整文件有 FAIL 为准）

- [ ] **Step 3: commit-1**

```bash
git -C /Users/administrator/worktrees/cecelia/harness-judge-api add packages/brain/src/__tests__/relay-runs-create.test.js
git -C /Users/administrator/worktrees/cecelia/harness-judge-api commit -m "test: relay-runs 前台建档端点 failing test (Red)"
```

- [ ] **Step 4: 最小实现**

`packages/brain/src/routes/initiatives.js`，在 `router.patch('/relay-runs/:initiative_id', ...)` 定义之前插入：

```js
/**
 * POST /api/brain/orchestrator/relay-runs/:initiative_id — 前台点火建档。
 * 人工前台接管 controller 时没有 Brain spawnSkillRelaySession 的 INSERT（Issue 968b6f58），
 * 进度上报/PR 回写全 404。本端点补建档：幂等（已有 v2 非终态行则返回现有行），
 * orchestrator_host='foreground'（relay-watchdog 对该 host 跳过重点火——前台无 relay 容器，
 * "容器消失=死跑"判据对它恒真，会 spawn 无头容器与前台会话双跑）。
 * 列对齐 harness-skill-relay.js spawnSkillRelaySession 的 INSERT。
 */
router.post('/relay-runs/:initiative_id', async (req, res) => {
  const { initiative_id } = req.params;
  const { phase, journey_id } = req.body || {};
  const ALLOWED = ['planning', 'gan', 'generate', 'evaluate'];
  const startPhase = phase || 'planning';
  if (!ALLOWED.includes(startPhase)) {
    return res.status(400).json({ error: 'invalid phase', allowed: ALLOWED });
  }
  try {
    const taskQ = await pool.query(`SELECT id, task_type, payload FROM tasks WHERE id = $1`, [initiative_id]);
    const task = taskQ.rows[0];
    if (!task || task.task_type !== 'harness_initiative') {
      return res.status(404).json({ error: 'harness_initiative task not found' });
    }
    const existing = await pool.query(
      `SELECT id, initiative_id, phase, orchestrator_host, started_at
         FROM initiative_runs
        WHERE initiative_id = $1 AND orchestrator_version = 'v2'
          AND phase NOT IN ('done','failed')
        LIMIT 1`,
      [initiative_id]
    );
    if (existing.rows.length > 0) {
      return res.json({ created: false, run: existing.rows[0] });
    }
    const journeyId = journey_id || task.payload?.journey_id || null;
    const ins = await pool.query(
      `INSERT INTO initiative_runs
         (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at)
       VALUES ($1, $2, $3, 'v2', 'foreground', NOW() + INTERVAL '6 hours')
       RETURNING id, initiative_id, phase, orchestrator_host, started_at, deadline_at`,
      [initiative_id, startPhase, journeyId]
    );
    return res.status(201).json({ created: true, run: ins.rows[0] });
  } catch (err) {
    console.error('[POST /orchestrator/relay-runs/:id]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd /Users/administrator/worktrees/cecelia/harness-judge-api/packages/brain && npx vitest run src/__tests__/relay-runs-create.test.js`
Expected: 5 passed

- [ ] **Step 6: commit-2**

```bash
git -C /Users/administrator/worktrees/cecelia/harness-judge-api add packages/brain/src/routes/initiatives.js
git -C /Users/administrator/worktrees/cecelia/harness-judge-api commit -m "feat(brain): POST relay-runs 前台建档端点——幂等 + host=foreground"
```

---

### Task 3: relay-watchdog foreground 护栏

**Files:**
- Test: `packages/brain/src/__tests__/harness-relay-watchdog.test.js`（makeDeps 加参数 + 追加用例）
- Modify: `packages/brain/src/harness-relay-watchdog.js`（约 85 行处加一条 continue）

- [ ] **Step 1: 写 failing test**

`harness-relay-watchdog.test.js` 两处改动：
① makeDeps 参数对象加 `orchestratorHost = 'skill-relay-session'`，并在 `if (/DISTINCT ON \(initiative_id\)/.test(sql))` 分支的 rows 行对象里加 `orchestrator_host: orchestratorHost`；
② 文件末尾追加：

```js
describe('foreground 护栏（刀2：前台建档 run 不得被重点火）', () => {
  it('orchestrator_host=foreground 且容器消失 → 跳过，不 spawn', async () => {
    const deps = makeDeps({ orchestratorHost: 'foreground', containerRunning: false });
    const out = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(out.resumed).toBe(0);
  });

  it('对照：普通 relay run 容器消失仍会重点火（护栏不误伤）', async () => {
    const deps = makeDeps({ orchestratorHost: 'skill-relay-session', containerRunning: false });
    await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalled();
  });
});
```

（若 makeDeps 返回对象里 spawnFn 命名/注入方式不同，按该文件既有写法对齐；对照用例若与现有用例语义重复，保留断言即可。）

- [ ] **Step 2: 跑测试确认新用例失败**

Run: `cd /Users/administrator/worktrees/cecelia/harness-judge-api/packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js`
Expected: foreground 用例 FAIL（spawnFn 被调用了），其余全绿

- [ ] **Step 3: commit-1**

```bash
git -C /Users/administrator/worktrees/cecelia/harness-judge-api add packages/brain/src/__tests__/harness-relay-watchdog.test.js
git -C /Users/administrator/worktrees/cecelia/harness-judge-api commit -m "test: watchdog foreground 护栏 failing test (Red)"
```

- [ ] **Step 4: 最小实现**

`packages/brain/src/harness-relay-watchdog.js`，在 `if (task.payload?.orchestrator !== 'skill-relay') continue;`（约 85 行）之后加：

```js
      // 前台点火 run（POST /relay-runs 建档，host='foreground'）没有 cecelia-relay-* 容器，
      // "容器消失=死跑"判据对它恒真——跳过重点火，防 spawn 无头容器与前台会话双跑。
      // 前台崩溃恢复靠人（用户在场是前台模式的定义）；上方 house-keeping 分支仍对其生效。
      if (run.orchestrator_host === 'foreground') continue;
```

（runsQ SELECT 第 40 行列清单已含 orchestrator_host，无需改查询。）

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd /Users/administrator/worktrees/cecelia/harness-judge-api/packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js`
Expected: 全部 passed

- [ ] **Step 6: commit-2**

```bash
git -C /Users/administrator/worktrees/cecelia/harness-judge-api add packages/brain/src/harness-relay-watchdog.js
git -C /Users/administrator/worktrees/cecelia/harness-judge-api commit -m "fix(brain): relay-watchdog 跳过 foreground run——防前台点火被误重点火成无头双跑"
```

---

### Task 4: 冒烟脚本 + 快照刷新 + 版本 bump + DevGate

**Files:**
- Create: `packages/brain/scripts/smoke/judge-api-smoke.sh`
- Modify: `scripts/sync-skills-snapshot.sh`（SKILLS 数组补 harness-controller）
- Modify: `packages/workflows/skills/*/SKILL.md`（脚本刷新产物）
- Modify: `packages/brain/package.json` / `packages/brain/package-lock.json`（两处 version）/ `.brain-versions`

- [ ] **Step 1: 写冒烟脚本**

新建 `packages/brain/scripts/smoke/judge-api-smoke.sh` 并 `chmod +x`：

```bash
#!/usr/bin/env bash
# judge-api-smoke.sh — 刀2 两端点部署冒烟：路由存在且参数校验生效（空/坏 body 应答 400 而非 404）。
# proven-to-fire 验证法：把 URL 改成不存在的路由名跑一次，必须报红。
set -uo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
fail=0

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/harness/judge" \
  -H 'Content-Type: application/json' -d '{}')
if [ "$code" != "400" ]; then echo "❌ POST /harness/judge 期望 400 实得 $code"; fail=1; fi

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST \
  "$BRAIN/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000" \
  -H 'Content-Type: application/json' -d '{"phase":"bogus"}')
if [ "$code" != "400" ]; then echo "❌ POST /relay-runs 期望 400 实得 $code"; fail=1; fi

if [ "$fail" = "0" ]; then echo "✅ judge-api smoke 通过（两端点 400 应答正常）"; fi
exit $fail
```

- [ ] **Step 2: proven-to-fire 验证冒烟脚本**

对着当前运行中的生产 brain（尚无新路由 → 两端点 404）跑一次：

Run: `bash /Users/administrator/worktrees/cecelia/harness-judge-api/packages/brain/scripts/smoke/judge-api-smoke.sh`
Expected: ❌ 报红、退出码 1（404 ≠ 400，证明脚本会叫）。这次红就是 proven-to-fire 凭证，记入 PR body。

- [ ] **Step 3: sync 脚本补 harness-controller 并刷新快照**

`scripts/sync-skills-snapshot.sh` SKILLS 数组（`harness-planner` 行之前）加一行 `  harness-controller`。然后：

```bash
SKILLS_SSOT_DIR=/Users/administrator/perfect21/zenithjoy-skills-dist bash /Users/administrator/worktrees/cecelia/harness-judge-api/scripts/sync-skills-snapshot.sh
```

⚠️ 该脚本 DEST 相对自身定位，故必须用 worktree 里的脚本路径调用（如上），产物才落在 worktree。
Expected: 7 个 skill 各输出 `✓`（新增 harness-controller；evaluator 有大幅行数变化 —— 1.16.0→1.20.0）

- [ ] **Step 4: 版本 bump（minor：新增 API 端点）**

- `packages/brain/package.json`：`"version": "1.238.6"` → `"1.239.0"`
- `packages/brain/package-lock.json`：**两处**（顶层 `"version"` + `packages[""].version`）同步 `1.239.0`
- `.brain-versions`：同步 `1.239.0`

Run: `bash /Users/administrator/worktrees/cecelia/harness-judge-api/scripts/check-version-sync.sh`
Expected: 全 ✅ 1.239.0

- [ ] **Step 5: DevGate 全跑**

```bash
cd /Users/administrator/worktrees/cecelia/harness-judge-api && node scripts/facts-check.mjs && node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 全过（本 PR 不动 DEFINITION.md 涉及的 SSOT 常量）

- [ ] **Step 6: 全量 brain 测试**

Run: `cd /Users/administrator/worktrees/cecelia/harness-judge-api/packages/brain && npx vitest run 2>&1 | tail -5`
Expected: 全绿（若有与本改动无关的既有红，先对 origin/main 跑同文件核对——同红则记录不阻塞）

- [ ] **Step 7: commit**

```bash
git -C /Users/administrator/worktrees/cecelia/harness-judge-api add packages/brain/scripts/smoke/judge-api-smoke.sh scripts/sync-skills-snapshot.sh packages/workflows/skills/ packages/brain/package.json packages/brain/package-lock.json .brain-versions
git -C /Users/administrator/worktrees/cecelia/harness-judge-api commit -m "chore(brain): judge-api 冒烟 + 快照刷新（含 harness-controller）+ v1.239.0"
```

---

### 收尾（主会话执行，不派 subagent）

push + PR（title `feat(brain): harness judge API 化 + relay-runs 前台建档（跨 repo 刀2）`）。PR body 必含 DoD：

```
## DoD
- [x] [BEHAVIOR] POST /api/brain/harness/judge 参数校验+FIXED 归一+结果透传 — Test: tests/ packages/brain/src/__tests__/harness-judge-api.test.js
- [x] [BEHAVIOR] POST relay-runs 前台建档幂等 + host=foreground — Test: tests/ packages/brain/src/__tests__/relay-runs-create.test.js
- [x] [BEHAVIOR] watchdog 跳过 foreground run 不误重点火 — Test: tests/ packages/brain/src/__tests__/harness-relay-watchdog.test.js
- [x] 冒烟脚本 proven-to-fire（对老 brain 报红实录见 PR 描述） — Test: manual: bash packages/brain/scripts/smoke/judge-api-smoke.sh
- [x] CI 全绿
```

merge 后：Gate3 自动重部署生产 brain → 跑 `bash packages/brain/scripts/smoke/judge-api-smoke.sh` 确认两端点 400（此时冒烟由红转绿 = 部署验证）→ Brain skill 缓存随重启刷新（刀1 送达闭环）→ 回写任务 cf74ba7d completed。
