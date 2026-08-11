# 美国 M4 只读 MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/mcp-readonly/` 新增一个独立 Node.js 进程，通过 MCP Streamable HTTP 协议，用 Bearer Token 鉴权，给 Notion AI 提供 6 个固定只读工具查询 Cecelia 生产状态（schema版本/map投影/部署状态/Brain日志），不做任何写操作。

**Architecture:** 独立包，独立只读 PostgreSQL 账号，独立连接池，与 `packages/brain` 物理隔离（进程/依赖/故障域）。参见 `docs/superpowers/specs/2026-08-11-readonly-mcp-notion-design.md`。

**Tech Stack:** Node.js (ESM) + Express + `@modelcontextprotocol/sdk`（Streamable HTTP transport）+ `pg` + `express-rate-limit` + `zod` + vitest。

---

## 文件结构总览

```
packages/mcp-readonly/
  package.json
  server.js
  src/
    auth.js
    db.js
    redact.js
    rate-limit.js
    tools/
      schema-and-deployment.js   # get_schema_version + get_deployment_status
      map-summary.js             # get_map_summary
      map-nodes-edges.js         # get_map_nodes + get_map_edges
      service-logs.js            # get_service_logs
    self-check.js
    alerting.js
  __tests__/
    auth.test.js
    redact.test.js
    db.test.js
    rate-limit.test.js
    tools.test.js
    self-check.test.js
    alerting.test.js
  deploy/
    com.cecelia.mcp-readonly.plist
    deploy.sh
packages/brain/migrations/
  406_mcp_readonly_role.sql   # 编号在 Task 2 实现时重新核对（多任务并发改 migrations 目录）
```

---

### Task 1: 包脚手架

**Files:**
- Create: `packages/mcp-readonly/package.json`
- Create: `packages/mcp-readonly/server.js`（先写最小可运行的健康检查骨架，后续 Task 逐步补全）
- Test: `packages/mcp-readonly/__tests__/health.test.js`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "cecelia-mcp-readonly",
  "type": "module",
  "version": "1.0.0",
  "description": "只读 MCP Server，供 Notion AI 查询 Cecelia 状态",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "express": "^4.18.2",
    "express-rate-limit": "^8.6.0",
    "pg": "^8.12.0",
    "zod": "^4.4.3",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: 写失败测试（健康检查端点）**

```javascript
// packages/mcp-readonly/__tests__/health.test.js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server.js';

describe('GET /health', () => {
  it('返回 200 且包含 uptime 字段', async () => {
    const app = createApp({ skipDbInit: true });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uptime');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/health.test.js`
Expected: FAIL（`../server.js` 里没有 `createApp` 导出）

- [ ] **Step 4: 写最小实现**

```javascript
// packages/mcp-readonly/server.js
import express from 'express';

export function createApp({ skipDbInit = false } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ uptime: process.uptime() });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.MCP_PORT || 8787;
  app.listen(port, () => {
    console.log(`mcp-readonly listening on :${port}`);
  });
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/health.test.js`
Expected: PASS

- [ ] **Step 6: 安装依赖并提交**

```bash
cd packages/mcp-readonly && npm install
cd /Users/administrator/worktrees/cecelia/session-20443b24
git add packages/mcp-readonly/
git commit -m "feat(mcp-readonly): 包脚手架 + 健康检查端点骨架"
```

---

### Task 2: 只读 DB 角色迁移

**Files:**
- Create: `packages/brain/migrations/<N>_mcp_readonly_role.sql`（N = 实现时 `ls packages/brain/migrations/*.sql` 里最大编号 + 1，多任务并发改这个目录，写文件前必须重新 `ls` 确认，不能沿用本计划写死的编号）
- Test: `packages/mcp-readonly/__tests__/db.test.js`（Task 5 一起验证，本 Task 只落 SQL + 手动验证）

- [ ] **Step 1: 核对当前最大迁移编号**

Run: `ls packages/brain/migrations/*.sql | sed -E 's/.*\/([0-9]+)_.*/\1/' | sort -n | tail -1`

把输出的编号 +1，作为本文件编号（下面用 `406` 占位，实现时替换成实际编号）。

- [ ] **Step 2: 写迁移 SQL**

```sql
-- Migration 406: 只读角色，供美国M4 mcp-readonly 服务查询 Cecelia 状态用。
-- 不允许 INSERT/UPDATE/DELETE/DDL，仅 SELECT 指定表。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_readonly') THEN
    CREATE ROLE mcp_readonly WITH LOGIN PASSWORD :'mcp_readonly_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE cecelia TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON schema_version TO mcp_readonly;
GRANT SELECT ON map_manifest_versions TO mcp_readonly;
GRANT SELECT ON map_projection_runs TO mcp_readonly;
GRANT SELECT ON map_projection_nodes TO mcp_readonly;
GRANT SELECT ON map_projection_edges TO mcp_readonly;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  schema_version, map_manifest_versions, map_projection_runs,
  map_projection_nodes, map_projection_edges
FROM mcp_readonly;
```

> 密码用 psql variable（`:'mcp_readonly_password'`）传入，不写死明文；执行时 `psql -v mcp_readonly_password="$(openssl rand -hex 24)" -f 406_mcp_readonly_role.sql`，生成的密码立即写入 1Password CS Vault 新条目 `mcp-readonly-db`，再双写 `~/.credentials/mcp-readonly.env`（chmod 600）。

