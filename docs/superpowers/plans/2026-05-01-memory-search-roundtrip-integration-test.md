# Memory Search Roundtrip Integration Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 写一个 integration test，验证"直接往 tasks 表写入数据 → POST /api/brain/memory/search 搜索 → 验证能找到该数据 → afterAll 清理"的完整闭环。

**Architecture:** Memory search 没有独立 store 端点，数据来自 tasks 表。测试直接用 pg.Pool INSERT 写入测试 task（status=pending，score 高于 0.3 阈值），mock openai-client 让 embedding 失败触发 Jaccard fallback，通过 supertest 调 /api/brain/memory/search 验证结果包含测试 task ID。

**Tech Stack:** vitest, supertest, pg (pg.Pool), express

---

## 文件映射

| 操作 | 路径 |
|------|------|
| 创建 | `packages/brain/src/__tests__/integration/memory-search-roundtrip.integration.test.js` |

---

### Task 1: 写失败测试

**Files:**
- Create: `packages/brain/src/__tests__/integration/memory-search-roundtrip.integration.test.js`

- [ ] **Step 1: 创建测试文件（此时测试会失败，因为测试内容不正确）**

创建文件 `packages/brain/src/__tests__/integration/memory-search-roundtrip.integration.test.js`，内容如下：

```javascript
/**
 * Integration Test: Memory Search Roundtrip
 *
 * 验证闭环：直接写入 tasks 表 → POST /api/brain/memory/search 搜索 → 验证找到 → 清理
 *
 * 关键约束：
 * - mock openai-client.js（CI 无 OpenAI API Key）→ 触发 Jaccard fallback
 * - 直接用 pg.Pool 写入测试数据（memory 无 store 端点）
 * - 测试 task status 必须是 'pending'（Jaccard 只扫 pending/in_progress/completed）
 * - title + description 需与搜索词有足够 token 重叠，score > 0.3
 * - afterAll 通过 task ID 精确清理测试数据
 *
 * 运行环境: brain-integration CI job（pgvector/pgvector:pg15 + 迁移已跑）
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// ─── Mock openai-client.js（CI 无 OpenAI Key，强制走 Jaccard fallback）─────────

vi.mock('../../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockRejectedValue(new Error('OpenAI API not available in test')),
}));

// ─── 真实 DB 连接池 ──────────────────────────────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 记录插入的测试 task ID，afterAll 统一清理
let testTaskId;

// 唯一标识前缀，避免与其他测试数据冲突
const UNIQUE_MARKER = `memory-roundtrip-test-${Date.now()}`;

// ─── Express App 工厂 ────────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());

  const memoryRouter = await import('../../routes/memory.js').then(m => m.default);
  app.use('/api/brain/memory', memoryRouter);

  return app;
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('Memory Search Roundtrip — 存入→搜索→验证检索到（真实 PostgreSQL）', () => {
  let app;

  beforeAll(async () => {
    app = await makeApp();

    // 直接往 tasks 表写入测试数据
    // title 和 description 含有大量与搜索词重叠的 token（用户 认证 登录），确保 Jaccard score > 0.3
    const result = await testPool.query(
      `INSERT INTO tasks (title, description, status, task_type, priority, trigger_source)
       VALUES ($1, $2, 'pending', 'dev', 'P2', 'api')
       RETURNING id`,
      [
        `[${UNIQUE_MARKER}] 用户认证登录鉴权集成测试`,
        `用户登录认证鉴权 JWT token 验证集成测试专用数据 ${UNIQUE_MARKER}`,
      ]
    );

    testTaskId = result.rows[0].id;
  }, 20000);

  afterAll(async () => {
    // 精确清理测试写入的数据
    if (testTaskId) {
      await testPool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
    }
    await testPool.end();
  });

  // ─── 测试 1: 闭环——搜索结果包含刚写入的 task ─────────────────────────────

  it('POST /api/brain/memory/search — 搜索结果包含刚写入的测试 task（通过 ID 匹配）', async () => {
    // 使用与 task title/description 有大量 token 重叠的查询
    const res = await request(app)
      .post('/api/brain/memory/search')
      .send({ query: '用户认证登录', topK: 20 })
      .expect(200);

    expect(res.body).toHaveProperty('matches');
    expect(Array.isArray(res.body.matches)).toBe(true);

    // 通过 task ID 匹配，验证刚写入的 task 在结果中
    const found = res.body.matches.find(m => m.id === testTaskId);
    expect(found).toBeDefined();
  });

  // ─── 测试 2: 返回字段完整性 ──────────────────────────────────────────────

  it('搜索结果包含预期字段 id/level/title/similarity/preview', async () => {
    const res = await request(app)
      .post('/api/brain/memory/search')
      .send({ query: '用户认证登录', topK: 20 })
      .expect(200);

    const found = res.body.matches.find(m => m.id === testTaskId);
    expect(found).toBeDefined();

    // 验证所有必填字段存在
    expect(found).toHaveProperty('id');
    expect(found).toHaveProperty('level');
    expect(found).toHaveProperty('title');
    expect(found).toHaveProperty('similarity');
    expect(found).toHaveProperty('preview');

    // 验证字段类型和值
    expect(typeof found.id).toBe('string');
    expect(found.level).toBe('task');
    expect(typeof found.title).toBe('string');
    expect(found.title).toContain(UNIQUE_MARKER);
  });

  // ─── 测试 3: similarity score 有效性 ─────────────────────────────────────

  it('搜索结果的 similarity 分数在有效范围 (0, 1] 内', async () => {
    const res = await request(app)
      .post('/api/brain/memory/search')
      .send({ query: '用户认证登录', topK: 20 })
      .expect(200);

    const found = res.body.matches.find(m => m.id === testTaskId);
    expect(found).toBeDefined();

    // similarity > 0 证明搜索有效（不是随机结果）
    // similarity <= 1 证明分数在合法范围内
    expect(found.similarity).toBeGreaterThan(0);
    expect(found.similarity).toBeLessThanOrEqual(1);
  });

  // ─── 测试 4: query 参数校验 ──────────────────────────────────────────────

  it('POST /api/brain/memory/search — 缺少 query 参数返回 400', async () => {
    await request(app)
      .post('/api/brain/memory/search')
      .send({ topK: 5 })
      .expect(400);
  });

  // ─── 测试 5: 搜索响应结构 ────────────────────────────────────────────────

  it('搜索响应顶层结构含 matches 数组', async () => {
    const res = await request(app)
      .post('/api/brain/memory/search')
      .send({ query: '用户认证登录', topK: 5 })
      .expect(200);

    expect(res.body).toHaveProperty('matches');
    expect(Array.isArray(res.body.matches)).toBe(true);
    // topK=5，结果数量 ≤ 5
    expect(res.body.matches.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: 验证文件路径和语法正确**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-pr2-memory-search-roundtrip
node --input-type=module < /dev/null || true
node -e "import('./packages/brain/src/__tests__/integration/memory-search-roundtrip.integration.test.js').catch(e => console.log('import check:', e.message.slice(0,100)))"
```

