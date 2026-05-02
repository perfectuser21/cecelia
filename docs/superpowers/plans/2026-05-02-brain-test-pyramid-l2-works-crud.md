# brain-test-pyramid L2 PR2: works-crud Integration Test 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已存在的 works-crud integration test 从 repo 根 `tests/integration/` 移到 `packages/brain/src/__tests__/integration/`，修正 import 路径，并补齐 PRD/DoD/Learning，开 PR。

**Architecture:** 纯文件迁移 + import 路径替换。源文件已完整实现 content_publish_jobs CRUD 链路验证（POST 创建 → GET 列表 → DB 直查 → retry 重置 → 参数校验）。目标目录已有其他 integration test，遵循相同模式。

**Tech Stack:** Vitest, Supertest, Express, pg (PostgreSQL)

---

### Task 1: 写测试文件（修正 import 路径后）并验证语法

**Files:**
- Create: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [ ] **Step 1: 写文件（替换 import 路径）**

在 worktree 中创建测试文件，将 3 处 `../../packages/brain/src/` 前缀替换为 `../`：

```bash
# 路径映射：
# ../../packages/brain/src/db-config.js         → ../db-config.js
# ../../packages/brain/src/publish-monitor.js   → ../publish-monitor.js
# ../../packages/brain/src/routes/publish-jobs.js → ../routes/publish-jobs.js
```

文件内容（完整）：

