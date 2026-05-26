# Sprint D — Harness Pipeline × Brain DB 7张表集成 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 Harness pipeline 与 Brain DB 7张表的三个集成点：planner 读 7 张表注入上下文、proposer 读注册表防冲突、evaluator PASS 回写 feature thickness。

**Architecture:** 分两层改动——Brain 代码层（journeys.js + registry.js + execution.js，走 PR + CI）+ Skill 层（harness-planner/SKILL.md + harness-contract-proposer/SKILL.md，直接改本地文件）。Brain 代码变更含完整 vitest 单元测试。feature_id 从 harness_initiative.payload 开始传播，经 propose→review→generate→evaluate 链路，最终在 PASS 分支执行 PATCH。

**Tech Stack:** Node.js ESM, Express, PostgreSQL (pg), vitest, supertest

---

## 文件结构

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/brain/src/routes/journeys.js` | 修改 | 在 POST /journey_features（第72行）之前添加 GET /journey_features |
| `packages/brain/src/routes/registry.js` | 修改 | 第99行 `registered_at` → `created_at` |
| `packages/brain/src/routes/execution.js` | 修改 | 5处 createHarnessTask payload 加 feature_id，PASS 分支加 thickness write-back |
| `packages/brain/src/routes/__tests__/journeys-get-features.test.js` | 新建 | GET /journey_features 单元测试 |
| `packages/brain/src/routes/__tests__/registry-created-at.test.js` | 新建 | registry 不报500的单元测试 |
| `packages/brain/src/routes/__tests__/harness-feature-propagation.test.js` | 新建 | feature_id 传播 + thickness write-back 集成测试 |
| `packages/brain/scripts/smoke/sprint-d-7table-smoke.sh` | 新建 | E2E smoke 脚本 |
| `~/.claude/skills/harness-planner/SKILL.md` | 修改 | Step 0.1 添加 6 个 curl 查询（本地文件，不走 CI） |
| `~/.claude/skills/harness-contract-proposer/SKILL.md` | 修改 | Step 2 开头添加 registry 查询（本地文件，不走 CI） |

---

## Task 1: 新增 GET /api/brain/journey_features + 修复 registered_at

**Files:**
- Modify: `packages/brain/src/routes/journeys.js:72` (在 POST 之前插入)
- Modify: `packages/brain/src/routes/registry.js:99`
- Create: `packages/brain/src/routes/__tests__/journeys-get-features.test.js`
- Create: `packages/brain/src/routes/__tests__/registry-created-at.test.js`

- [ ] **Step 1: 写失败测试 — GET /journey_features**

新建 `packages/brain/src/routes/__tests__/journeys-get-features.test.js`：

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('GET /api/brain/journey_features', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);
  });

  it('不带参数返回全部 features', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'f1', name: 'feat1', journey_id: 'j1', thickness: 'thin' }],
    });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe('f1');
  });

  it('按 journey_id 过滤', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'f2', name: 'feat2', journey_id: 'jj-uuid', thickness: 'medium' }],
    });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features?journey_id=jj-uuid');
    expect(res.status).toBe(200);
    expect(res.body[0].journey_id).toBe('jj-uuid');
    // 验证 SQL 含 journey_id 参数
    expect(mockQuery.mock.calls[0][1]).toContain('jj-uuid');
  });

  it('DB 报错时返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features');
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
cd /Users/administrator/worktrees/cecelia/sprint-d-harness-7table-integration
npx vitest run packages/brain/src/routes/__tests__/journeys-get-features.test.js --reporter=verbose 2>&1 | tail -20
```

期望：FAIL（GET route 不存在，404）

- [ ] **Step 3: 写失败测试 — registry 不报 500**

