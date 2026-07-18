# 刀A1 总关系图进照相层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** graph_edges 表 + scan-graph 扫描器(import/spawn/http 三类边,全量替换语义)接入 run-all-scans 照相层基建。

**Architecture:** 纯抽取逻辑放 packages/brain/src/lib/graph-extract.js(零 IO 可单测),写库放 lib/graph-store.js(DI pool 可单测),IO 编排放 scripts/scan/scan-graph.mjs(depcruise 程序化 API + walk 文件调抽取器)。表结构进 migration 351。

**Tech Stack:** Node ESM、pg、dependency-cruiser ^17(root devDependency)、vitest。

## Global Constraints

- spec:`docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md`
- TDD:纯函数 task 必须 commit-1 Red / commit-2 Green;commit message 简体中文尾注 [1fdfd27d]
- schema 版本锚 **五处同 commit 全改 '351'**(selfcheck.js:28 / selfcheck.test.js:198 / learnings-vectorize.test.js:460 / DEFINITION.md:519 / DEFINITION.md:886);desire-system.test.js 已豁免**别改**
- 本地 migration 验证一律 `DB_NAME=cecelia_scratch`;integration 测试连接一律 `import { DB_DEFAULTS } from '../../db-config.js'` + `new pg.Pool({ ...DB_DEFAULTS, max: 3 })`,禁自建裸连接
- lint-test-pairing:packages/brain/src 新 .js 必须配同目录 __tests__ 同名 .test.js 且 import 被测模块
- smoke 禁 jq(用 node -e / psql);测试命令 `cd packages/brain && npx vitest run <path>`
- 禁临时起 Brain 实例连生产库;所有 psql 破坏性操作只对 scratch/test 库

---

### Task 1: migration 351 + 五处版本锚

**Files:**
- Create: `packages/brain/migrations/351_graph_edges.sql`
- Modify: `packages/brain/src/selfcheck.js:28`('350'→'351')
- Modify: `packages/brain/src/__tests__/selfcheck.test.js:198`(toBe('350')→toBe('351'))
- Modify: `packages/brain/src/__tests__/learnings-vectorize.test.js:460`(同上)
- Modify: `DEFINITION.md:519` 与 `DEFINITION.md:886`(350→351)
- Test: `packages/brain/src/__tests__/integration/graph-edges-schema.integration.test.js`

**Interfaces:**
- Produces: graph_edges 表(repo/src_path/dst_path/edge_type/detail/scanned_at/created_at + 三索引),后续 task 直接写

- [ ] **Step 1: 写 migration**

```sql
-- packages/brain/migrations/351_graph_edges.sql
-- 刀A1:总关系图进照相层(import/spawn/http 三类边,scan-graph 每日全量重拍)
-- spec: docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md
CREATE TABLE IF NOT EXISTS graph_edges (
  id bigserial PRIMARY KEY,
  repo varchar(100) NOT NULL DEFAULT 'cecelia',
  src_path text NOT NULL,
  dst_path text NOT NULL,
  edge_type varchar(20) NOT NULL CHECK (edge_type IN ('import', 'spawn', 'http')),
  detail jsonb NOT NULL DEFAULT '{}',
  scanned_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_src ON graph_edges(repo, src_path);
CREATE INDEX IF NOT EXISTS idx_graph_edges_dst ON graph_edges(repo, dst_path);
CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type);
```

- [ ] **Step 2: 五处版本锚同步改 '351'**(逐处 Edit,值从 '350'/350 改 '351'/351,其他一字不动)

- [ ] **Step 3: scratch 库验 migration(死规矩)**

Run: `cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js 2>&1 | tail -3 && psql -h localhost -U postgres -d cecelia_scratch -c "\d graph_edges" | head -12`
Expected: migration 应用成功,表结构与 Step 1 一致

- [ ] **Step 4: 写 integration 测试**