```js
/**
 * Works CRUD Integration Test
 *
 * 链路：content_publish_jobs 完整 CRUD 生命周期
 *   POST 创建 → GET 列表查询 → DB 直查 payload → retry 重置失败 → 参数校验
 *
 * 路由：packages/brain/src/routes/publish-jobs.js
 *   POST   /api/brain/publish-jobs
 *   GET    /api/brain/publish-jobs
 *   POST   /api/brain/publish-jobs/retry/:id
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
const createdIds = [];

let app;

beforeAll(async () => {
  const { default: publishJobsRouter } = await import(
    '../routes/publish-jobs.js'
  );
  app = express();
  app.use(express.json());
  app.use('/api/brain', publishJobsRouter);
});

afterAll(async () => {
  if (createdIds.length) {
    await pool.query(
      'DELETE FROM content_publish_jobs WHERE id = ANY($1::uuid[])',
      [createdIds]
    );
  }
  await pool.end();
});

describe('Works CRUD — Create', () => {
  let workId;

  it('POST /publish-jobs — 创建 wechat article work，返回 201 + pending 状态', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({
        platform: 'wechat',
        content_type: 'article',
        payload: {
          title: '[integration-test] 公众号测试文章',
          keyword: 'test-keyword',
          cover_path: '/tmp/cover.jpg',
        },
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('wechat');
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toMatch(/^[0-9a-f]{8}-/);
    workId = res.body.id;
    createdIds.push(workId);
  });

  it('POST /publish-jobs — 缺少 platform → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ content_type: 'article' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('POST /publish-jobs — 缺少 content_type → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'wechat' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/content_type/i);
  });

  it('POST /publish-jobs — 非法 status → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'wechat', content_type: 'article', status: 'unknown' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Works CRUD — Read', () => {
  let workId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'douyin', content_type: 'video', payload: { title: '[integration-test] 抖音视频' } });
    workId = res.body.id;
    createdIds.push(workId);
  });

  it('GET /publish-jobs — 列表包含刚创建的 work', async () => {
    const res = await request(app).get('/api/brain/publish-jobs').expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    const found = res.body.jobs.find((j) => j.id === workId);
    expect(found).toBeDefined();
    expect(found.platform).toBe('douyin');
  });

  it('GET /publish-jobs?platform=douyin — platform 过滤正确', async () => {
    const res = await request(app)
      .get('/api/brain/publish-jobs?platform=douyin')
      .expect(200);
    const found = res.body.jobs.find((j) => j.id === workId);
    expect(found).toBeDefined();
    const foreign = res.body.jobs.find((j) => j.platform !== 'douyin');
    expect(foreign).toBeUndefined();
  });

  it('DB 直查 — payload JSONB 字段正确持久化', async () => {
    const { rows } = await pool.query(
      'SELECT payload FROM content_publish_jobs WHERE id = $1',
      [workId]
    );
    expect(rows[0].payload.title).toBe('[integration-test] 抖音视频');
  });
});

describe('Works CRUD — Update（retry 重置失败 work）', () => {
  let workId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'kuaishou', content_type: 'video' });
    workId = res.body.id;
    createdIds.push(workId);
    await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'failed', error_message = 'mock network error'
       WHERE id = $1`,
      [workId]
    );
  });

  it('POST /publish-jobs/retry/:id — failed work 重置为 pending', async () => {
    const res = await request(app)
      .post(`/api/brain/publish-jobs/retry/${workId}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('pending');
  });

  it('DB 直查 — retry 后 error_message 已清空', async () => {
    const { rows } = await pool.query(
      'SELECT status, error_message, started_at FROM content_publish_jobs WHERE id = $1',
      [workId]
    );
    expect(rows[0].status).toBe('pending');
    expect(rows[0].error_message).toBeNull();
    expect(rows[0].started_at).toBeNull();
  });

  it('POST /publish-jobs/retry/:id — 不存在的 ID → 404', async () => {
    await request(app)
      .post('/api/brain/publish-jobs/retry/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });
});

describe('Works CRUD — 状态过滤隔离', () => {
  it('GET /publish-jobs?status=pending — 只返回 pending works', async () => {
    const res = await request(app)
      .get('/api/brain/publish-jobs?status=pending')
      .expect(200);
    expect(res.body.jobs.every((j) => j.status === 'pending')).toBe(true);
  });
});
```

- [ ] **Step 2: 语法检查**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-l2-works-crud
node --check packages/brain/src/__tests__/integration/works-crud.integration.test.js && echo "syntax OK"
```

期望输出：`syntax OK`

- [ ] **Step 3: 提交测试文件**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-l2-works-crud
git add packages/brain/src/__tests__/integration/works-crud.integration.test.js
git commit -m "test(brain): add works-crud integration test — content_publish_jobs CRUD 链路

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 写 PRD.md、DoD.md、Learning 文件

**Files:**
- Create: `PRD.md`（worktree 根目录）
- Create: `DoD.md`（worktree 根目录）
- Create: `docs/learnings/cp-05020835-brain-test-pyramid-l2-works-crud.md`

- [ ] **Step 1: 写 PRD.md**

```bash
cat > /Users/administrator/worktrees/cecelia/brain-test-pyramid-l2-works-crud/PRD.md << 'EOF'
# PRD — brain-test-pyramid L2 PR2: works-crud integration test

## 背景
content_publish_jobs CRUD 缺少 integration test，只有 mock 单元测试，无法验证真实 DB 持久化和 API 链路。

## 目标
为 content_publish_jobs 写完整 CRUD integration test：POST 创建 → GET 列表查询 → DB 直查 payload → retry 重置失败 → 参数校验。

## 成功标准

- [ ] works-crud.integration.test.js 存在于 packages/brain/src/__tests__/integration/
- [ ] POST /api/brain/publish-jobs 创建 works，返回 id + status=pending
- [ ] GET /api/brain/publish-jobs 列表可查到新创建的 job
- [ ] DB 直查 payload 字段正确持久化
- [ ] retry 接口重置 failed 状态为 pending
- [ ] 参数错误返回 400
- [ ] afterAll 清理自身创建数据
EOF
```

- [ ] **Step 2: 写 DoD.md**

```bash
cat > /Users/administrator/worktrees/cecelia/brain-test-pyramid-l2-works-crud/DoD.md << 'EOF'
# DoD — brain-test-pyramid L2 PR2: works-crud integration test

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/works-crud.integration.test.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/works-crud.integration.test.js')"`

- [x] [BEHAVIOR] POST /api/brain/publish-jobs 创建 job 返回 id + status=pending
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [x] [BEHAVIOR] GET /api/brain/publish-jobs 列表可查到刚创建的 job
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [x] [BEHAVIOR] DB 直查 payload 字段持久化正确
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [x] [BEHAVIOR] retry 接口将 failed job 重置为 pending
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`

- [x] [BEHAVIOR] afterAll 清理 content_publish_jobs 数据
  Test: `packages/brain/src/__tests__/integration/works-crud.integration.test.js`
EOF
```

- [ ] **Step 3: 写 Learning 文件**

```bash
LEARNING_FILE="/Users/administrator/worktrees/cecelia/brain-test-pyramid-l2-works-crud/docs/learnings/cp-05020835-brain-test-pyramid-l2-works-crud.md"
cat > "$LEARNING_FILE" << 'EOF'
## brain-test-pyramid Layer 2 PR2: works-crud integration test（2026-05-02）

### 根本原因
content_publish_jobs CRUD 接口缺少真实 DB 验证，单元测试全量 mock 导致持久化行为覆盖盲区。integration test 文件最初放在 repo 根 `tests/integration/`，import 路径为 `../../packages/brain/src/`，移到 `packages/brain/src/__tests__/integration/` 后需改为 `../`。

### 下次预防
- [ ] 新增 CRUD 路由时同步添加 integration test，验证 POST+GET+DB直查 三步链路
- [ ] retry 接口必须在 integration test 中覆盖状态回退验证
- [ ] integration test 文件必须直接放在 `packages/brain/src/__tests__/integration/`，避免根目录 `tests/` 的路径引用层级错误
EOF
```

- [ ] **Step 4: 提交所有文档**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-l2-works-crud
git add PRD.md DoD.md docs/learnings/cp-05020835-brain-test-pyramid-l2-works-crud.md \
        docs/superpowers/plans/2026-05-02-brain-test-pyramid-l2-works-crud.md
git commit -m "docs: PRD/DoD/Learning — brain-test-pyramid L2 PR2 works-crud

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Push 并开 PR

**Files:** 无新文件，Git 操作

- [ ] **Step 1: Push 分支**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-l2-works-crud
git push origin HEAD
```

- [ ] **Step 2: 开 PR**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-l2-works-crud
gh pr create \
  --title "test(brain): works-crud integration test — brain-test-pyramid L2 PR2" \
  --body "$(cat <<'PREOF'
## Summary
- content_publish_jobs 完整 CRUD integration test
- POST 创建 → GET 列表查询 → DB 直查 payload → retry 重置失败 → 400 参数校验
- afterAll 清理测试数据

## Test Plan
- [ ] brain-integration CI job 通过（真实 PostgreSQL）
- [ ] DoD 全部 [x] 验证
PREOF
)"
```

- [ ] **Step 3: 记录 PR URL**

输出 PR URL，任务完成。