- [ ] **Step 3: 本地测试库跑一遍迁移，手动验证权限**

Run:
```bash
psql "$TEST_DATABASE_URL" -v mcp_readonly_password="test-local-only" -f packages/brain/migrations/406_mcp_readonly_role.sql
psql "$TEST_DATABASE_URL" -c "SET ROLE mcp_readonly; INSERT INTO schema_version DEFAULT VALUES;"
```
Expected: 第二条命令报 `ERROR: permission denied for table schema_version`（证明只读生效）

- [ ] **Step 4: 提交**

```bash
git add packages/brain/migrations/406_mcp_readonly_role.sql
git commit -m "feat(brain): 新增 mcp_readonly 只读角色迁移"
```

---

### Task 3: 鉴权中间件

**Files:**
- Create: `packages/mcp-readonly/src/auth.js`
- Test: `packages/mcp-readonly/__tests__/auth.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// packages/mcp-readonly/__tests__/auth.test.js
import { describe, it, expect, vi } from 'vitest';
import { bearerAuth } from '../src/auth.js';

function mockReqRes(authHeader) {
  const req = { headers: { authorization: authHeader } };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('bearerAuth', () => {
  const middleware = bearerAuth('correct-token-value');

  it('合法 token 放行', () => {
    const { req, res, next } = mockReqRes('Bearer correct-token-value');
    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('缺失 token 返回 401', () => {
    const { req, res, next } = mockReqRes(undefined);
    middleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('错误 token 返回 401', () => {
    const { req, res, next } = mockReqRes('Bearer wrong-token');
    middleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('畸形 header（无 Bearer 前缀）返回 401', () => {
    const { req, res, next } = mockReqRes('correct-token-value');
    middleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('空字符串 token 返回 401', () => {
    const { req, res, next } = mockReqRes('Bearer ');
    middleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/auth.test.js`
Expected: FAIL（`../src/auth.js` 不存在）

- [ ] **Step 3: 写实现（常量时间比较防时序攻击）**

```javascript
// packages/mcp-readonly/src/auth.js
import { timingSafeEqual } from 'node:crypto';

function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function bearerAuth(expectedToken) {
  return function (req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const token = header.slice('Bearer '.length);
    if (!token || !safeCompare(token, expectedToken)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/auth.test.js`
Expected: PASS（5 条全绿）

- [ ] **Step 5: 提交**

```bash
git add packages/mcp-readonly/src/auth.js packages/mcp-readonly/__tests__/auth.test.js
git commit -m "feat(mcp-readonly): Bearer Token 鉴权中间件，统一401不分类"
```

---

### Task 4: 日志脱敏

**Files:**
- Create: `packages/mcp-readonly/src/redact.js`
- Test: `packages/mcp-readonly/__tests__/redact.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// packages/mcp-readonly/__tests__/redact.test.js
import { describe, it, expect } from 'vitest';
import { redact } from '../src/redact.js';

describe('redact', () => {
  it('遮盖 Bearer token，只留后4位', () => {
    const input = 'Authorization: Bearer abcdef1234567890';
    expect(redact(input)).toBe('Authorization: Bearer ****7890');
  });

  it('遮盖 postgres 连接串密码段', () => {
    const input = 'postgres://user:s3cr3tpass@localhost:5432/cecelia';
    expect(redact(input)).toBe('postgres://user:****@localhost:5432/cecelia');
  });

  it('遮盖 OpenAI 风格密钥 sk-xxx', () => {
    const input = 'using key sk-abcdefghijklmnopqrstuvwx';
    expect(redact(input)).toContain('sk-****');
    expect(redact(input)).not.toContain('abcdefghijklmnopqrstuvwx');
  });

  it('遮盖 GitHub token ghp_xxx', () => {
    const input = 'token=ghp_1234567890abcdefghijklmnopqrstuv';
    expect(redact(input)).toContain('ghp_****');
  });

  it('无敏感内容原样返回', () => {
    const input = 'schema version is 405';
    expect(redact(input)).toBe(input);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/redact.test.js`
Expected: FAIL

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/redact.js
const PATTERNS = [
  { re: /Bearer\s+([A-Za-z0-9._-]{4,})/g, fn: (_m, tok) => `Bearer ****${tok.slice(-4)}` },
  { re: /(:\/\/[^:@\s]+:)([^@\s]+)(@)/g, fn: (_m, pre, _pass, post) => `${pre}****${post}` },
  { re: /sk-[A-Za-z0-9]{16,}/g, fn: () => 'sk-****' },
  { re: /ghp_[A-Za-z0-9]{16,}/g, fn: () => 'ghp_****' },
];