新建 `packages/brain/src/routes/__tests__/registry-created-at.test.js`：

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('GET /api/brain/registry — registered_at fix', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: router } = await import('../registry.js');
    const express = await import('express');
    app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);
  });

  it('SELECT 查询用 created_at 而不是 registered_at', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/registry');
    expect(res.status).toBe(200);
    // 验证 SQL 字符串含 created_at 而不是 registered_at
    const sqlCall = mockQuery.mock.calls[0][0];
    expect(sqlCall).toContain('created_at');
    expect(sqlCall).not.toContain('registered_at');
  });
});
```

- [ ] **Step 4: 确认 registry 测试失败**

```bash
npx vitest run packages/brain/src/routes/__tests__/registry-created-at.test.js --reporter=verbose 2>&1 | tail -15
```

期望：FAIL（当前 SQL 含 `registered_at`）

- [ ] **Step 5: 实现 GET /journey_features**

修改 `packages/brain/src/routes/journeys.js`，在第72行（`// POST /api/brain/journey_features` 之前）插入：

```javascript
// GET /api/brain/journey_features
router.get('/journey_features', async (req, res) => {
  try {
    const { journey_id, area, status, limit = 100 } = req.query;
    const params = [];
    const clauses = [];
    if (journey_id) { params.push(journey_id); clauses.push(`journey_id=$${params.length}`); }
    if (area)       { params.push(area);       clauses.push(`area_id=(SELECT id FROM areas WHERE name=$${params.length} LIMIT 1)`); }
    if (status)     { params.push(status);     clauses.push(`status=$${params.length}`); }
    params.push(parseInt(limit, 10) || 100);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM journey_features ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[journeys] GET /journey_features error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

```

- [ ] **Step 6: 修复 registry.js registered_at → created_at**

修改 `packages/brain/src/routes/registry.js` 第99行，将：
```javascript
      `SELECT id, name, type, location, status, description, metadata, registered_at, updated_at
```
改为：
```javascript
      `SELECT id, name, type, location, status, description, metadata, created_at, updated_at
```

- [ ] **Step 7: 运行测试确认通过**

```bash
npx vitest run packages/brain/src/routes/__tests__/journeys-get-features.test.js packages/brain/src/routes/__tests__/registry-created-at.test.js --reporter=verbose 2>&1 | tail -20
```

期望：所有测试 PASS

- [ ] **Step 8: Commit**

```bash
git add packages/brain/src/routes/journeys.js \
        packages/brain/src/routes/registry.js \
        packages/brain/src/routes/__tests__/journeys-get-features.test.js \
        packages/brain/src/routes/__tests__/registry-created-at.test.js
git commit -m "$(cat <<'EOF'
feat(brain): GET /journey_features route + fix registry created_at column

- Add GET /api/brain/journey_features with journey_id/area/status filters
- Fix registry.js: registered_at → created_at (column does not exist bug)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: execution.js — feature_id 在 harness 链中传播

**Files:**
- Modify: `packages/brain/src/routes/execution.js` (5处 createHarnessTask payload)
- Create: `packages/brain/src/routes/__tests__/harness-feature-propagation.test.js`

- [ ] **Step 1: 写失败测试**

新建 `packages/brain/src/routes/__tests__/harness-feature-propagation.test.js`：

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 所有外部依赖
const mockQuery = vi.fn();
const mockFetch = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../../../actions.js', () => ({ createTask: vi.fn().mockResolvedValue({ id: 'new-task-id' }) }));

// fetch 全局 mock
global.fetch = mockFetch;

describe('harness execution-callback: feature_id 传播', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('harness_planner 完成 → harness_contract_propose 含 feature_id', async () => {
    const createdTasks = [];
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT task_type') && params[0] === 'planner-task-id') {
        return { rows: [{ task_type: 'harness_planner', project_id: 'proj-1', goal_id: 'goal-1', title: 'test', payload: { sprint_dir: 'sprints/test', feature_id: 'feat-uuid-999' } }] };
      }
      if (sql.includes('SELECT status')) return { rows: [] };
      if (sql.includes('SELECT id FROM tasks WHERE task_type')) return { rows: [] }; // no existing proposer
      if (sql.includes('SELECT branch FROM dev_records')) return { rows: [] };
      if (sql.includes('INSERT INTO tasks')) {
        createdTasks.push(JSON.parse(params[2])); // payload is 3rd param
        return { rows: [{ id: 'created-task-id' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    // 导入 execution 路由并直接调用内部逻辑比较复杂，
    // 改为验证 createTask 调用时 feature_id 存在
    const { createTask } = await import('../../../actions.js');
    createTask.mockImplementation(async (params) => {
      createdTasks.push(params);
      return { id: 'new-id' };
    });

    // 模拟 harness_planner callback 触发
    const express = await import('express');
    const request = await import('supertest');
    const { default: router } = await import('../execution.js');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    await request.default(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: 'planner-task-id', status: 'AI Done', result: null, run_id: 'r1' });

    // 找到 harness_contract_propose 类型的任务创建
    const proposeTask = createdTasks.find(t => t.task_type === 'harness_contract_propose');
    expect(proposeTask).toBeDefined();
    expect(proposeTask.payload.feature_id).toBe('feat-uuid-999');
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
npx vitest run packages/brain/src/routes/__tests__/harness-feature-propagation.test.js --reporter=verbose 2>&1 | tail -20
```