```js
// packages/brain/src/__tests__/integration/graph-edges-schema.integration.test.js
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
afterAll(() => pool.end());

describe('graph_edges 表结构(migration 351)', () => {
  it('表存在且列齐全', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='graph_edges' ORDER BY ordinal_position`
    );
    const cols = rows.map((r) => r.column_name);
    for (const c of ['repo', 'src_path', 'dst_path', 'edge_type', 'detail', 'scanned_at']) {
      expect(cols).toContain(c);
    }
  });

  it('edge_type CHECK 拒绝非法值', async () => {
    await expect(
      pool.query(`INSERT INTO graph_edges (repo, src_path, dst_path, edge_type) VALUES ('itest', 'a', 'b', 'bogus')`)
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: 本地跑 integration(连 cecelia_test,已有表则过;若本地 cecelia_test 未迁移则先 `DB_NAME=cecelia_test node src/migrate.js`)**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/graph-edges-schema.integration.test.js`
Expected: 2 passed

- [ ] **Step 6: 跑受影响单测确认锚同步无红**

Run: `cd packages/brain && npx vitest run src/__tests__/selfcheck.test.js src/__tests__/learnings-vectorize.test.js 2>&1 | tail -3`
Expected: 全 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/brain/migrations/351_graph_edges.sql packages/brain/src/selfcheck.js packages/brain/src/__tests__/selfcheck.test.js packages/brain/src/__tests__/learnings-vectorize.test.js DEFINITION.md packages/brain/src/__tests__/integration/graph-edges-schema.integration.test.js
git commit -m "feat(brain): migration 351 graph_edges 表——总关系图进照相层,五处 schema 锚同步 [1fdfd27d]"
```

---

### Task 2: 纯抽取器 graph-extract.js

**Files:**
- Create: `packages/brain/src/lib/graph-extract.js`
- Test: `packages/brain/src/lib/__tests__/graph-extract.test.js`

**Interfaces:**
- Produces: `extractSpawnEdges(content, srcPath) → [{src_path, dst_path, edge_type:'spawn', detail:{line, via}}]`;`extractHttpEdges(content, srcPath) → [{src_path, dst_path, edge_type:'http', detail:{line}}]`。无匹配返回 [],不抛异常。

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/lib/__tests__/graph-extract.test.js
import { describe, it, expect } from 'vitest';
import { extractSpawnEdges, extractHttpEdges } from '../graph-extract.js';

describe('extractSpawnEdges', () => {
  it('外部命令 → cmd: 前缀', () => {
    const edges = extractSpawnEdges(`const p = spawn('docker', ['ps']);`, 'src/a.js');
    expect(edges).toEqual([
      { src_path: 'src/a.js', dst_path: 'cmd:docker', edge_type: 'spawn', detail: { line: 1, via: 'spawn' } },
    ]);
  });

  it('首参是脚本路径 → repo 路径(去 ./)', () => {
    const edges = extractSpawnEdges(`execFile('./scripts/deploy.sh', [], cb)`, 'src/b.js');
    expect(edges[0].dst_path).toBe('scripts/deploy.sh');
    expect(edges[0].detail.via).toBe('execFile');
  });

  it('bash + 同字面量内脚本参数 → 两条边(cmd:bash + 脚本)', () => {
    const edges = extractSpawnEdges('execSync(`bash scripts/scan/run-all-scans.sh`)', 'src/c.js');
    const dsts = edges.map((e) => e.dst_path).sort();
    expect(dsts).toEqual(['cmd:bash', 'scripts/scan/run-all-scans.sh']);
  });

  it('bash + 独立字面量脚本参数(spawn 数组形态)→ 两条边', () => {
    const edges = extractSpawnEdges(`spawn('bash', ['scripts/x.sh', '--flag'])`, 'src/d.js');
    const dsts = edges.map((e) => e.dst_path).sort();
    expect(dsts).toEqual(['cmd:bash', 'scripts/x.sh']);
  });

  it('多行内容行号正确', () => {
    const edges = extractSpawnEdges(`// x\n// y\nexecSync('git status')`, 'src/e.js');
    expect(edges[0].detail.line).toBe(3);
    expect(edges[0].dst_path).toBe('cmd:git');
  });

  it('无匹配 → []', () => {
    expect(extractSpawnEdges('const a = 1;', 'src/f.js')).toEqual([]);
  });
});

describe('extractHttpEdges', () => {
  it('localhost:5221 完整 URL → 路径名', () => {
    const edges = extractHttpEdges(`fetch('http://localhost:5221/api/brain/tasks?limit=5')`, 'src/g.js');
    expect(edges).toEqual([
      { src_path: 'src/g.js', dst_path: '/api/brain/tasks', edge_type: 'http', detail: { line: 1 } },
    ]);
  });

  it('模板变量前缀 \`${BRAIN}/api/brain/...\` → 命中', () => {
    const edges = extractHttpEdges('curl(`${BRAIN}/api/brain/harness/judge`)', 'src/h.js');
    expect(edges[0].dst_path).toBe('/api/brain/harness/judge');
  });

  it('引号直接开头的 /api/brain 路径 → 命中;路径中段模板变量截断后仍收', () => {
    const edges = extractHttpEdges('await get(`/api/brain/tasks/${id}/claim`)', 'src/i.js');
    expect(edges[0].dst_path).toBe('/api/brain/tasks/');
  });

  it('非 /api 路径与普通字符串 → []', () => {
    expect(extractHttpEdges(`fetch('/health'); const s='api/brain';`, 'src/j.js')).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/graph-extract.test.js`
Expected: FAIL(模块不存在)

- [ ] **Step 3: commit-1(Red)**

```bash
git add packages/brain/src/lib/__tests__/graph-extract.test.js
git commit -m "test(brain): graph-extract 抽取器失败测试(Red) [1fdfd27d]"
```

- [ ] **Step 4: 实现**

```js
// packages/brain/src/lib/graph-extract.js
/**
 * 总关系图纯抽取器(刀A1):从源码文本抽 spawn/http 边,零 IO。
 * import 边由 scan-graph.mjs 走 dependency-cruiser,不在本文件。
 * spec: docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md
 */
const SCRIPT_EXT_RE = /\.(sh|mjs|cjs|py|js)$/;

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

export function extractSpawnEdges(content, srcPath) {
  const edges = [];
  const re = /\b(spawn|execFile|execSync|exec)\(\s*(['"`])([^'"`\n]+)\2/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const via = m[1];
    const line = lineOf(content, m.index);
    const words = m[3].trim().split(/\s+/);
    const cmd = words[0];
    const isScript = SCRIPT_EXT_RE.test(cmd);
    const primary = isScript ? cmd.replace(/^\.\//, '') : `cmd:${cmd}`;
    edges.push({ src_path: srcPath, dst_path: primary, edge_type: 'spawn', detail: { line, via } });
    const seen = new Set([primary]);
    // 首字面量内的后续词(execSync(`bash x.sh`) 场景)
    for (const w of words.slice(1)) {
      if (SCRIPT_EXT_RE.test(w)) {
        const p = w.replace(/^\.\//, '');
        if (!seen.has(p)) {
          seen.add(p);
          edges.push({ src_path: srcPath, dst_path: p, edge_type: 'spawn', detail: { line, via } });
        }
      }
    }
    // 同一行其余独立字面量脚本参数(spawn('bash', ['x.sh']) 场景)
    const lineEnd = content.indexOf('\n', m.index);
    const callLine = content.slice(m.index + m[0].length, lineEnd === -1 ? undefined : lineEnd);
    const argRe = /['"`]([^'"`\s]+\.(?:sh|mjs|cjs|py|js))['"`]/g;
    let a;
    while ((a = argRe.exec(callLine)) !== null) {
      const p = a[1].replace(/^\.\//, '');
      if (!seen.has(p)) {
        seen.add(p);
        edges.push({ src_path: srcPath, dst_path: p, edge_type: 'spawn', detail: { line, via } });
      }
    }
  }
  return edges;
}

export function extractHttpEdges(content, srcPath) {
  const edges = [];
  // 三种前导形态:完整 host、模板变量闭括号、引号直接开头
  const re = /(?:(?:localhost|127\.0\.0\.1):5221|\}|['"`])(\/api\/[^'"`\s]*)/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    let p = m[1].split('?')[0].split('${')[0];
    if (!p.startsWith('/api/')) continue;
    const line = lineOf(content, m.index);
    const key = `${p}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ src_path: srcPath, dst_path: p, edge_type: 'http', detail: { line } });
  }
  return edges;
}
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/graph-extract.test.js`
Expected: 10 passed

- [ ] **Step 6: commit-2(Green)**

```bash
git add packages/brain/src/lib/graph-extract.js
git commit -m "feat(brain): graph-extract 纯抽取器——spawn/http 边零 IO 抽取(Green) [1fdfd27d]"
```

---

### Task 3: 写库层 graph-store.js(全量替换语义)

**Files:**
- Create: `packages/brain/src/lib/graph-store.js`
- Test: `packages/brain/src/lib/__tests__/graph-store.test.js`
- Test: `packages/brain/src/__tests__/integration/graph-store.integration.test.js`

**Interfaces:**
- Consumes: 边对象 `{src_path, dst_path, edge_type, detail}`
- Produces: `replaceRepoEdges(pool, repo, edges) → Promise<{inserted}>`——事务内 DELETE WHERE repo → 分批 INSERT → COMMIT;出错 ROLLBACK 后 rethrow

- [ ] **Step 1: 写失败单测(mock client 验事务次序)**

```js
// packages/brain/src/lib/__tests__/graph-store.test.js
import { describe, it, expect, vi } from 'vitest';
import { replaceRepoEdges } from '../graph-store.js';

function mockPool() {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => { calls.push({ sql: String(sql), params }); return { rows: [] }; }),
    release: vi.fn(),
  };
  return { pool: { connect: async () => client }, client, calls };
}

describe('replaceRepoEdges', () => {
  it('事务次序:BEGIN → DELETE(带 repo 参数) → INSERT → COMMIT,返回 inserted 数', async () => {
    const { pool, calls, client } = mockPool();
    const edges = [
      { src_path: 'a.js', dst_path: 'b.js', edge_type: 'import', detail: { via: 'import' } },
      { src_path: 'a.js', dst_path: 'cmd:git', edge_type: 'spawn', detail: { line: 3, via: 'execSync' } },
    ];
    const r = await replaceRepoEdges(pool, 'cecelia', edges);
    expect(r.inserted).toBe(2);
    expect(calls[0].sql).toContain('BEGIN');
    expect(calls[1].sql).toContain('DELETE FROM graph_edges');
    expect(calls[1].params).toEqual(['cecelia']);
    expect(calls[2].sql).toContain('INSERT INTO graph_edges');
    expect(calls[calls.length - 1].sql).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('INSERT 抛错 → ROLLBACK 且 rethrow,client 释放', async () => {
    const { pool, calls, client } = mockPool();
    client.query.mockImplementation(async (sql) => {
      calls.push({ sql: String(sql) });
      if (String(sql).includes('INSERT')) throw new Error('boom');
      return { rows: [] };
    });
    await expect(replaceRepoEdges(pool, 'cecelia', [{ src_path: 'a', dst_path: 'b', edge_type: 'import', detail: {} }])).rejects.toThrow('boom');
    expect(calls[calls.length - 1].sql).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('空边数组:仍清空该 repo 并提交(全量替换语义,扫描出零边=真相就是零边)', async () => {
    const { pool, calls } = mockPool();
    const r = await replaceRepoEdges(pool, 'cecelia', []);
    expect(r.inserted).toBe(0);
    expect(calls.some((c) => c.sql.includes('DELETE'))).toBe(true);
    expect(calls[calls.length - 1].sql).toContain('COMMIT');
  });
});
```

- [ ] **Step 2: 跑测试确认失败 → commit-1(Red)**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/graph-store.test.js`(FAIL)

```bash
git add packages/brain/src/lib/__tests__/graph-store.test.js
git commit -m "test(brain): graph-store 全量替换写库失败测试(Red) [1fdfd27d]"
```

- [ ] **Step 3: 实现**

```js
// packages/brain/src/lib/graph-store.js
/**
 * graph_edges 写库层(刀A1):按 repo 全量替换。
 * 边无自然键,upsert 会积死边(scan-api-registry 的已知缺陷,此处不复制)。
 */
const BATCH = 500;

export async function replaceRepoEdges(pool, repo, edges) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM graph_edges WHERE repo = $1', [repo]);
    let inserted = 0;
    for (let i = 0; i < edges.length; i += BATCH) {
      const chunk = edges.slice(i, i + BATCH);
      const values = [];
      const params = [];
      chunk.forEach((e, j) => {
        const base = j * 5;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        params.push(repo, e.src_path, e.dst_path, e.edge_type, JSON.stringify(e.detail || {}));
      });
      await client.query(
        `INSERT INTO graph_edges (repo, src_path, dst_path, edge_type, detail) VALUES ${values.join(', ')}`,
        params
      );
      inserted += chunk.length;
    }
    await client.query('COMMIT');
    return { inserted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: 跑单测全绿 → 写 integration 替换语义测试**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/graph-store.test.js`(3 passed)

```js
// packages/brain/src/__tests__/integration/graph-store.integration.test.js
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { replaceRepoEdges } from '../../lib/graph-store.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const REPO = 'itest-graph-repo';

afterAll(async () => {
  await pool.query('DELETE FROM graph_edges WHERE repo = $1', [REPO]);
  await pool.end();
});

describe('replaceRepoEdges 真库全量替换', () => {
  it('第二批写入后第一批消失,只剩第二批', async () => {
    await replaceRepoEdges(pool, REPO, [
      { src_path: 'old/a.js', dst_path: 'old/b.js', edge_type: 'import', detail: {} },
    ]);
    await replaceRepoEdges(pool, REPO, [
      { src_path: 'new/x.js', dst_path: 'cmd:git', edge_type: 'spawn', detail: { line: 1, via: 'spawn' } },
      { src_path: 'new/x.js', dst_path: '/api/brain/tasks', edge_type: 'http', detail: { line: 2 } },
    ]);
    const { rows } = await pool.query('SELECT src_path, edge_type FROM graph_edges WHERE repo = $1 ORDER BY src_path', [REPO]);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.src_path.startsWith('new/'))).toBe(true);
  });
});
```

- [ ] **Step 5: 跑 integration → commit-2(Green)**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/graph-store.integration.test.js`(1 passed;本地 cecelia_test 需已含 351,若缺先 `DB_NAME=cecelia_test node src/migrate.js`)

```bash
git add packages/brain/src/lib/graph-store.js packages/brain/src/__tests__/integration/graph-store.integration.test.js
git commit -m "feat(brain): graph-store 按 repo 全量替换写库+真库替换语义验证(Green) [1fdfd27d]"
```

---

### Task 4: scan-graph.mjs + devDep + run-all-scans 接线 + scratch 真跑

**Files:**
- Create: `scripts/scan/scan-graph.mjs`
- Modify: root `package.json`(devDependencies 加 `"dependency-cruiser": "^17.0.0"`)+ root `package-lock.json`(npm install 重生成)
- Modify: `scripts/scan/run-all-scans.sh`(循环加 scan-graph.mjs)

**Interfaces:**
- Consumes: Task 2 抽取器 + Task 3 replaceRepoEdges
- Produces: `node scripts/scan/scan-graph.mjs` 全量重拍 graph_edges(repo='cecelia'),stdout 打三类边计数

- [ ] **Step 1: 装 devDep 并验 audit**

Run: `npm install --save-dev dependency-cruiser@^17 && npm audit 2>&1 | tail -3`
Expected: 安装成功;audit 无 critical(有 critical 立即报告,不硬继续)

- [ ] **Step 2: 写 scan-graph.mjs**

```js
#!/usr/bin/env node
// 总关系图扫描器(刀A1):import(dependency-cruiser)+ spawn/http(graph-extract)三类边,
// 按 repo 全量替换写入 graph_edges。由 run-all-scans.sh 每日调用,继承照相层账龄哨兵。
// spec: docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { cruise } from 'dependency-cruiser';
import { extractSpawnEdges, extractHttpEdges } from '../../packages/brain/src/lib/graph-extract.js';
import { replaceRepoEdges } from '../../packages/brain/src/lib/graph-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = 'cecelia';
const SCAN_DIRS = [
  'packages/brain/src', 'packages/brain/server.js',
  'packages/engine', 'packages/quality', 'packages/workflows',
  'apps/api/src', 'apps/dashboard/src', 'scripts',
].filter((d) => fs.existsSync(path.join(ROOT, d)));
const FILE_RE = /\.(js|mjs|cjs|ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (FILE_RE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

async function main() {
  process.chdir(ROOT);
  const edges = [];

  // 1) import 边:dependency-cruiser 程序化 API
  const cruiseResult = await cruise(SCAN_DIRS, {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: 'node_modules' },
  });
  // 兼容:程序化 API 的 output 依版本可能是对象或 JSON 字符串
  const out = typeof cruiseResult.output === 'string' ? JSON.parse(cruiseResult.output) : cruiseResult.output;
  const modules = out.modules;
  let importCount = 0;
  for (const m of modules) {
    if (m.source.includes('node_modules')) continue;
    for (const d of m.dependencies || []) {
      const dst = d.resolved || '';
      if (d.couldNotResolve || !dst || dst.includes('node_modules')) continue;
      if (d.dependencyTypes && d.dependencyTypes.includes('core')) continue;
      edges.push({
        src_path: m.source, dst_path: dst, edge_type: 'import',
        detail: { via: 'import', dynamic: d.dynamic === true },
      });
      importCount++;
    }
  }

  // 2) spawn/http 边:walk + 纯抽取器
  let spawnCount = 0, httpCount = 0;
  const files = [];
  for (const d of SCAN_DIRS) {
    const full = path.join(ROOT, d);
    if (fs.statSync(full).isDirectory()) walk(full, files);
    else if (FILE_RE.test(full)) files.push(full);
  }
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const content = fs.readFileSync(f, 'utf8');
    const se = extractSpawnEdges(content, rel);
    const he = extractHttpEdges(content, rel);
    spawnCount += se.length;
    httpCount += he.length;
    edges.push(...se, ...he);
  }

  // 3) 去重 + 全量替换写库
  const seen = new Set();
  const deduped = edges.filter((e) => {
    const k = `${e.src_path}|${e.dst_path}|${e.edge_type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
  try {
    const { inserted } = await replaceRepoEdges(pool, REPO, deduped);
    console.log(`graph_edges 全量重拍完成: import=${importCount} spawn=${spawnCount} http=${httpCount} 去重后入库=${inserted}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: run-all-scans.sh 接线**

把循环行改为(注意带扩展名区分 .js/.mjs):

```bash
for s in scan-api-registry.js scan-db-schema.js scan-test-registry.js scan-graph.mjs; do
  if node "scripts/scan/${s}"; then
    echo "OK: ${s}"
  else
    echo "FAIL: ${s}"
    FAIL=1
  fi
done
```

(同步把原循环里 `${s}.js` 拼接去掉——现在循环变量自带扩展名)

- [ ] **Step 4: scratch 库真跑验收(生产库还没有 351 表,禁直跑生产)**

Run:
```bash
cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js >/dev/null 2>&1; cd ../..
DATABASE_URL=postgresql://localhost/cecelia_scratch node scripts/scan/scan-graph.mjs
psql -h localhost -U postgres -d cecelia_scratch -t -c "SELECT edge_type, count(*) FROM graph_edges GROUP BY edge_type"
psql -h localhost -U postgres -d cecelia_scratch -t -c "SELECT count(*) FROM graph_edges WHERE src_path='packages/brain/src/dispatcher.js' AND dst_path='packages/brain/src/executor.js' AND edge_type='import'"
psql -h localhost -U postgres -d cecelia_scratch -t -c "SELECT count(*) FROM graph_edges WHERE edge_type='http' AND dst_path LIKE '/api/brain/tasks%'"
```
Expected: 三类边都 >0(import 约数千,spawn 数百,http 数百);两条抽查各 ≥1

- [ ] **Step 5: bash -n 验 run-all-scans + Commit**

Run: `bash -n scripts/scan/run-all-scans.sh`

```bash
git add scripts/scan/scan-graph.mjs scripts/scan/run-all-scans.sh package.json package-lock.json
git commit -m "feat(scan): scan-graph 总关系图扫描器——三类边全量重拍接入 run-all-scans [1fdfd27d]"
```

---

### Task 5: smoke + allowlist

**Files:**
- Create: `packages/brain/scripts/smoke/graph-photo-layer-smoke.sh`(框架照同目录 registry-photo-layer-smoke.sh)
- Modify: `packages/quality/smoke-allowlist.txt`(追加一行)

**Interfaces:**
- Consumes: CI smoke 环境(postgres service 已 migrate,PG* env 已设;graph_edges 表存在但空——扫描器不在 CI 跑)

- [ ] **Step 1: 写 smoke(CI 安全:验表结构 + 抽取器离线出边,不依赖数据)**

核心断言(嵌进 registry-photo-layer-smoke.sh 同款框架:set -uo pipefail、PASS/FAIL 计数、末尾汇总):

```bash
# [1] graph_edges 表存在(migration 351 生效)
COLS=$(psql -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='graph_edges'" | tr -d ' ')
if [ "${COLS:-0}" -ge 7 ]; then pass "graph_edges 表存在(${COLS} 列)"; else fail "graph_edges 表缺失或列不全"; fi

# [2] 抽取器离线出边(纯逻辑,零依赖)
if node --input-type=module -e "
import { extractSpawnEdges, extractHttpEdges } from './packages/brain/src/lib/graph-extract.js';
const s = extractSpawnEdges(\"spawn('bash', ['scripts/x.sh'])\", 'f.js');
const h = extractHttpEdges(\"fetch('http://localhost:5221/api/brain/tasks')\", 'f.js');
if (s.length !== 2 || h.length !== 1) { console.error('抽取器输出异常', s, h); process.exit(1); }
console.log('抽取器 OK');
"; then pass "抽取器离线出边正确"; else fail "抽取器输出异常"; fi
```

(smoke 从 repo root 执行时上面相对路径成立;若框架 cd 到别处,用脚本自身定位 ROOT 的同款写法)

- [ ] **Step 2: 登记 allowlist + 本地验证**

Run: `bash -n packages/brain/scripts/smoke/graph-photo-layer-smoke.sh && bash packages/brain/scripts/smoke/graph-photo-layer-smoke.sh`
Expected: 本地全 PASS(本地 cecelia 库已有 351?没有——本地生产库此时还没 351!smoke [1] 对本地生产库会 FAIL。**本地验证改连 scratch**:`PGDATABASE=cecelia_scratch bash ...` 全 PASS 即可,CI 环境 migrate 全量自然有表)

- [ ] **Step 3: Commit**

```bash
git add packages/brain/scripts/smoke/graph-photo-layer-smoke.sh packages/quality/smoke-allowlist.txt
git commit -m "feat(smoke): graph-photo-layer smoke——表结构+抽取器离线断言进 allowlist [1fdfd27d]"
```

---

### Task 6: 版本 bump + learning + DevGate

**Files:**
- Modify: `packages/brain/package.json`(1.267.4 → 1.267.5)+ check-version-sync.sh 指出的同步处
- Create: `docs/learnings/cp-07181503-graph-photo-layer.md`

- [ ] **Step 1: bump + 同步校验到 exit 0**

Run: 改 version 后 `bash scripts/check-version-sync.sh`,按输出补齐

- [ ] **Step 2: DevGate 三件全过**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`
Expected: 三条 exit 0(注意 dod-mapping 真实路径在 packages/quality,CLAUDE.md 旧文写 engine 是已知过时项)

- [ ] **Step 3: 写 learning**

```markdown
# Learning: 刀A1 总关系图进照相层

### 根本原因
索引服务(locate/related/radius/island-check/claim-status)缺数据层:"谁连谁"散在 import/spawn/http 三种载体里,没有任何一张机器可查的表。刀0 只复活了"存在什么"(api/db_schema/test 三照片),没有"谁连谁"。

### 下次预防
- [ ] 无自然键的 derived 数据(边、快照类)一律全量替换语义(事务内 DELETE+INSERT),禁 upsert 积死边——scan-api-registry 的 upsert 不删失效行是已知缺陷,新扫描器不复制
- [ ] schema 版本锚一共五处(selfcheck.js + 两个测试断言 + DEFINITION.md 两处),bump 必须同 commit 全改;desire-system.test.js 已豁免别多改
- [ ] 新增 migration 后生产库必须在部署前/后立即 migrate,否则 selfcheck 锚告警;本地一律先 scratch 验
```

- [ ] **Step 4: 全量回归**

Run: `cd packages/brain && npx vitest run --exclude='src/__tests__/integration/**' 2>&1 | tail -4`
Expected: 与 main 基线一致,无新红

- [ ] **Step 5: Commit**

```bash
git add packages/brain/package.json docs/learnings/cp-07181503-graph-photo-layer.md
# 加 check-version-sync 要求的其他文件
git commit -m "chore(brain): bump 1.267.5 + 刀A1 learning——总关系图进照相层 [1fdfd27d]"
```

---

## 合并后手动步骤(本 session 收尾执行)

1. 生产 cecelia 库 migrate 351(Gate3 部署 brain 后 selfcheck 需要):`cd ~/perfect21/cecelia/packages/brain && node src/migrate.js`(默认连生产 cecelia,仅此场景合法)
2. 真跑灌图:`bash scripts/scan/run-all-scans.sh`(含 scan-graph)
3. 验证:psql 查 graph_edges 三类边计数 + dispatcher→executor 抽查边存在