export function redact(text) {
  let out = text;
  for (const { re, fn } of PATTERNS) {
    out = out.replace(re, fn);
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/redact.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/mcp-readonly/src/redact.js packages/mcp-readonly/__tests__/redact.test.js
git commit -m "feat(mcp-readonly): 日志脱敏工具，覆盖token/DB密码/sk-/ghp_格式"
```

---

### Task 5: 只读 DB 连接池 + 超时分级

**Files:**
- Create: `packages/mcp-readonly/src/db.js`
- Test: `packages/mcp-readonly/__tests__/db.test.js`

- [ ] **Step 1: 写失败测试（用真实测试库，走 brain 现有 TEST_DATABASE_URL 约定）**

```javascript
// packages/mcp-readonly/__tests__/db.test.js
import { describe, it, expect, afterAll } from 'vitest';
import { createReadonlyPool, query } from '../src/db.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('db pool', () => {
  const pool = createReadonlyPool(TEST_DB_URL, { max: 5 });

  afterAll(async () => {
    await pool.end();
  });

  it('轻查询 2s 内返回结果', async () => {
    const result = await query(pool, 'SELECT 1 as one', [], { timeoutMs: 2000 });
    expect(result.rows[0].one).toBe(1);
  });

  it('查询超时抛出 timeout 错误', async () => {
    await expect(
      query(pool, 'SELECT pg_sleep(3)', [], { timeoutMs: 100 })
    ).rejects.toThrow('timeout');
  });

  it('连接池 max 上限为 5', () => {
    expect(pool.options.max).toBe(5);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && TEST_DATABASE_URL=$TEST_DATABASE_URL npx vitest run __tests__/db.test.js`
Expected: FAIL（`../src/db.js` 不存在）

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/db.js
import pg from 'pg';
const { Pool } = pg;

export function createReadonlyPool(connectionString, { max = 5 } = {}) {
  return new Pool({ connectionString, max });
}

export async function query(pool, sql, params = [], { timeoutMs = 5000 } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    return await client.query(sql, params);
  } catch (err) {
    if (err.code === '57014') {
      throw new Error('timeout');
    }
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && TEST_DATABASE_URL=$TEST_DATABASE_URL npx vitest run __tests__/db.test.js`
Expected: PASS（无 TEST_DATABASE_URL 时自动 skip，不阻塞 CI 无库环境）

- [ ] **Step 5: 提交**

```bash
git add packages/mcp-readonly/src/db.js packages/mcp-readonly/__tests__/db.test.js
git commit -m "feat(mcp-readonly): 只读连接池，statement_timeout超时分级"
```

---

### Task 6: 限流中间件

**Files:**
- Create: `packages/mcp-readonly/src/rate-limit.js`
- Test: `packages/mcp-readonly/__tests__/rate-limit.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// packages/mcp-readonly/__tests__/rate-limit.test.js
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../src/rate-limit.js';

describe('createRateLimiter', () => {
  it('超过限额返回 429', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 2 }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    await agent.get('/ping').expect(200);
    await agent.get('/ping').expect(200);
    const res = await agent.get('/ping');
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/rate-limit.test.js`
Expected: FAIL

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/rate-limit.js
import rateLimit from 'express-rate-limit';

export function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.headers.authorization || req.ip,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited' });
    },
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/rate-limit.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/mcp-readonly/src/rate-limit.js packages/mcp-readonly/__tests__/rate-limit.test.js
git commit -m "feat(mcp-readonly): 限流中间件，按token分桶，默认20次/分钟"
```

---

### Task 7: 工具 get_schema_version + get_deployment_status

**Files:**
- Create: `packages/mcp-readonly/src/tools/schema-and-deployment.js`
- Test: `packages/mcp-readonly/__tests__/tools.test.js`（本 Task 起，后续工具追加到同一文件）

- [ ] **Step 1: 写失败测试**

```javascript
// packages/mcp-readonly/__tests__/tools.test.js
import { describe, it, expect, vi } from 'vitest';
import { getSchemaVersion, getDeploymentStatus } from '../src/tools/schema-and-deployment.js';

describe('getSchemaVersion', () => {
  it('返回 pool 查询到的最新版本号', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ version: 406 }] });
    const result = await getSchemaVersion(fakePool, fakeQuery);
    expect(result).toEqual({ current_version: 406 });
  });
});