期望：FAIL（feature_id 未传播，proposeTask.payload.feature_id 为 undefined）

- [ ] **Step 3: 修改 execution.js — 5处 payload 加 feature_id**

**位置1**: 创建 `harness_contract_propose`（~line 1762）

找到这段代码：
```javascript
              payload: {
                sprint_dir: sprintDir,
                planner_task_id: task_id,
                planner_branch: plannerBranch,
                propose_round: 1,
                harness_mode: true
              }
```
改为：
```javascript
              payload: {
                sprint_dir: sprintDir,
                planner_task_id: task_id,
                planner_branch: plannerBranch,
                propose_round: 1,
                harness_mode: true,
                feature_id: harnessPayload.feature_id || null,
              }
```

**位置2**: 创建 `harness_contract_review`（~line 1831）

找到这段代码：
```javascript
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch,
                propose_task_id: task_id,
                propose_branch: proposeBranch,
                propose_round: proposeRound,
                harness_mode: true
              }
```
改为：
```javascript
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch,
                propose_task_id: task_id,
                propose_branch: proposeBranch,
                propose_round: proposeRound,
                harness_mode: true,
                feature_id: harnessPayload.feature_id || null,
              }
```

**位置3**: 创建下一轮 `harness_contract_propose`（REVISION，~line 1953）

找到这段代码：
```javascript
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch,
                propose_round: nextRound,
                review_feedback_task_id: task_id,
                review_branch: reviewBranch,
                harness_mode: true
              }
```
改为：
```javascript
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch,
                propose_round: nextRound,
                review_feedback_task_id: task_id,
                review_branch: reviewBranch,
                harness_mode: true,
                feature_id: harnessPayload.feature_id || null,
              }
```

**位置4**: 创建 `harness_evaluate`（from harness_generate，~line 2152）

找到这段代码：
```javascript
                payload: {
                  sprint_dir: harnessPayload.sprint_dir,
                  pr_url: prUrl,
                  dev_task_id: task_id,
                  planner_task_id: harnessPayload.planner_task_id,
                  planner_branch: harnessPayload.planner_branch || null,
                  contract_branch: harnessPayload.contract_branch,
                  project_id: harnessTask.project_id,
                  eval_round: 1,
                  harness_mode: true
                }
```
改为：
```javascript
                payload: {
                  sprint_dir: harnessPayload.sprint_dir,
                  pr_url: prUrl,
                  dev_task_id: task_id,
                  planner_task_id: harnessPayload.planner_task_id,
                  planner_branch: harnessPayload.planner_branch || null,
                  contract_branch: harnessPayload.contract_branch,
                  project_id: harnessTask.project_id,
                  eval_round: 1,
                  harness_mode: true,
                  feature_id: harnessPayload.feature_id || null,
                }
```

**位置5**: 创建 `harness_evaluate`（from harness_fix，~line 2237）

找到这段代码：
```javascript
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                pr_url: prUrl,
                dev_task_id: harnessPayload.dev_task_id || task_id,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch || null,
                contract_branch: harnessPayload.contract_branch,
                eval_round: evalRound + 1,
                harness_mode: true
              }
```
改为：
```javascript
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                pr_url: prUrl,
                dev_task_id: harnessPayload.dev_task_id || task_id,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch || null,
                contract_branch: harnessPayload.contract_branch,
                eval_round: evalRound + 1,
                harness_mode: true,
                feature_id: harnessPayload.feature_id || null,
              }
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run packages/brain/src/routes/__tests__/harness-feature-propagation.test.js --reporter=verbose 2>&1 | tail -20
```