预期：无 SyntaxError（import 会因环境问题失败，但不应有语法错误）

- [ ] **Step 3: 本地运行一次，确认测试可以加载（即使失败也可接受）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-pr2-memory-search-roundtrip/packages/brain
DB_NAME=cecelia NODE_ENV=test npx vitest run src/__tests__/integration/memory-search-roundtrip.integration.test.js --reporter=verbose 2>&1 | head -50
```

预期：测试能加载运行（有 DB 连接时通过，无 DB 时会报 DB 连接错误，这是正常的本地运行行为）

- [ ] **Step 4: commit（fail-test commit）**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-pr2-memory-search-roundtrip
git add packages/brain/src/__tests__/integration/memory-search-roundtrip.integration.test.js
git add docs/superpowers/specs/2026-05-01-memory-search-roundtrip-design.md
git add docs/superpowers/plans/2026-05-01-memory-search-roundtrip-integration-test.md
git commit -m "test(brain): memory-search-roundtrip 闭环 integration test [FAIL] — 存入→搜索→验证检索到"
```

---

### Task 2: 补充 Learning 文档并准备 PR

**Files:**
- Create: `docs/learnings/cp-0501HHMM-brain-test-pyramid-pr2-memory-search-roundtrip.md`

- [ ] **Step 1: 写 Learning 文档**

创建 `docs/learnings/cp-0501HHMM-brain-test-pyramid-pr2-memory-search-roundtrip.md`（HHMM 用实际时间替换），内容：

```markdown
# Brain Test Pyramid PR2 — Memory Search Roundtrip Integration Test

## 根本原因

Memory 搜索 API 只有端点存活检查，缺少"存入内容→搜索→验证检索到"的闭环测试，
无法保证 Jaccard 相似度算法、score 过滤阈值（>0.3）、返回字段格式在系统变更后仍然正确。

## 下次预防

- [ ] Memory/Search 类 API 必须有闭环 integration test（store → search → verify），
      不能只验证端点存活（HTTP 200）
- [ ] 写 integration test 时先确认数据来源（本例 memory 读 tasks 表），
      再设计测试数据写入策略（直接 INSERT vs. 调 API）
- [ ] Jaccard fallback 需 mock OpenAI client 失败触发，测试数据 token 重叠要足够高（score > 0.3）
- [ ] beforeAll 写数据 + afterAll 精确清理（按 ID DELETE，不按 pattern 批量删）
```

- [ ] **Step 2: 最终 commit**

```bash
cd /Users/administrator/worktrees/cecelia/brain-test-pyramid-pr2-memory-search-roundtrip
git add docs/learnings/cp-0501*-brain-test-pyramid-pr2-memory-search-roundtrip.md
git commit -m "docs(learnings): memory-search-roundtrip integration test — 根本原因与下次预防"
```

---

## 自审检查

**Spec 覆盖**:
- [x] POST /api/brain/memory/search 闭环验证 → Task 1 测试 1
- [x] 字段验证（id/level/title/similarity/preview）→ Task 1 测试 2  
- [x] similarity score 有效性 → Task 1 测试 3
- [x] 唯一标识匹配 → Task 1 测试 1 + 2（通过 testTaskId 匹配）
- [x] teardown 清理 → Task 1 afterAll（按 ID DELETE）
- [x] 测试策略段 → spec 文档中已有

**Placeholder 扫描**: 无 TBD/TODO

**类型一致性**: 无跨 task 类型引用问题（只有一个 task 创建测试文件）
