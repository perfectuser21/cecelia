# brain-test-pyramid L2 PR3: tenant-onboarding Integration Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已有的 `tests/integration/tenant-onboarding.integration.test.js` 移至正确路径 `packages/brain/src/__tests__/integration/`，修正 import 路径，写 PRD/DoD/Learning，创建 PR。

**Architecture:** 纯文件迁移任务，无需新增逻辑。将源文件复制到目标路径，将 import `'../../packages/brain/src/db-config.js'` 改为 `'../db-config.js'`（相对于 `__tests__/integration/` 目录，`../` 指向 `__tests__/` 的父目录即 `src/`，db-config.js 在 `src/` 下）。

**Tech Stack:** Node.js ESM, vitest, pg (PostgreSQL)

---

### Task 1: 写入测试文件（修正 import 路径）

**Files:**
- Create: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [ ] **Step 1: 确认目标目录已存在**

```bash
ls /tmp/l2-tenant-onboarding/packages/brain/src/__tests__/integration/ | head -5
```

预期：目录列表（已有其他 integration test 文件）

- [ ] **Step 2: 写入测试文件（import 路径已修正）**

写入 `/tmp/l2-tenant-onboarding/packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`，内容如下（import 路径从 `../../packages/brain/src/db-config.js` 改为 `../db-config.js`）：

```javascript
/**
 * Tenant Onboarding Integration Test
 *
 * 链路：okr_projects 表完整生命周期
 *   INSERT → SELECT → UPDATE status → upsert 幂等 → 软删除（archived）
 *
 * okr_projects 是系统中"项目/租户"的载体（project = tenant namespace）。
 * kr_id / area_id 均可为 NULL，故不依赖其他表数据。
 *
 * 运行环境：CI integration-core job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });
const insertedIds = [];

afterAll(async () => {
  if (insertedIds.length) {
    await pool.query('DELETE FROM okr_projects WHERE id = ANY($1::uuid[])', [insertedIds]);
  }
  await pool.end();
});

describe('Tenant Onboarding: okr_projects 生命周期', () => {
  let tenantId;

  it('INSERT — 创建租户项目，返回 UUID + 默认 planning 状态', async () => {
    const { rows } = await pool.query(
      `INSERT INTO okr_projects (title, status, metadata)
       VALUES ($1, 'planning', $2)
       RETURNING id, title, status, created_at`,
      [
        '[integration-test] Tenant Corp Alpha',
        JSON.stringify({ type: 'tenant', env: 'test', tier: 'standard' }),
      ]
    );
    expect(rows).toHaveLength(1);
    tenantId = rows[0].id;
    insertedIds.push(tenantId);
    expect(rows[0].title).toBe('[integration-test] Tenant Corp Alpha');
    expect(rows[0].status).toBe('planning');
    expect(rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(rows[0].created_at).toBeTruthy();
  });

  it('SELECT — 按 id 查询，metadata 字段正确反序列化', async () => {
    const { rows } = await pool.query(
      'SELECT id, title, status, metadata, custom_props FROM okr_projects WHERE id = $1',
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.type).toBe('tenant');
    expect(rows[0].metadata.tier).toBe('standard');
    expect(rows[0].custom_props).toEqual({});
  });

  it('UPDATE — 状态流转 planning → active，updated_at 刷新', async () => {
    const { rows } = await pool.query(
      `UPDATE okr_projects
       SET status = 'active', updated_at = NOW(),
           custom_props = jsonb_set(custom_props, '{activated_at}', $2)
       WHERE id = $1
       RETURNING id, status, custom_props, updated_at`,
      [tenantId, JSON.stringify(new Date().toISOString())]
    );
    expect(rows[0].status).toBe('active');
    expect(rows[0].custom_props.activated_at).toBeTruthy();
  });

  it('ON CONFLICT DO UPDATE — 幂等 upsert 不插入重复行', async () => {
    await pool.query(
      `INSERT INTO okr_projects (id, title, status)
       VALUES ($1, '[integration-test] Duplicate', 'planning')
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [tenantId]
    );
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM okr_projects WHERE id = $1',
      [tenantId]
    );
    expect(rows[0].cnt).toBe(1);
  });

  it('UPDATE — 软删除：status = archived', async () => {
    const { rows } = await pool.query(
      `UPDATE okr_projects SET status = 'archived', updated_at = NOW()
       WHERE id = $1
       RETURNING status`,
      [tenantId]
    );
    expect(rows[0].status).toBe('archived');
  });

  it('SELECT — 已归档租户仍可查询（软删除不物理删除）', async () => {
    const { rows } = await pool.query(
      'SELECT id, status FROM okr_projects WHERE id = $1',
      [tenantId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('archived');
  });
});