期望：PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/execution.js \
        packages/brain/src/routes/__tests__/harness-feature-propagation.test.js
git commit -m "$(cat <<'EOF'
feat(brain): propagate feature_id through harness task chain

Pass feature_id from harness_initiative payload to all downstream
harness tasks (propose→review→generate→evaluate) so evaluator PASS
can write back journey_features.thickness.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: execution.js — evaluator PASS 回写 thickness

**Files:**
- Modify: `packages/brain/src/routes/execution.js` (~line 2397, PASS 分支 Step 3 之后)
- Modify: `packages/brain/src/routes/__tests__/harness-feature-propagation.test.js` (添加 thickness 测试)

- [ ] **Step 1: 添加 thickness write-back 测试**

在 `packages/brain/src/routes/__tests__/harness-feature-propagation.test.js` 追加：

```javascript
  it('harness_evaluate PASS → PATCH journey_features.thickness = medium', async () => {
    const patchCalls = [];
    mockFetch.mockImplementation(async (url, opts) => {
      if (url.includes('/journey_features/feat-uuid-888')) {
        patchCalls.push({ url, body: JSON.parse(opts.body) });
      }
      return { ok: true, json: async () => ({ id: 'feat-uuid-888', thickness: 'medium' }) };
    });

    // mock tasks 表行（harness_evaluate with feature_id）
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT task_type') && params[0] === 'eval-task-id') {
        return { rows: [{ task_type: 'harness_evaluate', project_id: 'proj-1', goal_id: null, title: 'eval', payload: { sprint_dir: 'sprints/test', eval_round: 1, pr_url: null, feature_id: 'feat-uuid-888', harness_mode: true } }] };
      }
      if (sql.includes('SELECT status')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });

    // 模拟 PASS 结果
    const express = await import('express');
    const request = await import('supertest');
    const { default: router } = await import('../execution.js');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    await request.default(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: 'eval-task-id',
        status: 'AI Done',
        result: { verdict: 'PASS', summary: 'all checks passed' },
        run_id: 'r2'
      });

    const thicknessPatch = patchCalls.find(c => c.url.includes('feat-uuid-888'));
    expect(thicknessPatch).toBeDefined();
    expect(thicknessPatch.body.thickness).toBe('medium');
  });

  it('harness_evaluate PASS + feature_id 为 null → 不调用 PATCH', async () => {
    const patchCalls = [];
    mockFetch.mockImplementation(async (url, opts) => {
      if (url.includes('/journey_features/')) patchCalls.push(url);
      return { ok: true, json: async () => ({}) };
    });

    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT task_type') && params[0] === 'eval-no-feat-id') {
        return { rows: [{ task_type: 'harness_evaluate', project_id: 'proj-2', goal_id: null, title: 'eval2', payload: { sprint_dir: 'sprints/t2', eval_round: 1, pr_url: null, harness_mode: true } }] };
      }
      if (sql.includes('SELECT status')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });

    const express = await import('express');
    const request = await import('supertest');
    const { default: router } = await import('../execution.js');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    await request.default(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: 'eval-no-feat-id', status: 'AI Done', result: { verdict: 'PASS' }, run_id: 'r3' });

    const thicknessCalls = patchCalls.filter(u => u.includes('/journey_features/'));
    expect(thicknessCalls.length).toBe(0);
  });
```

- [ ] **Step 2: 确认测试失败**

```bash
npx vitest run packages/brain/src/routes/__tests__/harness-feature-propagation.test.js --reporter=verbose 2>&1 | tail -20
```

期望：thickness write-back 测试 FAIL

- [ ] **Step 3: 实现 thickness write-back**

在 `packages/brain/src/routes/execution.js` 的 `if (evalVerdict === 'PASS')` 分支中，找到 "Step 3" 的 smoke test 代码块结束处（约 line 2399）：

```javascript
            } catch (smokeErr) {
              console.warn(`[execution-callback] harness: smoke test failed (non-fatal): ${smokeErr.message}`);
            }

            // Step 4: 创建 Report
```

