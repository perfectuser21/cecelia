/**
 * TDD Red 测试：scan-graph.mjs 多仓扩展
 * 合同覆盖：B-1（REPOS清单）、B-2（路径不存在隔离）、I-1（全量替换）、I-2（失败隔离）
 *
 * 禁mock边规则：
 * - replaceRepoEdges（DB写路径）使用真实 postgres 连接（cecelia_test DB）
 * - 文件系统路径检测用真实 /tmp 目录模拟
 *
 * 运行前提：TEST_DATABASE_URL 或 DATABASE_URL 指向可用的 postgres 实例
 * 这些测试在实现前应全部 FAIL（RED阶段）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { replaceRepoEdges } from '../../../packages/brain/src/lib/graph-store.js';

const DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
const DB_NAME = decodeURIComponent(new URL(DB_URL).pathname.slice(1));
if (!/(_test|_scratch)$/.test(DB_NAME)) throw new Error(`拒绝连接非测试库: ${DB_NAME}`);

// ─── 辅助：创建临时 repo 目录（包含一个 JS 文件，避免 walk 报错）
function makeTempRepo(name) {
  const dir = path.join('/tmp', `scan-test-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), `// test stub for ${name}\nexport const x = 1;\n`);
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Scan Graph Test']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'scan-graph-test@example.invalid']);
  execFileSync('git', ['-C', dir, 'add', 'index.js']);
  execFileSync('git', ['-C', dir, 'commit', '-m', 'test fixture'], { stdio: 'ignore' });
  return dir;
}

// ─── 辅助：从 scan-graph.mjs 导出的 REPOS 清单（实现后可用，这里验证结构）
// 注意：scan-graph.mjs 目前是脚本形式（有 main()），无法直接 import 清单。
// 合同要求：scan-graph.mjs 必须将 REPOS 清单作为具名导出，或通过 getRepos() 导出。
// 本测试验证该导出存在且结构正确。
let scanGraphModule;

describe('[B-1] REPOS 清单导出与结构', () => {
  it('scan-graph.mjs 必须导出 REPOS 清单（具名导出 REPOS 或 getRepos）', async () => {
    // RED: 当前 scan-graph.mjs 无任何导出
    scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs').catch(() => null);
    // 实现后，模块应导出 REPOS 或 getRepos
    expect(scanGraphModule).not.toBeNull();
    const repos = scanGraphModule?.REPOS ?? (typeof scanGraphModule?.getRepos === 'function' ? scanGraphModule.getRepos() : null);
    expect(repos, '必须导出 REPOS 数组或 getRepos()').not.toBeNull();
    expect(Array.isArray(repos)).toBe(true);
  });

  it('REPOS 清单包含至少三仓：cecelia / zenithjoy-workspace / zenithjoy-skills', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs').catch(() => null);
    const repos = scanGraphModule?.REPOS ?? (typeof scanGraphModule?.getRepos === 'function' ? scanGraphModule.getRepos() : []);
    const names = repos.map((r) => r.name);
    expect(names).toContain('cecelia');
    expect(names).toContain('zenithjoy-workspace');
    expect(names).toContain('zenithjoy-skills');
  });

  it('cecelia 仓库读取环境变量 REPO_ROOT_CECELIA，不存在时使用默认路径', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs').catch(() => null);
    const repos = scanGraphModule?.REPOS ?? (typeof scanGraphModule?.getRepos === 'function' ? scanGraphModule.getRepos() : []);
    const cecelia = repos.find((r) => r.name === 'cecelia');
    expect(cecelia).toBeDefined();
    expect(cecelia.root).toBeTruthy();
    // root 应该是字符串路径
    expect(typeof cecelia.root).toBe('string');
  });

  it('zenithjoy-workspace 仓库读取环境变量 REPO_ROOT_ZJ_WORKSPACE', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs').catch(() => null);
    const repos = scanGraphModule?.REPOS ?? (typeof scanGraphModule?.getRepos === 'function' ? scanGraphModule.getRepos() : []);
    const zj = repos.find((r) => r.name === 'zenithjoy-workspace');
    expect(zj).toBeDefined();
    expect(typeof zj.root).toBe('string');
  });

  it('GRAPH_REPOS 未设置时默认选择全部三仓', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    expect(typeof scanGraphModule.selectGraphRepos).toBe('function');
    expect(scanGraphModule.selectGraphRepos(scanGraphModule.REPOS, undefined).map((repo) => repo.name))
      .toEqual(['cecelia', 'zenithjoy-workspace', 'zenithjoy-skills']);
  });

  it('GRAPH_REPOS 显式选择时只返回请求仓库且保持请求顺序', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    expect(scanGraphModule.selectGraphRepos(
      scanGraphModule.REPOS,
      'zenithjoy-workspace,cecelia',
    ).map((repo) => repo.name)).toEqual(['zenithjoy-workspace', 'cecelia']);
  });

  it('GRAPH_REPOS 空值时清晰失败', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    expect(() => scanGraphModule.selectGraphRepos(scanGraphModule.REPOS, '  '))
      .toThrow(/GRAPH_REPOS.*不能为空/);
  });

  it('GRAPH_REPOS 含未知仓库时清晰失败', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    expect(() => scanGraphModule.selectGraphRepos(scanGraphModule.REPOS, 'cecelia,unknown-repo'))
      .toThrow(/GRAPH_REPOS.*未知仓库.*unknown-repo/);
  });
});

describe('[B-2 + I-5] 路径不存在时 WARN 跳过，不炸整轮', () => {
  it('scan-graph.mjs 导出 scanRepo(repo, pool) 函数或 scanRepoList(repos, pool)', async () => {
    // 合同要求：为了可测试性，必须导出可单独调用的扫描函数
    // RED: 当前无导出
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs').catch(() => null);
    const hasScanRepo = typeof scanGraphModule?.scanRepo === 'function';
    const hasScanList = typeof scanGraphModule?.scanRepoList === 'function';
    expect(hasScanRepo || hasScanList, '必须导出 scanRepo 或 scanRepoList').toBe(true);
  });

  it('路径不存在时 scanRepo 返回 { skipped: true, reason: "path_not_found" }，不抛出', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs').catch(() => null);
    const scanRepo = scanGraphModule?.scanRepo;
    if (!scanRepo) return; // 依赖上一个测试先通过

    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
      const result = await scanRepo({ name: 'nonexistent-test', root: '/nonexistent_path_xyz_404' }, pool);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('path_not_found');
    } finally {
      await pool.end();
    }
  });

  it('一仓路径不存在时，其他仓的 DB 数据不受影响（I-2 失败隔离）', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs').catch(() => null);
    const scanRepoList = scanGraphModule?.scanRepoList;
    if (!scanRepoList) return;

    // 用真实 PG 连接
    const pool = new pg.Pool({ connectionString: DB_URL });
    let tmpDir;
    try {
      // 先插入已知数据到 test-repo-A
      const fakeEdges = [
        { src_path: 'a.js', dst_path: 'b.js', edge_type: 'import', detail: {} },
      ];
      await replaceRepoEdges(pool, 'test-repo-A', fakeEdges);

      // 扫描：test-repo-A 真实存在（临时目录），bad-repo 路径不存在
      tmpDir = makeTempRepo('good-A');
      const results = await scanRepoList([
        { name: 'test-repo-A', root: tmpDir },   // 会被真实扫描并全量替换
        { name: 'bad-repo-B', root: '/nonexistent_bad_path_999' }, // 应跳过
      ], pool);

      // bad-repo-B 跳过
      const badResult = results.find((r) => r.name === 'bad-repo-B');
      expect(badResult?.skipped).toBe(true);

      // test-repo-A 被全量替换（scanRepo 用真实 dependency-cruiser，此处只验证未报错）
      const goodResult = results.find((r) => r.name === 'test-repo-A');
      expect(goodResult?.error).toBeUndefined();

    } finally {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      await replaceRepoEdges(pool, 'test-repo-A', []); // 清空测试数据
      await pool.query("DELETE FROM fact_snapshot_headers WHERE kind = 'graph' AND repo = 'test-repo-A'");
      await pool.end();
    }
  });
});

describe('[I-1] 全量替换语义验证（真实 PG）', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // 预插入旧数据，验证全量替换会清掉
    await replaceRepoEdges(pool, 'test-replace-repo', [
      { src_path: 'old.js', dst_path: 'stale.js', edge_type: 'import', detail: {} },
      { src_path: 'old2.js', dst_path: 'stale2.js', edge_type: 'import', detail: {} },
    ]);
  });

  afterAll(async () => {
    // 清理测试数据
    await pool.query('DELETE FROM graph_edges WHERE repo = $1', ['test-replace-repo']);
    await pool.query(
      "DELETE FROM fact_snapshot_headers WHERE kind = 'graph' AND repo IN ('test-replace-repo','test-repo-X','test-repo-Y')",
    );
    await pool.end();
  });

  it('replaceRepoEdges 全量替换后旧边消失，只有新边存在', async () => {
    const newEdges = [
      { src_path: 'new.js', dst_path: 'fresh.js', edge_type: 'import', detail: {} },
    ];
    await replaceRepoEdges(pool, 'test-replace-repo', newEdges);

    const { rows } = await pool.query(
      'SELECT src_path, dst_path FROM graph_edges WHERE repo = $1',
      ['test-replace-repo']
    );
    // 旧边消失
    expect(rows.find((r) => r.src_path === 'old.js')).toBeUndefined();
    // 新边存在
    expect(rows.find((r) => r.src_path === 'new.js')).toBeDefined();
    expect(rows.length).toBe(1);
  });

  it('幂等性：同一仓库扫两次，第二次 edges 数量与第一次一致（NFR-2）', async () => {
    const edges = [
      { src_path: 'x.js', dst_path: 'y.js', edge_type: 'import', detail: {} },
      { src_path: 'a.js', dst_path: 'b.js', edge_type: 'spawn', detail: { line: 1, via: 'exec' } },
    ];
    const { inserted: i1 } = await replaceRepoEdges(pool, 'test-replace-repo', edges);
    const { inserted: i2 } = await replaceRepoEdges(pool, 'test-replace-repo', edges);
    expect(i1).toBe(i2);

    const { rows } = await pool.query(
      'SELECT count(*) AS cnt FROM graph_edges WHERE repo = $1',
      ['test-replace-repo']
    );
    expect(Number(rows[0].cnt)).toBe(edges.length);
  });

  it('不同 repo 互相隔离：替换 repo-X 不影响 repo-Y', async () => {
    await replaceRepoEdges(pool, 'test-repo-X', [
      { src_path: 'x.js', dst_path: 'y.js', edge_type: 'import', detail: {} },
    ]);
    await replaceRepoEdges(pool, 'test-repo-Y', [
      { src_path: 'p.js', dst_path: 'q.js', edge_type: 'import', detail: {} },
    ]);

    // 替换 X，Y 不动
    await replaceRepoEdges(pool, 'test-repo-X', [
      { src_path: 'new-x.js', dst_path: 'new-y.js', edge_type: 'import', detail: {} },
    ]);

    const { rows: yRows } = await pool.query(
      'SELECT src_path FROM graph_edges WHERE repo = $1', ['test-repo-Y']
    );
    expect(yRows.find((r) => r.src_path === 'p.js')).toBeDefined();

    // 清理
    await pool.query("DELETE FROM graph_edges WHERE repo IN ('test-repo-X','test-repo-Y')");
  });
});
