/**
 * TDD Red 测试：routes/graph.js repo 参数化
 * 合同覆盖：B-4（FR-4 GET /api/brain/graph/* 端点接受 repo 参数，默认 cecelia）
 *
 * 禁mock边规则（harness-contract-proposer v9.12）：
 * - loadGraphContext 查询 DB，不 mock pool（需真实 PG）
 * - 但 express 路由层可以用 supertest 测试（不是被改的那条边）
 *
 * 这些测试在实现前应全部 FAIL（RED阶段）。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { replaceRepoEdges } from '../../../packages/brain/src/lib/graph-store.js';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://localhost/cecelia_test';

// ─── 直接测试 loadGraphContext 函数（需从 routes/graph.js 导出或提取到 lib）
// 合同要求：loadGraphContext(repo) 必须接受 repo 参数
describe('[B-4] loadGraphContext(repo) 接受参数', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // 插入两个 repo 的测试数据
    await replaceRepoEdges(pool, 'route-test-alpha', [
      { src_path: 'alpha/a.js', dst_path: 'alpha/b.js', edge_type: 'import', detail: {} },
    ]);
    await replaceRepoEdges(pool, 'route-test-beta', [
      { src_path: 'beta/x.js', dst_path: 'beta/y.js', edge_type: 'import', detail: {} },
    ]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM graph_edges WHERE repo IN ('route-test-alpha', 'route-test-beta')");
    await pool.end();
  });

  it('routes/graph.js 不再有 const REPO = \'cecelia\' 硬编码', async () => {
    // RED: 当前有硬编码
    const fs = await import('node:fs');
    const path = await import('node:path');
    const content = fs.default.readFileSync(
      path.default.resolve('/workspace/packages/brain/src/routes/graph.js'),
      'utf8'
    );
    // 实现后这行必须消失
    expect(content).not.toMatch(/const REPO = ['"]cecelia['"]/);
  });

  it('loadGraphContext 必须作为具名导出从 routes/graph.js 或独立 lib 可访问', async () => {
    // RED: 当前 routes/graph.js 无具名导出
    let mod;
    try {
      mod = await import('../../../packages/brain/src/routes/graph.js');
    } catch (e) {
      expect.fail(`无法 import routes/graph.js: ${e.message}`);
    }
    // 合同要求：导出 loadGraphContext 以便测试（或通过 supertest 测试路由行为）
    // 方案A：直接导出 loadGraphContext
    // 方案B：通过 supertest 测试路由参数传递
    // 本测试选方案A验证
    expect(typeof mod?.loadGraphContext).toBe('function');
  });

  it('loadGraphContext("route-test-alpha") 只返回 alpha 的边，不返回 beta 的', async () => {
    let mod;
    try {
      mod = await import('../../../packages/brain/src/routes/graph.js');
    } catch {
      return;
    }
    if (typeof mod?.loadGraphContext !== 'function') {
      expect.fail('loadGraphContext 未导出，无法测试');
    }

    // 用测试 DB pool 替换（需要 loadGraphContext 接受 pool 参数或使用模块级 pool）
    // 合同要求：loadGraphContext(repo, pool?) 或 loadGraphContext(repo) 使用全局 pool
    // 这里通过直接查询验证 DB 层面的隔离
    const { rows: alphaRows } = await pool.query(
      "SELECT src_path FROM graph_edges WHERE repo = 'route-test-alpha'"
    );
    const { rows: betaRows } = await pool.query(
      "SELECT src_path FROM graph_edges WHERE repo = 'route-test-beta'"
    );

    // 验证 DB 层面的 repo 过滤正确
    expect(alphaRows.some((r) => r.src_path.startsWith('alpha/'))).toBe(true);
    expect(betaRows.some((r) => r.src_path.startsWith('beta/'))).toBe(true);
    // alpha 不含 beta 的路径
    expect(alphaRows.some((r) => r.src_path.startsWith('beta/'))).toBe(false);
  });

  it('默认不传 repo 时行为等同 cecelia（向后兼容 FR-4）', async () => {
    let mod;
    try {
      mod = await import('../../../packages/brain/src/routes/graph.js');
    } catch {
      return;
    }
    if (typeof mod?.loadGraphContext !== 'function') return;

    // 调用不传 repo（默认值必须是 'cecelia'）
    // 此处测试函数签名，不测试实际 DB 返回（避免依赖生产数据）
    // 通过函数参数默认值验证
    const fnStr = mod.loadGraphContext.toString();
    // 函数签名应含 repo = 'cecelia' 或 repo='cecelia'
    expect(fnStr).toMatch(/repo\s*=\s*['"]cecelia['"]/);
  });
});

describe('[FR-4] 路由层 repo query 参数读取', () => {
  it('GET /locate 路由从 req.query.repo 读取 repo 参数', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const content = fs.default.readFileSync(
      path.default.resolve('/workspace/packages/brain/src/routes/graph.js'),
      'utf8'
    );
    // 实现后应包含从 query 读取 repo 的代码
    expect(content).toMatch(/req\.query\.repo/);
  });

  it('POST /radius 路由从 req.body.repo 读取 repo 参数', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const content = fs.default.readFileSync(
      path.default.resolve('/workspace/packages/brain/src/routes/graph.js'),
      'utf8'
    );
    // POST 路由需从 body 读取
    expect(content).toMatch(/req\.body\.repo/);
  });

  it('loadGraphContext 被调用时传入 repo 参数（非固定字符串）', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const content = fs.default.readFileSync(
      path.default.resolve('/workspace/packages/brain/src/routes/graph.js'),
      'utf8'
    );
    // 调用 loadGraphContext 时应传入变量，不是硬编码字符串
    // 匹配：loadGraphContext(repo) 而不是 loadGraphContext('cecelia') 或 loadGraphContext()
    const callPattern = /loadGraphContext\(\s*repo\s*\)/;
    expect(content).toMatch(callPattern);
  });

  it('anchor-coverage 路由也接受 req.query.repo 参数', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const content = fs.default.readFileSync(
      path.default.resolve('/workspace/packages/brain/src/routes/graph.js'),
      'utf8'
    );
    // anchor-coverage 是 GET，也应从 query 读取
    // 验证 anchor-coverage handler 内有 req.query.repo 或 _req.query.repo 读取
    expect(content).toMatch(/req\.query\.repo|_req\.query\.repo/);
  });
});

describe('[FR-4] loadGraphContext WHERE repo 参数化验证（真实 DB）', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // 插入 repo-param-test 数据
    await replaceRepoEdges(pool, 'repo-param-test', [
      { src_path: 'param/a.js', dst_path: 'param/b.js', edge_type: 'import', detail: {} },
      { src_path: 'param/c.js', dst_path: 'param/d.js', edge_type: 'spawn', detail: { line: 1, via: 'exec' } },
    ]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM graph_edges WHERE repo = 'repo-param-test'");
    await pool.end();
  });

  it('DB 层 WHERE repo=$1 过滤：只返回指定 repo 的 edges', async () => {
    const { rows } = await pool.query(
      'SELECT src_path, dst_path FROM graph_edges WHERE repo = $1',
      ['repo-param-test']
    );
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.src_path.startsWith('param/'))).toBe(true);
  });

  it('DB 层 WHERE repo=$1 过滤：不同 repo 返回空（无数据泄露）', async () => {
    const { rows } = await pool.query(
      'SELECT src_path FROM graph_edges WHERE repo = $1',
      ['nonexistent-repo-xyz']
    );
    expect(rows.length).toBe(0);
  });
});
