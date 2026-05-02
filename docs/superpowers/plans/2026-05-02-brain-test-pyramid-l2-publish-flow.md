# brain-test-pyramid L2 PR1: publish-flow Integration Test 移位计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `tests/integration/publish-flow.integration.test.js` 移到 `packages/brain/src/__tests__/integration/`，修正 import 路径，写 PRD/DoD/Learning，开 PR。

**Architecture:** 纯文件迁移 + import 路径修正。源文件 4 处 `../../packages/brain/src/` 前缀改为 `../`（相对于 `__tests__/integration/` 新位置）。不改测试逻辑本身。

**Tech Stack:** Node.js ESM, Vitest, Express, supertest, pg

---

### Task 1: 复制并修正 import 路径

**Files:**
- Create: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [ ] **Step 1: 确认目标目录存在**

```bash
ls packages/brain/src/__tests__/integration/
```

Expected: 目录存在，列出若干 `.integration.test.js` 文件。

- [ ] **Step 2: 复制文件到目标路径并修正 4 处 import**

将以下内容写入 `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`：

```javascript
/**
 * Publish Flow Integration Test
 *
 * 链路：端到端发布流程
 *   POST publish-job (pending)
 *   → DB 直写 running（模拟 worker 启动）
 *   → POST publish-results（N8N 回写结果）
 *   → GET publish-results（验证结果可查）
 *   → DB 直写 success + completed_at（模拟 worker 完成）
 *
 * 路由：
 *   packages/brain/src/routes/publish-jobs.js   → /api/brain/publish-jobs
 *   packages/brain/src/routes/publish-results.js → /api/brain/publish-results
 *
 * 运行环境：CI integration-core job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

vi.mock('../publish-monitor.js', () => ({
  monitorPublishQueue: vi.fn().mockResolvedValue(undefined),
  getPublishStats: vi.fn().mockResolvedValue({ today_total: 0, cached: true }),
}));

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });
const jobIds = [];
const resultIds = [];

let app;

beforeAll(async () => {
  const [jobsMod, resultsMod] = await Promise.all([
    import('../routes/publish-jobs.js'),
    import('../routes/publish-results.js'),
  ]);
  app = express();
  app.use(express.json());
  app.use('/api/brain', jobsMod.default);
  app.use('/api/brain', resultsMod.default);
});

afterAll(async () => {
  if (jobIds.length) {
    await pool.query(
      'DELETE FROM content_publish_jobs WHERE id = ANY($1::uuid[])',
      [jobIds]
    );
  }
  if (resultIds.length) {
    await pool.query(
      'DELETE FROM publish_results WHERE id = ANY($1::bigint[])',
      [resultIds]
    );
  }
  await pool.end();
});

// ─── 正常发布流程（happy path）────────────────────────────────────────────────

describe('Publish Flow: 成功路径（pending → running → success）', () => {
  let jobId;
  let resultId;

  it('Step 1 — POST publish-job，初始状态 pending', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({
        platform: 'wechat',
        content_type: 'article',
        payload: { title: '[integration-test] 发布流程测试文章' },
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('pending');
    jobId = res.body.id;
    jobIds.push(jobId);
  });

  it('Step 2 — worker 启动（DB 直写 running + started_at）', async () => {
    await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'running', started_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
    const { rows } = await pool.query(
      'SELECT status, started_at FROM content_publish_jobs WHERE id = $1',
      [jobId]
    );
    expect(rows[0].status).toBe('running');
    expect(rows[0].started_at).not.toBeNull();
  });

  it('Step 3 — POST publish-results（N8N 回写成功结果）', async () => {
    const res = await request(app)
      .post('/api/brain/publish-results')
      .send({
        platform: 'wechat',
        contentType: 'article',
        success: true,
        workId: 'wechat_article_test_001',
        url: 'https://mp.weixin.qq.com/s/test001',
        title: '[integration-test] 发布流程测试文章',
        taskId: jobId,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
    resultId = res.body.id;
    resultIds.push(resultId);
  });

  it('Step 4 — GET publish-results 可查到刚写入的结果', async () => {
    const res = await request(app)
      .get('/api/brain/publish-results?platform=wechat')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    const found = res.body.results.find((r) => r.task_id === jobId);
    expect(found).toBeDefined();
    expect(found.success).toBe(true);
    expect(found.work_id).toBe('wechat_article_test_001');
  });

  it('Step 5 — worker 完成（DB 直写 success + completed_at）', async () => {
    await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'success', completed_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
    const { rows } = await pool.query(
      'SELECT status, started_at, completed_at FROM content_publish_jobs WHERE id = $1',
      [jobId]
    );
    expect(rows[0].status).toBe('success');
    expect(rows[0].started_at).not.toBeNull();
    expect(rows[0].completed_at).not.toBeNull();
    expect(new Date(rows[0].completed_at).getTime()).toBeGreaterThanOrEqual(
      new Date(rows[0].started_at).getTime()
    );
  });
});

// ─── 失败路径（failed → retry）────────────────────────────────────────────────

describe('Publish Flow: 失败路径（failed → retry → pending）', () => {
  let jobId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'douyin', content_type: 'video' });
    jobId = res.body.id;
    jobIds.push(jobId);
    await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'failed', error_message = 'upload timeout', started_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
  });

  it('GET publish-results — 写入失败结果', async () => {
    const res = await request(app)
      .post('/api/brain/publish-results')
      .send({
        platform: 'douyin',
        contentType: 'video',
        success: false,
        error: 'upload timeout',
        taskId: jobId,
      })
      .expect(200);
    resultIds.push(res.body.id);
    expect(res.body.success).toBe(true);
  });

  it('retry — 重置 failed job 为 pending', async () => {
    const res = await request(app)
      .post(`/api/brain/publish-jobs/retry/${jobId}`)
      .expect(200);
    expect(res.body.status).toBe('pending');
  });
});

// ─── 参数校验 ─────────────────────────────────────────────────────────────────

describe('Publish Flow: 参数校验', () => {
  it('POST publish-results — 缺少 platform → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-results')
      .send({ success: true })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('POST publish-results — success 为字符串 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-results')
      .send({ platform: 'wechat', success: 'yes' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/boolean/i);
  });

  it('POST publish-jobs — 非法 status 值 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'wechat', content_type: 'article', status: 'launched' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });
});
```

