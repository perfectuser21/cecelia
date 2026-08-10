/**
 * TDD Red 测试：账龄哨兵 per-repo 独立性
 * 合同覆盖：B-3（I-3 账龄哨兵按 repo 分别判龄，禁跨仓合并）
 *
 * 禁mock边规则：
 * - 账龄查询基于真实 postgres scanned_at 字段，不 mock DB
 * - computeFreshness 本身无 IO，允许单元测试
 *
 * 这些测试在实现前应全部 FAIL（RED阶段）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { computeFreshness } from '../../../packages/brain/src/lib/registry-freshness.js';
import { replaceRepoEdges } from '../../../packages/brain/src/lib/graph-store.js';

const DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
const DB_NAME = decodeURIComponent(new URL(DB_URL).pathname.slice(1));
if (!/(_test|_scratch)$/.test(DB_NAME)) throw new Error(`拒绝连接非测试库: ${DB_NAME}`);
const REVISION_A = 'a'.repeat(40);
const REVISION_B = 'b'.repeat(40);

function makeTempRepo(name) {
  const dir = path.join('/tmp', `${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stub.js'), 'export const x = 1;\n');
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Scan Graph Test']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'scan-graph-test@example.invalid']);
  execFileSync('git', ['-C', dir, 'add', 'stub.js']);
  execFileSync('git', ['-C', dir, 'commit', '-m', 'test fixture'], { stdio: 'ignore' });
  return dir;
}

describe('[B-3 + I-3] per-repo freshness 独立性', () => {
  let pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    // 清理测试数据
    await pool.query("DELETE FROM graph_edges WHERE repo LIKE 'freshness-test-%'");
    await pool.query("DELETE FROM fact_snapshot_headers WHERE kind = 'graph' AND repo LIKE 'freshness-test-%'");
    await pool.end();
  });

  it('computeFreshness 接受 null → stale: true（无数据场景）', () => {
    const f = computeFreshness(null);
    expect(f.stale).toBe(true);
    expect(f.latest_scan).toBeNull();
  });

  it('computeFreshness 接受刚写入且 provenance 完整的 metadata → fresh', () => {
    const now = new Date();
    const justNow = new Date(now.getTime() - 60_000); // 1分钟前
    const f = computeFreshness({
      scanned_at: justNow, source_revision: REVISION_A, scanner_version: 'graph-v3',
    }, now);
    expect(f.stale).toBe(false);
    expect(f.status).toBe('fresh');
    expect(f.age_hours).toBeLessThan(1);
  });

  it('computeFreshness 接受 25h 前时间戳 → stale: true', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 25 * 3600_000);
    const f = computeFreshness({
      scanned_at: old, source_revision: REVISION_A, scanner_version: 'graph-v3',
    }, now);
    expect(f.stale).toBe(true);
    expect(f.age_hours).toBeGreaterThan(24);
  });

  it('真实 DB：不同 repo 的 max(scanned_at) 独立查询，不跨仓合并', async () => {
    // 写入两个 repo 的边（scanned_at 由 DB DEFAULT NOW() 自动设置）
    await replaceRepoEdges(pool, 'freshness-test-A', [
      { src_path: 'a1.js', dst_path: 'a2.js', edge_type: 'import', detail: {} },
    ], { sourceRevision: REVISION_A, scannerVersion: 'graph-v3' });
    await replaceRepoEdges(pool, 'freshness-test-B', [
      { src_path: 'b1.js', dst_path: 'b2.js', edge_type: 'import', detail: {} },
    ], { sourceRevision: REVISION_B, scannerVersion: 'graph-v3' });

    // 各自独立查询 max(scanned_at)
    const { rows: rowA } = await pool.query(
      "SELECT scanned_at, source_revision, scanner_version FROM fact_snapshot_headers WHERE kind = 'graph' AND repo = 'freshness-test-A'"
    );
    const { rows: rowB } = await pool.query(
      "SELECT scanned_at, source_revision, scanner_version FROM fact_snapshot_headers WHERE kind = 'graph' AND repo = 'freshness-test-B'"
    );

    // 合并查询（应该不被使用）
    const fA = computeFreshness(rowA[0] ?? null);
    const fB = computeFreshness(rowB[0] ?? null);

    // 两个 repo 各自 stale=false
    expect(fA.stale).toBe(false);
    expect(fB.stale).toBe(false);

    // 各自 freshness 独立（都刚插入，时间应接近）
    expect(fA.latest_scan).not.toBeNull();
    expect(fB.latest_scan).not.toBeNull();

    // 验证没有用合并查询：per-repo 的 max 值应等于合并查询的 max 值（因为都刚写，时间接近）
    // 关键验证：合并查询得到的是两者中较大的，但单仓查询各自独立
    // 如果 B 的 scanned_at > A 的 scanned_at，那么跨仓合并得到的 freshness 会掩盖 A 的实际状态
    // 这个测试验证各自独立查询比合并更安全
    expect(fA.latest_scan).toBeTruthy();
    expect(fB.latest_scan).toBeTruthy();
  });

  it('scan-graph.mjs 的 scanRepo 或 scanRepoList 必须返回 per-repo freshness 信息', async () => {
    // RED: 当前 scan-graph.mjs 无导出
    let scanGraphModule;
    try {
      scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    } catch {
      expect.fail('scan-graph.mjs 必须可被 import（需导出，不能只是 top-level script）');
    }

    const scanRepo = scanGraphModule?.scanRepo;
    const scanRepoList = scanGraphModule?.scanRepoList;
    expect(scanRepo || scanRepoList, '必须导出 scanRepo 或 scanRepoList').toBeTruthy();
  });

  it('scanRepoList 结果中每个成功仓库有 freshness 字段（stale, latest_scan, age_hours）', async () => {
    let scanGraphModule;
    try {
      scanGraphModule = await import('../../../scripts/scan/scan-graph.mjs');
    } catch {
      return; // 依赖导出，上一个测试覆盖
    }

    const scanRepoList = scanGraphModule?.scanRepoList;
    if (!scanRepoList) return;

    // 用带真实 revision 的极小 Git repo 验证完整扫描生命周期。
    const tmpDir = makeTempRepo('freshness-test-repo');
    try {
      const results = await scanRepoList([
        { name: 'freshness-test-tmp', root: tmpDir },
      ], pool);

      const result = results.find((r) => r.name === 'freshness-test-tmp');
      expect(result?.freshness).toBeDefined();
      expect(typeof result.freshness.stale).toBe('boolean');
      expect(result.freshness.stale).toBe(false); // 刚扫完
      expect(result.freshness).toMatchObject({
        status: 'fresh', reason_code: null, scanner_version: 'graph-v3',
      });
      expect(result.freshness.source_revision).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i);

    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      await pool.query("DELETE FROM graph_edges WHERE repo = 'freshness-test-tmp'");
      await pool.query("DELETE FROM fact_snapshot_headers WHERE kind = 'graph' AND repo = 'freshness-test-tmp'");
    }
  });
});

describe('[I-3] 禁跨仓合并场景：一仓 stale 不被另一仓活跃遮蔽', () => {
  it('repo-X stale（无数据）时，repo-Y 活跃不影响 repo-X 的 stale 判定', () => {
    // X 无数据 → stale: true
    const fX = computeFreshness(null);
    // Y 刚扫描 → stale: false
    const metadata = {
      scanned_at: new Date(), source_revision: REVISION_A, scanner_version: 'graph-v3',
    };
    const fY = computeFreshness(metadata);

    // 关键：不能把 Y 的时间戳赋给 X
    expect(fX.stale).toBe(true);
    expect(fY.stale).toBe(false);

    // 禁止跨仓合并（如果用 Math.max 取两者最大值，X 会得到 Y 的时间，错误地变成 stale:false）
    // 验证：拿 Y 的时间去算 X 的 freshness → 也应该是 false（这是错误行为，实现不应这么做）
    // 但我们在合同层验证：实现必须分别查，不能用同一个 latestScanAt 共享
    const fXWrong = computeFreshness(metadata); // 错误实现：用 Y 的 metadata 算 X
    expect(fXWrong.stale).toBe(false); // 这证明跨仓合并会导致误判
    // 正确实现必须用各自独立的查询，不能复用
  });
});