describe('getDeploymentStatus', () => {
  it('返回 commit SHA / branch / uptime', async () => {
    const fakeExec = vi.fn()
      .mockResolvedValueOnce({ stdout: 'abc1234\n' })
      .mockResolvedValueOnce({ stdout: 'main\n' });
    const result = await getDeploymentStatus(fakeExec, { startedAt: Date.now() - 5000 });
    expect(result.commit_sha).toBe('abc1234');
    expect(result.branch).toBe('main');
    expect(result.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/tools.test.js`
Expected: FAIL

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/tools/schema-and-deployment.js
export async function getSchemaVersion(pool, queryFn) {
  const result = await queryFn(pool, 'SELECT MAX(version) as version FROM schema_version', []);
  return { current_version: result.rows[0].version };
}

export async function getDeploymentStatus(execFn, { startedAt }) {
  const shaResult = await execFn('git rev-parse --short HEAD');
  const branchResult = await execFn('git branch --show-current');
  return {
    commit_sha: shaResult.stdout.trim(),
    branch: branchResult.stdout.trim(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/tools.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/mcp-readonly/src/tools/schema-and-deployment.js packages/mcp-readonly/__tests__/tools.test.js
git commit -m "feat(mcp-readonly): get_schema_version + get_deployment_status 工具"
```

---

### Task 8: 工具 get_map_summary

**Files:**
- Create: `packages/mcp-readonly/src/tools/map-summary.js`
- Modify: `packages/mcp-readonly/__tests__/tools.test.js`（追加）

- [ ] **Step 1: 追加失败测试**

```javascript
// 追加到 packages/mcp-readonly/__tests__/tools.test.js
import { getMapSummary } from '../src/tools/map-summary.js';

describe('getMapSummary', () => {
  it('返回 active manifest + 四类对象数量', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'm1', scope_key: 'default', digest: 'd1' }] }) // active manifest
      .mockResolvedValueOnce({ rows: [{ status: 'active', id: 'run1' }] }) // active run
      .mockResolvedValueOnce({ rows: [{ node_type: 'value_stream', count: '3' }, { node_type: 'capability', count: '10' }] }); // node counts

    const result = await getMapSummary(fakePool, fakeQuery);
    expect(result.active_manifest_id).toBe('m1');
    expect(result.projection_status).toBe('active');
    expect(result.node_counts).toEqual({ value_stream: 3, capability: 10 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/tools.test.js -t getMapSummary`
Expected: FAIL

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/tools/map-summary.js
export async function getMapSummary(pool, queryFn) {
  const manifestResult = await queryFn(
    pool,
    `SELECT id, scope_key, digest FROM map_manifest_versions ORDER BY created_at DESC LIMIT 1`,
    []
  );
  const runResult = await queryFn(
    pool,
    `SELECT id, status FROM map_projection_runs WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1`,
    []
  );
  const countsResult = await queryFn(
    pool,
    `SELECT node_type, COUNT(*) as count FROM map_projection_nodes GROUP BY node_type`,
    []
  );

  const node_counts = {};
  for (const row of countsResult.rows) {
    node_counts[row.node_type] = Number(row.count);
  }

  return {
    active_manifest_id: manifestResult.rows[0]?.id ?? null,
    projection_status: runResult.rows[0]?.status ?? 'none',
    node_counts,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/tools.test.js -t getMapSummary`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/mcp-readonly/src/tools/map-summary.js packages/mcp-readonly/__tests__/tools.test.js
git commit -m "feat(mcp-readonly): get_map_summary 工具"
```

---

### Task 9: 工具 get_map_nodes + get_map_edges（含参数校验）

**Files:**
- Create: `packages/mcp-readonly/src/tools/map-nodes-edges.js`
- Modify: `packages/mcp-readonly/__tests__/tools.test.js`（追加）

- [ ] **Step 1: 追加失败测试**

```javascript
// 追加到 packages/mcp-readonly/__tests__/tools.test.js
import { getMapNodes, getMapEdges, ValidationError } from '../src/tools/map-nodes-edges.js';

const VALID_NODE_TYPES = ['value_stream', 'capability', 'cross_cut', 'boundary'];
const VALID_EDGE_TYPES = ['contains', 'depends_on', 'crosses'];

describe('getMapNodes', () => {
  it('合法 node_type + limit 返回查询结果', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [{ id: 'n1', name: 'X' }] });
    const result = await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 50 }, VALID_NODE_TYPES);
    expect(result.rows).toHaveLength(1);
  });

  it('非法 node_type 抛 ValidationError', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapNodes(fakePool, fakeQuery, { node_type: 'not_a_type', limit: 50 }, VALID_NODE_TYPES)
    ).rejects.toThrow(ValidationError);
    expect(fakeQuery).not.toHaveBeenCalled();
  });

  it('limit=0 抛 ValidationError', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 0 }, VALID_NODE_TYPES)
    ).rejects.toThrow(ValidationError);
  });

  it('limit 负数抛 ValidationError', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: -5 }, VALID_NODE_TYPES)
    ).rejects.toThrow(ValidationError);
  });

  it('limit 超过 200 会被 clamp 到 200', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability', limit: 9999 }, VALID_NODE_TYPES);
    expect(fakeQuery.mock.calls[0][2]).toContain(200);
  });

  it('limit 缺省时用 50', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await getMapNodes(fakePool, fakeQuery, { node_type: 'capability' }, VALID_NODE_TYPES);
    expect(fakeQuery.mock.calls[0][2]).toContain(50);
  });
});

describe('getMapEdges', () => {
  it('非法 edge_type 抛 ValidationError', async () => {
    const fakePool = {};
    const fakeQuery = vi.fn();
    await expect(
      getMapEdges(fakePool, fakeQuery, { edge_type: 'bogus', limit: 50 }, VALID_EDGE_TYPES)
    ).rejects.toThrow(ValidationError);
    expect(fakeQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/tools.test.js -t getMapNodes`
Expected: FAIL

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/tools/map-nodes-edges.js
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'invalid_params';
  }
}

function normalizeLimit(limit) {
  if (limit === undefined) return 50;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    throw new ValidationError('limit 必须是正数');
  }
  return Math.min(limit, 200);
}

export async function getMapNodes(pool, queryFn, { node_type, limit } = {}, validTypes) {
  if (!validTypes.includes(node_type)) {
    throw new ValidationError(`node_type 必须是 ${validTypes.join('/')} 之一`);
  }
  const safeLimit = normalizeLimit(limit);
  return queryFn(
    pool,
    `SELECT * FROM map_projection_nodes WHERE node_type = $1 LIMIT $2`,
    [node_type, safeLimit]
  );
}

export async function getMapEdges(pool, queryFn, { edge_type, limit } = {}, validTypes) {
  if (!validTypes.includes(edge_type)) {
    throw new ValidationError(`edge_type 必须是 ${validTypes.join('/')} 之一`);
  }
  const safeLimit = normalizeLimit(limit);
  return queryFn(
    pool,
    `SELECT * FROM map_projection_edges WHERE edge_type = $1 LIMIT $2`,
    [edge_type, safeLimit]
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/tools.test.js -t "getMapNodes|getMapEdges"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/mcp-readonly/src/tools/map-nodes-edges.js packages/mcp-readonly/__tests__/tools.test.js
git commit -m "feat(mcp-readonly): get_map_nodes/get_map_edges 工具，参数严格校验+limit clamp"
```

---

### Task 10: 工具 get_service_logs（白名单 + 脱敏）

**Files:**
- Create: `packages/mcp-readonly/src/tools/service-logs.js`
- Modify: `packages/mcp-readonly/__tests__/tools.test.js`（追加）

- [ ] **Step 1: 追加失败测试**

```javascript
// 追加到 packages/mcp-readonly/__tests__/tools.test.js
import { getServiceLogs, SERVICE_LOG_WHITELIST } from '../src/tools/service-logs.js';

describe('getServiceLogs', () => {
  it('service 不在白名单抛 ValidationError', async () => {
    const fakeReadLog = vi.fn();
    await expect(
      getServiceLogs(fakeReadLog, { service: 'random-service', lines: 50 })
    ).rejects.toThrow(ValidationError);
    expect(fakeReadLog).not.toHaveBeenCalled();
  });

  it('合法 service 返回脱敏后的日志行', async () => {
    const fakeReadLog = vi.fn().mockResolvedValue([
      'normal log line',
      'token=ghp_1234567890abcdefghijklmnopqrstuv leaked here',
    ]);
    const result = await getServiceLogs(fakeReadLog, { service: 'cecelia-brain', lines: 50 });
    expect(result.lines[0]).toBe('normal log line');
    expect(result.lines[1]).toContain('ghp_****');
    expect(result.lines[1]).not.toContain('1234567890abcdefghijklmnopqrstuv');
  });

  it('lines 超过 200 会被 clamp', async () => {
    const fakeReadLog = vi.fn().mockResolvedValue([]);
    await getServiceLogs(fakeReadLog, { service: 'cecelia-brain', lines: 9999 });
    expect(fakeReadLog.mock.calls[0][1]).toBe(200);
  });

  it('SERVICE_LOG_WHITELIST 本次只含 cecelia-brain', () => {
    expect(Object.keys(SERVICE_LOG_WHITELIST)).toEqual(['cecelia-brain']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/tools.test.js -t getServiceLogs`
Expected: FAIL

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/tools/service-logs.js
import { ValidationError } from './map-nodes-edges.js';
import { redact } from '../redact.js';

export { ValidationError };

// 白名单：服务名 → 日志文件路径。硬编码，不接受任意路径参数。
export const SERVICE_LOG_WHITELIST = {
  'cecelia-brain': '/var/log/cecelia/brain.log',
};

export async function getServiceLogs(readLogFn, { service, lines } = {}) {
  if (!Object.prototype.hasOwnProperty.call(SERVICE_LOG_WHITELIST, service)) {
    throw new ValidationError(`service 必须是白名单内的值：${Object.keys(SERVICE_LOG_WHITELIST).join(', ')}`);
  }
  const safeLines = Math.min(typeof lines === 'number' && lines > 0 ? lines : 50, 200);
  const rawLines = await readLogFn(SERVICE_LOG_WHITELIST[service], safeLines);
  return { lines: rawLines.map(redact) };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/tools.test.js -t getServiceLogs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/mcp-readonly/src/tools/service-logs.js packages/mcp-readonly/__tests__/tools.test.js
git commit -m "feat(mcp-readonly): get_service_logs 工具，硬编码白名单+脱敏"
```

---

### Task 11: MCP Server 组装（工具注册 + 鉴权 + 限流）

**Files:**
- Modify: `packages/mcp-readonly/server.js`
- Test: `packages/mcp-readonly/__tests__/server.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// packages/mcp-readonly/__tests__/server.test.js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server.js';

describe('POST /mcp 鉴权', () => {
  it('无 token 调用 /mcp 返回 401', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app).post('/mcp').send({});
    expect(res.status).toBe(401);
  });

  it('错误 token 返回 401', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer wrong')
      .send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/server.test.js`
Expected: FAIL（`/mcp` 路由不存在，返回 404 而非 401）

- [ ] **Step 3: 写实现（组装所有中间件 + 挂载 MCP 端点）**

```javascript
// packages/mcp-readonly/server.js
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { bearerAuth } from './src/auth.js';
import { createRateLimiter } from './src/rate-limit.js';
import { createReadonlyPool, query } from './src/db.js';
import { getSchemaVersion, getDeploymentStatus } from './src/tools/schema-and-deployment.js';
import { getMapSummary } from './src/tools/map-summary.js';
import { getMapNodes, getMapEdges } from './src/tools/map-nodes-edges.js';
import { getServiceLogs } from './src/tools/service-logs.js';

const VALID_NODE_TYPES = ['value_stream', 'capability', 'cross_cut', 'boundary'];
const VALID_EDGE_TYPES = ['contains', 'depends_on', 'crosses'];

function buildMcpServer({ pool, startedAt, execFn, readLogFn }) {
  const server = new McpServer({ name: 'cecelia-readonly', version: '1.0.0' });

  server.registerTool('get_schema_version', {
    description: '返回当前最高 schema/migration 版本',
    inputSchema: {},
  }, async () => ({
    content: [{ type: 'text', text: JSON.stringify(await getSchemaVersion(pool, query)) }],
  }));

  server.registerTool('get_map_summary', {
    description: '返回 active manifest、projection 状态和四类对象数量',
    inputSchema: {},
  }, async () => ({
    content: [{ type: 'text', text: JSON.stringify(await getMapSummary(pool, query)) }],
  }));

  server.registerTool('get_map_nodes', {
    description: '按 node_type 查询 map_projection_nodes',
    inputSchema: { node_type: z.string(), limit: z.number().optional() },
  }, async ({ node_type, limit }) => ({
    content: [{ type: 'text', text: JSON.stringify(await getMapNodes(pool, query, { node_type, limit }, VALID_NODE_TYPES)) }],
  }));

  server.registerTool('get_map_edges', {
    description: '按 edge_type 查询 map_projection_edges',
    inputSchema: { edge_type: z.string(), limit: z.number().optional() },
  }, async ({ edge_type, limit }) => ({
    content: [{ type: 'text', text: JSON.stringify(await getMapEdges(pool, query, { edge_type, limit }, VALID_EDGE_TYPES)) }],
  }));

  server.registerTool('get_deployment_status', {
    description: '返回当前 commit SHA/branch/服务状态/启动时间',
    inputSchema: {},
  }, async () => ({
    content: [{ type: 'text', text: JSON.stringify(await getDeploymentStatus(execFn, { startedAt })) }],
  }));

  server.registerTool('get_service_logs', {
    description: '读取白名单服务日志（已脱敏），最多200行',
    inputSchema: { service: z.string(), lines: z.number().optional() },
  }, async ({ service, lines }) => ({
    content: [{ type: 'text', text: JSON.stringify(await getServiceLogs(readLogFn, { service, lines })) }],
  }));

  return server;
}

export function createApp({ skipDbInit = false, bearerToken = process.env.MCP_BEARER_TOKEN } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ uptime: process.uptime() });
  });

  const pool = skipDbInit ? null : createReadonlyPool(process.env.MCP_READONLY_DATABASE_URL, { max: 5 });
  const startedAt = Date.now();

  const mcpServer = buildMcpServer({
    pool,
    startedAt,
    execFn: async (cmd) => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      return promisify(execFile)('sh', ['-c', cmd]);
    },
    readLogFn: async (path, n) => {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(path, 'utf-8');
      return content.trim().split('\n').slice(-n);
    },
  });

  app.use(
    '/mcp',
    bearerAuth(bearerToken),
    createRateLimiter({ windowMs: 60_000, max: 20 })
  );

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.MCP_PORT || 8787;
  app.listen(port, () => {
    console.log(`mcp-readonly listening on :${port}`);
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/server.test.js`
Expected: PASS

- [ ] **Step 5: 跑全量测试确认没有破坏之前的 Task**

Run: `cd packages/mcp-readonly && npx vitest run`
Expected: 全部 PASS（有 TEST_DATABASE_URL 的用例正常跑，没有的自动 skip）

- [ ] **Step 6: 提交**

```bash
git add packages/mcp-readonly/server.js packages/mcp-readonly/__tests__/server.test.js
git commit -m "feat(mcp-readonly): 组装MCP Streamable HTTP端点，6工具注册+鉴权+限流"
```

---

### Task 12: 启动自检（拒绝可写账号启动）

**Files:**
- Create: `packages/mcp-readonly/src/self-check.js`
- Test: `packages/mcp-readonly/__tests__/self-check.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// packages/mcp-readonly/__tests__/self-check.test.js
import { describe, it, expect, vi } from 'vitest';
import { assertReadonly } from '../src/self-check.js';

describe('assertReadonly', () => {
  it('账号确实只读（INSERT 报错）时通过自检', async () => {
    const fakeQuery = vi.fn().mockRejectedValue(new Error('permission denied for table'));
    await expect(assertReadonly(fakeQuery)).resolves.toBeUndefined();
  });

  it('账号意外可写（INSERT 未报错）时抛错拒绝启动', async () => {
    const fakeQuery = vi.fn().mockResolvedValue({ rows: [] });
    await expect(assertReadonly(fakeQuery)).rejects.toThrow(/账号权限配置错误/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/self-check.test.js`
Expected: FAIL

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/self-check.js
export async function assertReadonly(queryFn) {
  try {
    await queryFn(
      `DO $$ BEGIN
         CREATE TEMP TABLE mcp_readonly_probe (id INT);
         INSERT INTO mcp_readonly_probe VALUES (1);
         ROLLBACK;
       EXCEPTION WHEN insufficient_privilege THEN
         RAISE;
       END $$;`
    );
    throw new Error('账号权限配置错误：mcp_readonly 角色意外拥有写权限，拒绝启动');
  } catch (err) {
    if (err.message.includes('账号权限配置错误')) throw err;
    // 预期路径：INSERT 权限不足报错，自检通过
    return;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/self-check.test.js`
Expected: PASS

- [ ] **Step 5: 接入 server.js 启动流程**

在 `packages/mcp-readonly/server.js` 的 `if (import.meta.url === ...)` 启动块里，`app.listen` 之前插入：

```javascript
import { assertReadonly } from './src/self-check.js';
// ...
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createReadonlyPool(process.env.MCP_READONLY_DATABASE_URL, { max: 5 });
  await assertReadonly((sql, params) => query(pool, sql, params));
  const app = createApp();
  const port = process.env.MCP_PORT || 8787;
  app.listen(port, () => {
    console.log(`mcp-readonly listening on :${port}`);
  });
}
```

- [ ] **Step 6: 提交**

```bash
git add packages/mcp-readonly/src/self-check.js packages/mcp-readonly/__tests__/self-check.test.js packages/mcp-readonly/server.js
git commit -m "feat(mcp-readonly): 启动自检，账号意外可写时拒绝启动"
```

---

### Task 13: LaunchDaemon 常驻 + 内存硬顶 + 部署脚本

**Files:**
- Create: `packages/mcp-readonly/deploy/com.cecelia.mcp-readonly.plist`
- Create: `packages/mcp-readonly/deploy/deploy.sh`

- [ ] **Step 1: 写 LaunchDaemon plist（内存硬顶替代 Linux 专属 oom_score_adj）**

```xml
<!-- packages/mcp-readonly/deploy/com.cecelia.mcp-readonly.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cecelia.mcp-readonly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/administrator/perfect21/cecelia/packages/mcp-readonly/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>12</integer>
  <key>SoftResourceLimits</key>
  <dict>
    <key>MemoryLimit</key>
    <integer>536870912</integer>
  </dict>
  <key>HardResourceLimits</key>
  <dict>
    <key>MemoryLimit</key>
    <integer>536870912</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/var/log/cecelia/mcp-readonly.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/cecelia/mcp-readonly.error.log</string>
</dict>
</plist>
```

> `ThrottleInterval: 12` = 崩溃后至少等 12 秒才重启，粗略实现"限速重启"（PrepPRD 要求"5次/分钟后退避"——launchd 原生不支持计数窗口，这个阈值是保守近似，真正的 5次/分钟计数在 Task 14 的 alerting.js 里做，检测到超频重启触发 Bark，而不是指望 launchd 自己限速）。

- [ ] **Step 2: 写部署脚本**

```bash
#!/bin/bash
# packages/mcp-readonly/deploy/deploy.sh
set -euo pipefail

REPO_ROOT="/Users/administrator/perfect21/cecelia"
PLIST_SRC="$REPO_ROOT/packages/mcp-readonly/deploy/com.cecelia.mcp-readonly.plist"
PLIST_DST="/Library/LaunchDaemons/com.cecelia.mcp-readonly.plist"

echo "1. 安装依赖"
cd "$REPO_ROOT/packages/mcp-readonly" && npm install --production

echo "2. 确保日志目录存在"
sudo mkdir -p /var/log/cecelia

echo "3. 部署前 smoke：现有 5211/5221 响应时间基线"
curl -s -o /dev/null -w "5211 baseline: %{time_total}s\n" http://localhost:5211/ || true
curl -s -o /dev/null -w "5221 baseline: %{time_total}s\n" http://localhost:5221/health || true

echo "4. 安装 LaunchDaemon"
sudo cp "$PLIST_SRC" "$PLIST_DST"
sudo launchctl bootstrap system "$PLIST_DST" || sudo launchctl bootout system "$PLIST_DST" && sudo launchctl bootstrap system "$PLIST_DST"

echo "5. 部署后 smoke：确认新服务健康 + 现有服务无劣化"
sleep 2
curl -sf http://localhost:8787/health
curl -s -o /dev/null -w "5211 after: %{time_total}s\n" http://localhost:5211/ || true
curl -s -o /dev/null -w "5221 after: %{time_total}s\n" http://localhost:5221/health || true

echo "部署完成。下一步：在 Cloudflare Zero Trust 后台给现有 Tunnel 加一条 public hostname ingress 规则，指向 localhost:8787"
```

- [ ] **Step 3: 手动验证（manual: 白名单命令，非 CI）**

Run: `chmod +x packages/mcp-readonly/deploy/deploy.sh && bash packages/mcp-readonly/deploy/deploy.sh`
Expected: 最后一行 `/health` curl 返回 200，5211/5221 前后响应时间无明显劣化

- [ ] **Step 4: 提交**

```bash
git add packages/mcp-readonly/deploy/
git commit -m "feat(mcp-readonly): LaunchDaemon常驻+内存硬顶(512MB)+部署脚本"
```

---

### Task 14: Bark 告警（鉴权失败/DB故障/重启风暴/限流触发）

**Files:**
- Create: `packages/mcp-readonly/src/alerting.js`
- Test: `packages/mcp-readonly/__tests__/alerting.test.js`

- [ ] **Step 1: 写失败测试**

```javascript
// packages/mcp-readonly/__tests__/alerting.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertTracker } from '../src/alerting.js';

describe('AlertTracker', () => {
  let sendBark;
  let tracker;
  const nowRef = { value: 1_000_000 };

  beforeEach(() => {
    sendBark = vi.fn().mockResolvedValue(undefined);
    tracker = new AlertTracker({ sendBark, now: () => nowRef.value });
  });

  it('5分钟内同token鉴权失败达到10次触发Bark', async () => {
    for (let i = 0; i < 9; i++) await tracker.recordAuthFailure('token-a');
    expect(sendBark).not.toHaveBeenCalled();
    await tracker.recordAuthFailure('token-a');
    expect(sendBark).toHaveBeenCalledOnce();
    expect(sendBark.mock.calls[0][0]).toContain('鉴权失败');
  });

  it('连续3次DB连接失败触发Bark', async () => {
    await tracker.recordDbFailure();
    await tracker.recordDbFailure();
    expect(sendBark).not.toHaveBeenCalled();
    await tracker.recordDbFailure();
    expect(sendBark).toHaveBeenCalledOnce();
  });

  it('DB失败中间穿插一次成功会重置计数', async () => {
    await tracker.recordDbFailure();
    await tracker.recordDbFailure();
    tracker.recordDbSuccess();
    await tracker.recordDbFailure();
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('1小时内重启超过3次触发Bark', async () => {
    await tracker.recordRestart();
    await tracker.recordRestart();
    await tracker.recordRestart();
    expect(sendBark).not.toHaveBeenCalled();
    await tracker.recordRestart();
    expect(sendBark).toHaveBeenCalledOnce();
  });

  it('10分钟内同token触发限流超过5次触发Bark', async () => {
    for (let i = 0; i < 5; i++) await tracker.recordRateLimited('token-b');
    expect(sendBark).not.toHaveBeenCalled();
    await tracker.recordRateLimited('token-b');
    expect(sendBark).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/alerting.test.js`
Expected: FAIL

- [ ] **Step 3: 写实现**

```javascript
// packages/mcp-readonly/src/alerting.js
const FIVE_MIN = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;

export class AlertTracker {
  constructor({ sendBark, now = () => Date.now() }) {
    this.sendBark = sendBark;
    this.now = now;
    this.authFailures = new Map(); // token -> timestamps[]
    this.dbFailureCount = 0;
    this.restarts = [];
    this.rateLimited = new Map(); // token -> timestamps[]
  }

  _prune(arr, windowMs) {
    const cutoff = this.now() - windowMs;
    return arr.filter((t) => t > cutoff);
  }

  async recordAuthFailure(token) {
    const list = this._prune(this.authFailures.get(token) || [], FIVE_MIN);
    list.push(this.now());
    this.authFailures.set(token, list);
    if (list.length >= 10) {
      await this.sendBark(`鉴权失败：5分钟内 token ${token.slice(-4)} 失败 ${list.length} 次，疑似暴力破解`);
      this.authFailures.set(token, []);
    }
  }

  async recordDbFailure() {
    this.dbFailureCount += 1;
    if (this.dbFailureCount >= 3) {
      await this.sendBark(`DB连接失败：连续 ${this.dbFailureCount} 次，疑似下线`);
      this.dbFailureCount = 0;
    }
  }

  recordDbSuccess() {
    this.dbFailureCount = 0;
  }

  async recordRestart() {
    this.restarts = this._prune(this.restarts, ONE_HOUR);
    this.restarts.push(this.now());
    if (this.restarts.length > 3) {
      await this.sendBark(`重启风暴：1小时内重启 ${this.restarts.length} 次，疑似 crash loop`);
      this.restarts = [];
    }
  }

  async recordRateLimited(token) {
    const list = this._prune(this.rateLimited.get(token) || [], TEN_MIN);
    list.push(this.now());
    this.rateLimited.set(token, list);
    if (list.length > 5) {
      await this.sendBark(`限流触发：10分钟内 token ${token.slice(-4)} 触发限流 ${list.length} 次，疑似token泄露`);
      this.rateLimited.set(token, []);
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/mcp-readonly && npx vitest run __tests__/alerting.test.js`
Expected: PASS

- [ ] **Step 5: 跑全量测试**

Run: `cd packages/mcp-readonly && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add packages/mcp-readonly/src/alerting.js packages/mcp-readonly/__tests__/alerting.test.js
git commit -m "feat(mcp-readonly): Bark告警阈值(鉴权失败/DB故障/重启风暴/限流触发)"
```

---

## Self-Review 记录（写计划人自查，已修正）

1. **Spec coverage**：PrepPRD 6 个工具、鉴权、DB只读、限流、脱敏、告警四阈值、启动自检、LaunchDaemon、内存硬顶（macOS修正版）、部署前后 smoke，均有对应 Task。Cloudflare Tunnel ingress 规则本身是 Cloudflare 后台手动操作，非本仓库代码，已在 Task 13 部署脚本最后一行提示，不单独立 Task。
2. **Placeholder scan**：全文无 TBD/TODO；`<N>` 迁移编号已在 Task 2 Step 1 明确"实现时查当前最大值+1"，不是模糊占位而是必须现查的真实值（因多任务并发改 migrations 目录）。
3. **Type/signature consistency**：`query(pool, sql, params, opts)` 签名在 Task 5 定义后，Task 7-10 全部工具函数统一接收 `(pool, queryFn, params, ...)` 形式一致；`ValidationError` 在 Task 9 定义，Task 10 从同一文件 import 复用，未重复定义。