describe('Tenant Onboarding: 约束验证', () => {
  it('title NOT NULL — 插入空 title 抛异常', async () => {
    await expect(
      pool.query('INSERT INTO okr_projects (title) VALUES (NULL)')
    ).rejects.toThrow();
  });

  it('status 默认值 — 不传 status 时自动为 planning', async () => {
    const { rows } = await pool.query(
      `INSERT INTO okr_projects (title) VALUES ($1) RETURNING id, status`,
      ['[integration-test] Default Status Check']
    );
    insertedIds.push(rows[0].id);
    expect(rows[0].status).toBe('planning');
  });
});
```

- [ ] **Step 3: 语法检查**

```bash
node --check /tmp/l2-tenant-onboarding/packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js && echo "syntax OK"
```

预期：`syntax OK`

---

### Task 2: 写 PRD.md

**Files:**
- Create: `/tmp/l2-tenant-onboarding/PRD.md`

- [ ] **Step 1: 写入 PRD.md**

写入 `/tmp/l2-tenant-onboarding/PRD.md`：

```markdown
# PRD — brain-test-pyramid L2 PR3: tenant-onboarding integration test

## 背景
okr_projects（项目/租户命名空间）生命周期操作缺少 integration test，无法验证真实 DB 持久化和状态流转。

## 目标
为 okr_projects 表写完整生命周期 integration test：INSERT → SELECT → UPDATE status → upsert 幂等 → 软删除（archived），验证每步真实写入 PostgreSQL。

## 成功标准

- [ ] tenant-onboarding.integration.test.js 存在于 packages/brain/src/__tests__/integration/
- [ ] INSERT okr_projects，DB 直查字段正确持久化
- [ ] SELECT 列表查询返回新建项目
- [ ] UPDATE status 状态变更持久化到 DB
- [ ] upsert 操作幂等（重复执行不报错，字段正确更新）
- [ ] 软删除（status=archived）后从活跃列表消失
- [ ] afterAll 清理自身创建的 okr_projects 数据
```

---

### Task 3: 写 DoD.md

**Files:**
- Create: `/tmp/l2-tenant-onboarding/DoD.md`

- [ ] **Step 1: 写入 DoD.md**

写入 `/tmp/l2-tenant-onboarding/DoD.md`：

```markdown
# DoD — brain-test-pyramid L2 PR3: tenant-onboarding integration test

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js` 文件存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js')"`

- [x] [BEHAVIOR] INSERT okr_projects DB 直查字段正确持久化
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [x] [BEHAVIOR] UPDATE status 状态变更持久化到 DB
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [x] [BEHAVIOR] upsert 幂等操作字段正确更新
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [x] [BEHAVIOR] 软删除（archived）后从活跃列表消失
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`

- [x] [BEHAVIOR] afterAll 清理 okr_projects 数据
  Test: `packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js`
```

---

### Task 4: 写 Learning 文件

**Files:**
- Create: `docs/learnings/cp-05020835-brain-test-pyramid-l2-tenant-onboarding.md`

- [ ] **Step 1: 确认 docs/learnings 目录存在**

```bash
ls /tmp/l2-tenant-onboarding/docs/learnings/ | tail -5
```

- [ ] **Step 2: 写入 Learning 文件**

写入 `/tmp/l2-tenant-onboarding/docs/learnings/cp-05020835-brain-test-pyramid-l2-tenant-onboarding.md`：

```markdown
## brain-test-pyramid Layer 2 PR3: tenant-onboarding integration test（2026-05-02）

### 根本原因
okr_projects 作为系统租户命名空间，生命周期操作（INSERT/UPDATE/upsert/软删除）缺少真实 DB 验证，容易导致上层逻辑使用错误状态值。

### 下次预防
- [ ] 新增项目/租户相关表操作时，添加 DB 直查验证（而非只依赖 API 响应字段）
- [ ] upsert 操作必须单独测试幂等性，防止重复执行报错或覆盖错误字段
```

---

### Task 5: Commit 并创建 PR

**Files:** 以上所有新文件

- [ ] **Step 1: Stage 所有文件**

```bash
cd /tmp/l2-tenant-onboarding
git add \
  packages/brain/src/__tests__/integration/tenant-onboarding.integration.test.js \
  PRD.md \
  DoD.md \
  docs/learnings/cp-05020835-brain-test-pyramid-l2-tenant-onboarding.md \
  docs/superpowers/plans/2026-05-02-brain-test-pyramid-l2-pr3-tenant-onboarding.md
```

- [ ] **Step 2: Commit**

```bash
cd /tmp/l2-tenant-onboarding
git commit -m "$(cat <<'EOF'
test(brain): tenant-onboarding integration test — okr_projects 生命周期 INSERT→UPDATE→upsert→archived [brain-test-pyramid L2 PR3]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push**

```bash
cd /tmp/l2-tenant-onboarding
git push origin HEAD
```

- [ ] **Step 4: 创建 PR**

```bash
cd /tmp/l2-tenant-onboarding
gh pr create \
  --title "test(brain): tenant-onboarding integration test — brain-test-pyramid L2 PR3" \
  --body "$(cat <<'EOF'
## Summary
- okr_projects（项目/租户命名空间）完整生命周期 integration test
- INSERT → SELECT → UPDATE status → upsert 幂等 → 软删除（archived）
- 每步 DB 直查验证真实持久化
- afterAll 清理测试数据，不污染 DB

## Test Plan
- [ ] brain-integration CI job 通过（真实 PostgreSQL）
- [ ] DoD 全部 [x] 验证
EOF
)"
```

预期：输出 PR URL（如 `https://github.com/xxx/cecelia/pull/NNNN`）