在 `// Step 4: 创建 Report` 注释之前插入以下代码：

```javascript
            // Step 3.5: 回写 Feature thickness（thin → medium）
            const featureId = harnessPayload.feature_id;
            if (featureId) {
              try {
                const patchResp = await fetch(`http://localhost:5221/api/brain/journey_features/${featureId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ thickness: 'medium' }),
                });
                if (patchResp.ok) {
                  console.log(`[execution-callback] harness: Feature ${featureId} thickness → medium (evaluator PASS)`);
                } else {
                  console.warn(`[execution-callback] harness: thickness PATCH failed ${patchResp.status} (non-fatal)`);
                }
              } catch (thickErr) {
                console.warn(`[execution-callback] harness: thickness PATCH error (non-fatal): ${thickErr.message}`);
              }
            }

```

- [ ] **Step 4: 运行全部 harness-feature-propagation 测试**

```bash
npx vitest run packages/brain/src/routes/__tests__/harness-feature-propagation.test.js --reporter=verbose 2>&1 | tail -25
```

期望：所有测试 PASS（含 thickness write-back 2个测试）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/routes/execution.js \
        packages/brain/src/routes/__tests__/harness-feature-propagation.test.js
git commit -m "$(cat <<'EOF'
feat(brain): evaluator PASS → auto write-back journey_features.thickness=medium

When harness_evaluate PASS and payload.feature_id is set,
PATCH /api/brain/journey_features/:id with {thickness:'medium'}.
Graceful degradation: failure does not block the PASS pipeline.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Smoke 脚本

**Files:**
- Create: `packages/brain/scripts/smoke/sprint-d-7table-smoke.sh`

- [ ] **Step 1: 创建 smoke 脚本**

```bash
mkdir -p packages/brain/scripts/smoke
```

新建 `packages/brain/scripts/smoke/sprint-d-7table-smoke.sh`：

```bash
#!/bin/bash
# Sprint D — 7张表集成 Smoke Test
# 验证：GET /journey_features、GET /registry（不报500）、thickness write-back
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== Sprint D 7-table smoke ==="

# 1. GET /registry 不报 500
echo "[1] GET /registry?type=skill 不报 500..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/registry?type=skill")
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: registry returned $HTTP_CODE"; exit 1; }
echo "  OK: $HTTP_CODE"

# 2. GET /journey_features 不报 404
echo "[2] GET /journey_features 路由存在..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/journey_features")
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: journey_features returned $HTTP_CODE"; exit 1; }
echo "  OK: $HTTP_CODE"

