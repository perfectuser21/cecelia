# 刀4 阶段1：staging_e2e 派生端点 实施计划

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development。步骤用 checkbox 追踪。

**Goal:** 新增 POST /api/brain/harness/staging-e2e，把 staging_e2e 任务派生迁出 LangGraph 图，供 controller merge 后调用。

**Architecture:** 复刻 mergePrNode._spawnStagingE2eTask 的幂等 INSERT（WHERE NOT EXISTS by pr_url），封成 Express 路由。零行为冲突（图侧死派生原样保留到阶段3 删）。

**Worktree:** /Users/administrator/worktrees/cecelia/dao4-staging-e2e-endpoint（分支 cp-0708090251-dao4-staging-e2e-endpoint）

**环境铁则：** git 用 `git -C <worktree> ...`；Write/Edit 被 guard 拦则用 Bash python heredoc；测试用子 shell `(cd <worktree>/packages/brain && npx vitest run <file>)`；node_modules 缺失时软链主仓（`ln -sfn /Users/administrator/perfect21/cecelia/node_modules <wt>/node_modules` + packages/brain 同理），禁 npm 写命令。

---

### Task 1: 端点 + 单测（TDD）

**Files:**
- Modify: packages/brain/src/routes/harness.js（`export default router;` 之前插入路由）
- Test: packages/brain/src/__tests__/harness-staging-e2e-api.test.js（新建，模式抄 harness-judge-api.test.js）

- [ ] Step 1: 写 failing test（新建测试文件）

```js
/**
 * POST /api/brain/harness/staging-e2e — staging_e2e 派生端点（刀4 重构阶段1，决策 76ab76ea）。
 * 把 mergePrNode._spawnStagingE2eTask 的幂等建任务逻辑迁出图，供 controller merge 后调用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

async function buildApp() {
  const { default: router } = await import('../routes/harness.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/harness', router);
  return a;
}

describe('POST /api/brain/harness/staging-e2e', () => {
  beforeEach(() => { mockPool.query.mockReset(); });

  it('缺 pr_url → 400，不 INSERT', async () => {
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/staging-e2e').send({ initiative_id: 'i1' });
    expect(r.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('新建成功 → 200 {created:true}，payload 字段齐全', async () => {
    mockPool.query.mockResolvedValue({ rowCount: 1 });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/staging-e2e').send({
      pr_url: 'https://github.com/o/r/pull/9', pr_branch: 'cp-x', sub_task_id: 't1',
      initiative_id: 'i1', journey_id: 'j1', base_repo: 'https://github.com/o/r.git', project_id: 'p1',
    });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);
    // INSERT 调用一次，payload（第 3 参）含全部字段，pr_url（第 4 参）用于幂等
    const call = mockPool.query.mock.calls[0];
    expect(call[0]).toMatch(/INSERT INTO tasks/);
    expect(call[0]).toMatch(/staging_e2e/);
    const payload = JSON.parse(call[1][2]);
    expect(payload).toMatchObject({
      pr_url: 'https://github.com/o/r/pull/9', pr_branch: 'cp-x', sub_task_id: 't1',
      initiative_id: 'i1', journey_id: 'j1', base_repo: 'https://github.com/o/r.git', project_id: 'p1',
    });
    expect(call[1][3]).toBe('https://github.com/o/r/pull/9');
  });

  it('幂等：同 pr_url 已存在（rowCount=0）→ 200 {created:false, reason:already_exists}', async () => {
    mockPool.query.mockResolvedValue({ rowCount: 0 });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/staging-e2e').send({ pr_url: 'https://github.com/o/r/pull/9' });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(false);
    expect(r.body.reason).toBe('already_exists');
  });

  it('可选字段缺省 → payload 用空串占位（不写 null）', async () => {
    mockPool.query.mockResolvedValue({ rowCount: 1 });
    const app = await buildApp();
    await request(app).post('/api/brain/harness/staging-e2e').send({ pr_url: 'https://github.com/o/r/pull/9' });
    const payload = JSON.parse(mockPool.query.mock.calls[0][1][2]);
    expect(payload.pr_branch).toBe('');
    expect(payload.base_repo).toBe('');
    expect(payload.project_id).toBe('');
  });

  it('DB 异常 → 500，不抛未捕获', async () => {
    mockPool.query.mockRejectedValue(new Error('db down'));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/staging-e2e').send({ pr_url: 'https://github.com/o/r/pull/9' });
    expect(r.status).toBe(500);
  });
});
```

- [ ] Step 2: 跑测试确认红：`(cd <wt>/packages/brain && npx vitest run src/__tests__/harness-staging-e2e-api.test.js)` — 预期全 FAIL（路由不存在，404）
- [ ] Step 3: commit-1 Red：`git -C <wt> add packages/brain/src/__tests__/harness-staging-e2e-api.test.js && git -C <wt> commit -m "test(brain): staging-e2e 派生端点 failing test (Red)"`
- [ ] Step 4: 实现（harness.js 的 `export default router;` 之前插入）

