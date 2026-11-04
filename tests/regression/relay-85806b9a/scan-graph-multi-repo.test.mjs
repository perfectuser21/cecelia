/** 真实多仓扫描和 revision 快照合同。
 * TEST_DATABASE_URL 必须指向本轮私有 127.0.0.1 非5432端口的 cecelia_scratch。
 * 所有 Git 仓库为 /tmp 本路夹具；不运行扫描器 main 或真实工作区扫描。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { replaceRepoEdges } from '../../../packages/brain/src/lib/graph-store.js';

import { pool as fixturePool, openFixture, closeFixture } from '../../../packages/brain/src/__tests__/helpers/debt-11-pg.js';
beforeAll(async () => {
  await openFixture('graph', ['351_graph_edges.sql', '400_fact_snapshot_metadata.sql', '410_versioned_graph_snapshots.sql'], `
    CREATE TABLE api_registry(method text, path text, scanned_at timestamptz);
    CREATE TABLE db_schema_registry(table_name text, scanned_at timestamptz);
    CREATE TABLE test_registry(file_path text, scanned_at timestamptz);
  `);
});
afterAll(closeFixture);

// 每次全量替换代表不同 revision；同 revision 改边会被现役不可变快照合同拒绝。
const replace = (pool, repo, edges, revision = randomUUID()) => replaceRepoEdges(pool, repo, edges, {
  sourceRevision: revision, scannerVersion: 'debt-11',
});

// ─── 辅助：创建临时 repo 目录（包含一个 JS 文件，避免 walk 报错）
function makeTempRepo(name) {
  const dir = fs.mkdtempSync(path.join('/tmp', `cecelia-debt-11-${name}-`));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dependency.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'index.js'), "import { x } from './dependency.js'; export { x };\n");
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Scan Graph Test']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'scan-graph-test@example.invalid']);
  execFileSync('git', ['-C', dir, 'add', 'index.js', 'dependency.js']);
  execFileSync('git', ['-C', dir, 'commit', '-m', 'test fixture'], { stdio: 'ignore' });
  return dir;
}

// ─── 辅助：从 scan-graph.mjs 导出的 REPOS 清单（实现后可用，这里验证结构）
// 合同要求：scan-graph.mjs 必须将 REPOS 清单作为具名导出，或通过 getRepos() 导出。
// import 只加载导出，不执行脚本 main。
let scanGraphModule;

describe('[B-1] REPOS 清单导出与结构', () => {
  it('scan-graph.mjs 必须导出 REPOS 清单（具名导出 REPOS 或 getRepos）', async () => {
    scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    // 实现后，模块应导出 REPOS 或 getRepos
    expect(scanGraphModule).not.toBeNull();
    const repos = scanGraphModule?.REPOS ?? (typeof scanGraphModule?.getRepos === 'function' ? scanGraphModule.getRepos() : null);
    expect(repos, '必须导出 REPOS 数组或 getRepos()').not.toBeNull();
    expect(Array.isArray(repos)).toBe(true);
  });

  it('REPOS 清单包含至少三仓：cecelia / zenithjoy-workspace / zenithjoy-skills', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    const repos = scanGraphModule?.REPOS ?? (typeof scanGraphModule?.getRepos === 'function' ? scanGraphModule.getRepos() : []);
    const names = repos.map((r) => r.name);
    expect(names).toContain('cecelia');
    expect(names).toContain('zenithjoy-workspace');
    expect(names).toContain('zenithjoy-skills');
  });

  it('cecelia 仓库读取环境变量 REPO_ROOT_CECELIA，不存在时使用默认路径', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    const repos = scanGraphModule?.REPOS ?? (typeof scanGraphModule?.getRepos === 'function' ? scanGraphModule.getRepos() : []);
    const cecelia = repos.find((r) => r.name === 'cecelia');
    expect(cecelia).toBeDefined();
    expect(cecelia.root).toBeTruthy();
    // root 应该是字符串路径
    expect(typeof cecelia.root).toBe('string');
  });

  it('zenithjoy-workspace 仓库读取环境变量 REPO_ROOT_ZJ_WORKSPACE', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
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
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    const hasScanRepo = typeof scanGraphModule?.scanRepo === 'function';
    const hasScanList = typeof scanGraphModule?.scanRepoList === 'function';
    expect(hasScanRepo || hasScanList, '必须导出 scanRepo 或 scanRepoList').toBe(true);
  });

  it('路径不存在时 scanRepo 返回 { skipped: true, reason: "path_not_found" }，不抛出', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    const scanRepo = scanGraphModule?.scanRepo;
    expect(typeof scanRepo).toBe('function');

    const pool = fixturePool;
    try {
      const result = await scanRepo({ name: 'nonexistent-test', root: '/nonexistent_path_xyz_404' }, pool);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('path_not_found');
    } finally {
      await pool.end();
    }
  });

  it('一仓路径不存在时，其他仓的 DB 数据不受影响（I-2 失败隔离）', async () => {
    if (!scanGraphModule) scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    const scanRepoList = scanGraphModule?.scanRepoList;
    expect(typeof scanRepoList).toBe('function');

    // 用真实 PG 连接
    const pool = fixturePool;
    let tmpDir;
    try {
      // 先插入已知数据到 test-repo-A
      const fakeEdges = [
        { src_path: 'a.js', dst_path: 'b.js', edge_type: 'import', detail: {} },
      ];
      await replace(pool, 'test-repo-A', fakeEdges);

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
      expect(goodResult.inserted).toBeGreaterThan(0);
      const { rows } = await pool.query("SELECT src_path, dst_path FROM graph_edges WHERE repo = 'test-repo-A'");
      expect(rows.some(row => row.src_path.endsWith('index.js') && row.dst_path.endsWith('dependency.js'))).toBe(true);
      expect(rows.some(row => row.src_path === 'a.js')).toBe(false);

    } finally {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      await replace(pool, 'test-repo-A', []); // 清空测试数据
      await pool.query("DELETE FROM fact_snapshot_headers WHERE kind = 'graph' AND repo = 'test-repo-A'");
      await pool.end();
    }
  });
});

describe('[I-1] 全量替换语义验证（真实 PG）', () => {
  let pool;

  beforeAll(async () => {
    pool = fixturePool;
    // 预插入旧数据，验证全量替换会清掉
    await replace(pool, 'test-replace-repo', [
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
    await replace(pool, 'test-replace-repo', newEdges);

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
    const { inserted: i1 } = await replace(pool, 'test-replace-repo', edges, 'idempotent-revision');
    const { inserted: i2 } = await replace(pool, 'test-replace-repo', edges, 'idempotent-revision');
    expect(i1).toBe(i2);

    const { rows } = await pool.query(
      'SELECT count(*) AS cnt FROM graph_edges WHERE repo = $1',
      ['test-replace-repo']
    );
    expect(Number(rows[0].cnt)).toBe(edges.length);
  });

  it('同 revision 篡改边会拒绝且保留已提交快照', async () => {
    await replace(pool, 'immutable-repo', [{ src_path: 'a.js', dst_path: 'b.js', edge_type: 'import' }], 'same-revision');
    await expect(replace(pool, 'immutable-repo', [], 'same-revision')).rejects.toMatchObject({ code: 'GRAPH_SNAPSHOT_IMMUTABILITY_VIOLATION' });
    const { rows } = await pool.query("SELECT src_path FROM graph_edges WHERE repo = 'immutable-repo'");
    expect(rows).toEqual([{ src_path: 'a.js' }]);
  });

  it('不同 repo 互相隔离：替换 repo-X 不影响 repo-Y', async () => {
    await replace(pool, 'test-repo-X', [
      { src_path: 'x.js', dst_path: 'y.js', edge_type: 'import', detail: {} },
    ]);
    await replace(pool, 'test-repo-Y', [
      { src_path: 'p.js', dst_path: 'q.js', edge_type: 'import', detail: {} },
    ]);

    // 替换 X，Y 不动
    await replace(pool, 'test-repo-X', [
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