# 3. 创建测试 journey + feature，验证 GET 过滤
echo "[3] 创建测试 journey..."
JOURNEY=$(curl -sf -X POST "$BRAIN_URL/api/brain/journeys" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Journey D","journey_type":"autonomous","description":"smoke test","e2e_test_path":"none"}')
JOURNEY_ID=$(echo "$JOURNEY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
echo "  journey_id=$JOURNEY_ID"

echo "[4] 创建测试 feature..."
FEATURE=$(curl -sf -X POST "$BRAIN_URL/api/brain/journey_features" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Smoke Feature D\",\"journey_id\":\"$JOURNEY_ID\",\"thickness\":\"thin\"}")
FEATURE_ID=$(echo "$FEATURE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
echo "  feature_id=$FEATURE_ID"

echo "[5] GET /journey_features?journey_id=$JOURNEY_ID 过滤验证..."
FEATURES=$(curl -sf "$BRAIN_URL/api/brain/journey_features?journey_id=$JOURNEY_ID")
COUNT=$(echo "$FEATURES" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
[ "$COUNT" -ge 1 ] || { echo "FAIL: expected >=1 features, got $COUNT"; exit 1; }
echo "  OK: $COUNT feature(s) returned"

echo "[6] PATCH thickness → medium + 验证..."
PATCHED=$(curl -sf -X PATCH "$BRAIN_URL/api/brain/journey_features/$FEATURE_ID" \
  -H "Content-Type: application/json" \
  -d '{"thickness":"medium"}')
THICK=$(echo "$PATCHED" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).thickness))")
[ "$THICK" = "medium" ] || { echo "FAIL: thickness=$THICK expected medium"; exit 1; }
echo "  OK: thickness=$THICK"

echo "✅ Sprint D 7-table smoke 全部通过"
```

- [ ] **Step 2: 给脚本加执行权限并运行**

```bash
chmod +x packages/brain/scripts/smoke/sprint-d-7table-smoke.sh
bash packages/brain/scripts/smoke/sprint-d-7table-smoke.sh
```

期望输出：`✅ Sprint D 7-table smoke 全部通过`

若 Brain 未启动，先启动：
```bash
# 在主 repo 目录
docker compose up -d brain
# 等 10s 后重跑 smoke
```

- [ ] **Step 3: Commit smoke 脚本**

```bash
git add packages/brain/scripts/smoke/sprint-d-7table-smoke.sh
git commit -m "$(cat <<'EOF'
test(brain): Sprint D smoke script — 7-table integration verification

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: harness-planner SKILL.md — 读 7 张表

**Files:**
- Modify: `~/.claude/skills/harness-planner/SKILL.md` (Step 0.1，第155-168行)

注意：此文件在 `~/.claude/skills/` 目录，不在 git 仓库中。直接编辑本地文件。

- [ ] **Step 1: 读取当前 Step 0.1 内容确认**

```bash
grep -n "Step 0.1" ~/.claude/skills/harness-planner/SKILL.md
sed -n '155,170p' ~/.claude/skills/harness-planner/SKILL.md
```

确认当前只有一个 `curl localhost:5221/api/brain/context`。

- [ ] **Step 2: 修改 Step 0.1 — 注入 7 张表查询**

找到这段代码（约第155-168行）：
```markdown
### Step 0.1: 采集系统上下文（Brain API）

```bash
curl localhost:5221/api/brain/context
```

从返回提取：
- **OKR 进度**：当前活跃 KR，判断本任务推进哪个 KR
- **活跃任务**：避免重复
- **最近 PR**：了解系统演进方向
- **有效决策**：PRD 不能与之矛盾

**边界**：只读运行时上下文，不探索代码实现细节。
```

替换为：
```markdown
### Step 0.1: 采集系统上下文（Brain API + 7张表）

```bash
# 1. 运行时上下文（OKR/活跃任务/最近PR/有效决策）
curl -sf localhost:5221/api/brain/context

# 2. Journey + Feature 上下文（从 task payload 提取 journey_id）
# JOURNEY_ID 由 cecelia-run 通过 CECELIA_JOURNEY_ID 环境变量注入
JOURNEY_ID="${CECELIA_JOURNEY_ID:-}"
if [ -n "$JOURNEY_ID" ]; then
  echo "=== Journey Context ==="
  curl -sf "localhost:5221/api/brain/journeys/$JOURNEY_ID" | jq '{name,journey_type,maturity,status}' || true
  echo "=== Existing Features (avoid duplication) ==="
  curl -sf "localhost:5221/api/brain/journey_features?journey_id=$JOURNEY_ID" \
    | jq '[.[] | {name,thickness,status}]' || true
fi

# 3. 已注册 API（避免命名冲突）
echo "=== Registered API Endpoints ==="
curl -sf "localhost:5221/api/brain/registry?type=api_endpoint&limit=100" \
  | jq '[.[] | {name,location,description}]' 2>/dev/null || echo "[]"

# 4. 已注册 DB Schema（避免重复建表/字段）
echo "=== Registered DB Schema ==="
curl -sf "localhost:5221/api/brain/registry?type=db_schema&limit=100" \
  | jq '[.[] | {name,description}]' 2>/dev/null || echo "[]"

# 5. 已注册 Tests（了解测试覆盖现状）
echo "=== Registered Tests ==="
curl -sf "localhost:5221/api/brain/registry?type=test&limit=50" \
  | jq '[.[] | {name,location}]' 2>/dev/null || echo "[]"

# 6. 已注册 Skills（了解现有 skill 边界）
echo "=== Registered Skills ==="
curl -sf "localhost:5221/api/brain/registry?type=skill&limit=50" \
  | jq '[.[] | {name,description}]' 2>/dev/null || echo "[]"
```

从返回提取并注入 PRD 上下文：
- **OKR 进度**：当前活跃 KR，判断本任务推进哪个 KR
- **已有 Features**：本 Journey 已有哪些，不要在 PRD 里重复定义
- **已注册 API**：避免与现有路由命名冲突
- **已注册 DB Schema**：避免重复建表或字段名冲突
- **有效决策**：PRD 不能与之矛盾

**边界**：只读运行时上下文，不探索代码实现细节。所有 curl 加 `|| true` 防失败阻塞。
```

- [ ] **Step 3: 验证修改内容**

```bash
grep -c "curl" ~/.claude/skills/harness-planner/SKILL.md | head -5
# 期望 Step 0.1 区域内有 >=6 个 curl 命令
sed -n '155,210p' ~/.claude/skills/harness-planner/SKILL.md
```

期望：Step 0.1 代码块内有6个 curl 查询。

---

## Task 6: harness-contract-proposer SKILL.md — 读 registry 防冲突

**Files:**
- Modify: `~/.claude/skills/harness-contract-proposer/SKILL.md` (Step 2 开头)

注意：此文件在 `~/.claude/skills/` 目录，不在 git 仓库中。

- [ ] **Step 1: 定位 Step 2 开头**

```bash
grep -n "Step 2:" ~/.claude/skills/harness-contract-proposer/SKILL.md | head -5
```

记录行号（通常在 `### Step 2: 写合同草案` 附近）。

- [ ] **Step 2: 在 Step 2 代码块开头插入 registry 查询**

在 `### Step 2: 写合同草案（Golden Path 格式）` 的 `### Step 1: 读取 PRD` 之后，`### Step 2:` 代码块开头插入以下内容：

```bash
# === 读注册表（写合同前先查防冲突）===
EXISTING_APIS=$(curl -sf "localhost:5221/api/brain/registry?type=api_endpoint&limit=100" \
  | jq '[.[] | {name,location}]' 2>/dev/null || echo "[]")
EXISTING_SCHEMAS=$(curl -sf "localhost:5221/api/brain/registry?type=db_schema&limit=100" \
  | jq '[.[] | {name,description}]' 2>/dev/null || echo "[]")
echo "=== 已注册 API（命名不能冲突）==="
echo "$EXISTING_APIS"
echo "=== 已注册 DB Schema（不要重复定义表/字段）==="
echo "$EXISTING_SCHEMAS"
```

同时，在合同草案的 Workstreams 说明之前加入防冲突提示段：

```markdown
## 注册表防冲突检查（写合同前必读）

**已注册 API Endpoints**（新 endpoint 命名不得与之重复）:
<由上方 $EXISTING_APIS 填入>

**已注册 DB Schema**（新建表/字段不得与之冲突）:
<由上方 $EXISTING_SCHEMAS 填入>
```

- [ ] **Step 3: 验证修改**

```bash
grep -n "EXISTING_APIS\|EXISTING_SCHEMAS\|registry" ~/.claude/skills/harness-contract-proposer/SKILL.md | head -10
```

期望：至少2处含 `EXISTING_APIS`/`EXISTING_SCHEMAS` 的引用。

---

## Task 7: 运行全套测试 + 推 PR

**Files:**（无新增，验证阶段）

- [ ] **Step 1: 运行全部 Brain 单元测试**

```bash
cd /Users/administrator/worktrees/cecelia/sprint-d-harness-7table-integration
npx vitest run packages/brain/src/routes/__tests__/ --reporter=verbose 2>&1 | tail -40
```

期望：所有测试 PASS，无新失败。

- [ ] **Step 2: 确认 smoke 脚本通过**

```bash
bash packages/brain/scripts/smoke/sprint-d-7table-smoke.sh
```

期望：`✅ Sprint D 7-table smoke 全部通过`

- [ ] **Step 3: 检查需要 feat: 的 DoD**

```bash
cat > DoD.sprint-d-7table-integration.md << 'EOF'
# Sprint D — Harness × 7张表集成 DoD

## ARTIFACT 条目

- [x] [ARTIFACT] GET /api/brain/journey_features 路由存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/journeys.js','utf8');if(!c.includes(\"GET /api/brain/journey_features\"))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] registry.js 不含 registered_at
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/registry.js','utf8');if(c.includes('registered_at'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] execution.js PASS 分支含 thickness write-back
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('Feature thickness'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] smoke 脚本存在
  Test: node -e "require('fs').accessSync('packages/brain/scripts/smoke/sprint-d-7table-smoke.sh')"

## BEHAVIOR 条目

- [x] [BEHAVIOR] GET /journey_features 返回 200
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/journey_features); [ "$CODE" = "200" ] && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] GET /registry?type=skill 返回 200（registered_at fix）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5221/api/brain/registry?type=skill"); [ "$CODE" = "200" ] && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] POST journey_feature + GET 过滤返回数据
  Test: manual:bash -c 'JID=$(curl -sf -X POST http://localhost:5221/api/brain/journeys -H "Content-Type: application/json" -d "{\"name\":\"DoD Test J\",\"journey_type\":\"autonomous\",\"description\":\"d\",\"e2e_test_path\":\"n\"}" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>console.log(JSON.parse(d).id))"); curl -sf -X POST http://localhost:5221/api/brain/journey_features -H "Content-Type: application/json" -d "{\"name\":\"DoD F\",\"journey_id\":\"$JID\"}"; COUNT=$(curl -sf "http://localhost:5221/api/brain/journey_features?journey_id=$JID" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>console.log(JSON.parse(d).length))"); [ "$COUNT" -ge 1 ] && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] PATCH thickness medium 成功
  Test: manual:bash -c 'FID=$(curl -sf -X POST http://localhost:5221/api/brain/journey_features -H "Content-Type: application/json" -d "{\"name\":\"DoD Thick\"}" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>console.log(JSON.parse(d).id))"); THICK=$(curl -sf -X PATCH "http://localhost:5221/api/brain/journey_features/$FID" -H "Content-Type: application/json" -d "{\"thickness\":\"medium\"}" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>console.log(JSON.parse(d).thickness))"); [ "$THICK" = "medium" ] && echo OK || exit 1'
  期望: OK
EOF
```

- [ ] **Step 4: 推送 + 创建 PR**

```bash
git add DoD.sprint-d-7table-integration.md
git commit -m "$(cat <<'EOF'
docs: Sprint D DoD checklist

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin cp-0522232056-sprint-d-harness-7table-integration

gh pr create \
  --title "feat(brain): Sprint D — harness pipeline × 7-table DB integration" \
  --body "$(cat <<'EOF'
## Summary

- Add `GET /api/brain/journey_features` route with journey_id/area/status filters
- Fix `registered_at` → `created_at` column name in registry.js (was causing 500 on all /registry queries)
- Propagate `feature_id` through harness task chain (propose→review→generate→evaluate)
- Auto write-back `journey_features.thickness = 'medium'` when `harness_evaluate` PASS
- New smoke script: `packages/brain/scripts/smoke/sprint-d-7table-smoke.sh`
- Update harness-planner SKILL.md Step 0.1: reads 7 Brain DB tables for context
- Update harness-contract-proposer SKILL.md: queries api_registry + db_schema_registry before writing contract

## Test Plan
- [ ] vitest unit tests pass (journeys-get-features, registry-created-at, harness-feature-propagation)
- [ ] smoke script passes: `bash packages/brain/scripts/smoke/sprint-d-7table-smoke.sh`
- [ ] CI green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 自审清单（Self-Review）

**Spec 覆盖检查：**
- ✅ GET /journey_features → Task 1
- ✅ registered_at fix → Task 1
- ✅ feature_id propagation (5处) → Task 2
- ✅ evaluator PASS thickness write-back → Task 3
- ✅ smoke script → Task 4
- ✅ harness-planner 7-table queries → Task 5
- ✅ harness-contract-proposer registry → Task 6

**Placeholder 检查：**
- 无 TBD/TODO
- 所有代码块含完整代码
- 所有测试含具体 expect 断言

**类型一致性：**
- `feature_id` 字段名全程一致
- `harnessPayload.feature_id` 读法一致
- PATCH URL 格式：`/api/brain/journey_features/:id` 一致