- [ ] **Step 3: 验证语法**

```bash
cd packages/brain && node --check src/__tests__/integration/publish-flow.integration.test.js && echo "syntax OK"
```

Expected: `syntax OK`

- [ ] **Step 4: Commit（测试文件）**

```bash
git add packages/brain/src/__tests__/integration/publish-flow.integration.test.js
git commit -m "test(brain): publish-flow integration test — pending→running→results→success 端到端链路 [brain-test-pyramid L2 PR1]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 写 PRD.md、DoD.md、Learning

**Files:**
- Create: `PRD.md`（worktree 根目录）
- Create: `DoD.md`（worktree 根目录）
- Create: `docs/learnings/cp-MMDDHHNN-brain-test-pyramid-l2-publish-flow.md`

- [ ] **Step 1: 写 PRD.md**

内容：

```markdown
# PRD — brain-test-pyramid L2 PR1: publish-flow integration test

## 背景
content_publish_jobs 端到端发布流程缺少 integration test，现有单元测试全部 mock DB，无法验证真实持久化行为。

## 目标
为发布流程写完整 integration test：POST 创建 job（pending）→ DB 直写 running → POST publish-results → GET 验证可查 → DB 直写 success，以及失败路径 failed → retry → pending，参数校验 400 响应。

## 成功标准

- [ ] publish-flow.integration.test.js 存在于 packages/brain/src/__tests__/integration/
- [ ] POST /api/brain/publish-jobs 创建 job，返回 status=pending
- [ ] POST /api/brain/publish-results 写入成功结果，GET 可查
- [ ] retry 接口重置 failed job 为 pending
- [ ] 缺少 platform 参数返回 400，success 类型错误返回 400
- [ ] afterAll 清理自身创建的数据
```

- [ ] **Step 2: 写 DoD.md**

内容：

```markdown
# DoD — brain-test-pyramid L2 PR1: publish-flow integration test

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/publish-flow.integration.test.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/publish-flow.integration.test.js')"`

- [x] [BEHAVIOR] POST /api/brain/publish-jobs 创建 job 返回 status=pending
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [x] [BEHAVIOR] DB 直写 running + 回写 results + GET 验证可查
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [x] [BEHAVIOR] retry 接口将 failed job 重置为 pending
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [x] [BEHAVIOR] 缺少 platform 或 success 类型错误返回 400
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`

- [x] [BEHAVIOR] afterAll 清理 content_publish_jobs + publish_results 数据
  Test: `packages/brain/src/__tests__/integration/publish-flow.integration.test.js`
```

- [ ] **Step 3: 写 Learning**

文件命名：`docs/learnings/cp-MMDDHHNN-brain-test-pyramid-l2-publish-flow.md`（用实际北京时间）

内容：

```markdown
## brain-test-pyramid Layer 2 PR1: publish-flow integration test（2026-05-02）

### 根本原因
发布流程测试全部 mock DB，无法验证 content_publish_jobs 真实持久化。Integration test 补全端到端链路验证。

### 下次预防
- [ ] 新增 publish 相关路由时，同步添加 integration test 覆盖 pending→running→success 链路
- [ ] 参数校验路径（400 响应）必须在 integration test 中单独验证
```

- [ ] **Step 4: Commit（文档）**

```bash
git add PRD.md DoD.md docs/learnings/cp-*-brain-test-pyramid-l2-publish-flow.md
git commit -m "docs: PRD/DoD/Learning — brain-test-pyramid L2 PR1 publish-flow

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Push + PR

- [ ] **Step 1: Push 分支**

```bash
git push origin HEAD
```

- [ ] **Step 2: 创建 PR**

```bash
gh pr create \
  --title "test(brain): publish-flow integration test — brain-test-pyramid L2 PR1" \
  --body "$(cat <<'EOF'
## Summary
- 端到端发布流程 integration test：POST job(pending) → DB写running → POST results → GET验证 → DB写success
- 失败路径：failed → retry → pending
- 参数校验：缺 platform / success 类型错误 → 400
- afterAll 清理 content_publish_jobs + publish_results

## Test Plan
- [ ] brain-integration CI job 通过（真实 PostgreSQL）
- [ ] DoD 全部 [x] 验证

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: 等 CI 完成并确认通过**

```bash
gh pr checks --watch
```