```js
/**
 * POST /staging-e2e — staging_e2e 派生端点（刀4 重构阶段1，决策 76ab76ea）。
 * 背景：原派生源 mergePrNode._spawnStagingE2eTask 属 LangGraph 图，skill-relay 迁移后图不跑
 * → staging→production 放行层悬空。本端点把派生迁到图外，供 controller merge 成功后调用；
 * 删图（阶段3）后成为唯一生产者。幂等：按 payload->>'pr_url' WHERE NOT EXISTS 去重（复刻原逻辑）。
 */
router.post('/staging-e2e', async (req, res) => {
  const { pr_url, pr_branch, sub_task_id, initiative_id, journey_id, base_repo, project_id } = req.body || {};
  if (!pr_url) return res.status(400).json({ error: 'pr_url 必填' });
  const payload = {
    pr_url,
    pr_branch: pr_branch || '',
    sub_task_id: sub_task_id || '',
    initiative_id: initiative_id || '',
    journey_id: journey_id || '',
    base_repo: base_repo || '',
    project_id: project_id || '',
  };
  try {
    const r = await pool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       SELECT $1, $2, 'staging_e2e', 'queued', 'P2', $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM tasks WHERE task_type = 'staging_e2e' AND payload->>'pr_url' = $4
       )`,
      [
        `[Staging E2E] ${pr_branch || pr_url}`,
        `Auto-spawned by controller relay (post-merge): deploy :5222 + contract E2E for ${pr_url}`,
        JSON.stringify(payload),
        pr_url,
      ]
    );
    const created = r.rowCount > 0;
    if (created) console.log(`[staging-e2e endpoint] spawned staging_e2e task for pr=${pr_url}`);
    return res.json(created ? { created: true } : { created: false, reason: 'already_exists' });
  } catch (err) {
    console.error('[POST /harness/staging-e2e]', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
});
```

- [ ] Step 5: 跑测试确认全绿（5/5 PASS）
- [ ] Step 6: 跑相邻回归：`(cd <wt>/packages/brain && npx vitest run src/__tests__/harness-judge-api.test.js src/__tests__/harness.routes.test.js)`
- [ ] Step 7: commit-2 Green：`git -C <wt> add packages/brain/src/routes/harness.js && git -C <wt> commit -m "feat(brain): staging-e2e 派生端点——迁出死图，供 controller merge 后建任务 (Green)"`

---

### Task 2: smoke 脚本 + allowlist 登记（feat PR 门禁）

**Files:**
- Create: packages/brain/scripts/smoke/staging-e2e-endpoint-smoke.sh
- Modify: packages/quality/smoke-allowlist.txt

- [ ] Step 1: 写 smoke（CI 兼容纯检查，不真建 task 免污染 DB）

```bash
#!/usr/bin/env bash
# staging-e2e-endpoint-smoke.sh — 刀4 阶段1：staging_e2e 派生端点存在 + 入参校验。
# 只测 400 路径（缺 pr_url），不真建 task 避免 DB 污染。
# proven-to-fire：把路由名改成不存在的跑一次，必须报红（404≠400）。
set -uo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
fail=0
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/harness/staging-e2e" \
  -H 'Content-Type: application/json' -d '{}')
if [ "$code" != "400" ]; then echo "❌ POST /harness/staging-e2e 缺 pr_url 期望 400 实得 $code"; fail=1; fi
if [ "$fail" = "0" ]; then echo "✅ staging-e2e-endpoint smoke 通过（端点存在 + 缺 pr_url 400）"; fi
exit $fail
```
chmod +x 它。

- [ ] Step 2: 登记 allowlist（python 追加 staging-e2e-endpoint-smoke.sh 到 packages/quality/smoke-allowlist.txt，若不存在才加）
- [ ] Step 3: 自跑 smoke 确认绿（需本地 Brain 5221 在跑）+ proven-to-fire（改路由名副本跑一次见红）
- [ ] Step 4: commit：`git -C <wt> add packages/brain/scripts/smoke/staging-e2e-endpoint-smoke.sh packages/quality/smoke-allowlist.txt && git -C <wt> commit -m "test(brain): staging-e2e 端点 smoke + allowlist 登记"`

---

### Task 3: 版本 bump + DevGate

- [ ] Step 1: brain 版本 bump（minor，含 feat）四处同步（package.json/package-lock 两处/.brain-versions/DEFINITION.md），`(cd <wt> && bash scripts/check-version-sync.sh)` 绿
- [ ] Step 2: `(cd <wt> && node scripts/facts-check.mjs)` 绿
- [ ] Step 3: commit version bump
> 注意：全量 brain 套件有既有环境性失败（sprints/ 历史合同 + okr integration），main 基线同红，遇到别修。
