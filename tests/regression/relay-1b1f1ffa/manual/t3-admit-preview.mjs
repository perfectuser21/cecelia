// t3-admit-preview.mjs — 模块2 admitPreview() 四层判定 + pg_advisory_xact_lock 并发串行化 + 幂等复用
// 用法: node t3-admit-preview.mjs count-limit|capacity-limit|usage-limit|concurrency-lock|idempotent-reuse
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { REPO_ROOT, GIB, realPool, fail, ok, testPrNumber, cleanupPrRow } from './_lib.mjs';

const mode = process.argv[2];
const workDir = mkdtempSync(join(tmpdir(), 'admit-preview-'));
mkdirSync(join(workDir, '.runtime'), { recursive: true });
const jsonPath = join(workDir, '.runtime', 'host-disk.json');

function writeSample(overrides = {}) {
  const base = {
    sampled_at_epoch: Math.floor(Date.now() / 1000),
    data_avail_bytes: 60 * GIB,
    apfs_unallocated_bytes: 62 * GIB,
    effective_free_bytes: 60 * GIB,
    usage_pct: 60,
    ...overrides,
  };
  writeFileSync(jsonPath, JSON.stringify(base));
  return base;
}

const seededPrs = [];

async function seedActiveRows(pool, n, status = 'active') {
  for (let i = 0; i < n; i++) {
    const pr = testPrNumber();
    seededPrs.push(pr);
    await pool.query(
      `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
       VALUES ($1, 'cp-fixture', 'cecelia', $2, $3, $4)`,
      [pr, 5300 + i, `cecelia_preview_${pr}`, status],
    );
  }
}

try {
  const { admitPreview } = await import(`${REPO_ROOT}/packages/brain/src/capacity-gate.js`);
  const pool = await realPool();

  if (mode === 'count-limit') {
    writeSample();
    await seedActiveRows(pool, 6); // 已有 6 个 active/starting/cleaning
    const targetPr = testPrNumber();
    const r = await admitPreview(targetPr, 'cp-new', 'cecelia', pool, { samplePath: jsonPath });
    if (r.admitted !== false) fail(`count-limit 场景应拒绝，实际 ${JSON.stringify(r)}`);
    if (r.reason !== 'too_many_active') fail(`reason 应为 too_many_active，实际 ${r.reason}`);
    if (!('free_bytes' in r) || !('projected_cost_bytes' in r) || !('need_release_bytes' in r)) {
      fail(`拒绝响应缺 free_bytes/projected_cost_bytes/need_release_bytes: ${JSON.stringify(r)}`);
    }
    ok('admit-count-limit');
  } else if (mode === 'capacity-limit') {
    // effective_free_bytes - 3.5GiB < 35GiB  =>  effective_free_bytes < 38.5GiB
    writeSample({ effective_free_bytes: 38 * GIB, data_avail_bytes: 38 * GIB, apfs_unallocated_bytes: 39 * GIB, usage_pct: 50 });
    const targetPr = testPrNumber();
    const r = await admitPreview(targetPr, 'cp-new', 'cecelia', pool, { samplePath: jsonPath });
    if (r.admitted !== false) fail(`capacity-limit 场景应拒绝，实际 ${JSON.stringify(r)}`);
    if (r.reason !== 'insufficient_free_space') fail(`reason 应为 insufficient_free_space，实际 ${r.reason}`);
    if (typeof r.free_bytes !== 'number' || r.free_bytes !== 38 * GIB) fail(`free_bytes 应为字节级精确值 38*GIB，实际 ${r.free_bytes}`);
    if (typeof r.need_release_bytes !== 'number' || r.need_release_bytes <= 0) fail(`need_release_bytes 应 > 0，实际 ${r.need_release_bytes}`);
    ok('admit-capacity-limit');
  } else if (mode === 'usage-limit') {
    writeSample({ usage_pct: 90, effective_free_bytes: 60 * GIB, data_avail_bytes: 60 * GIB, apfs_unallocated_bytes: 61 * GIB });
    const targetPr = testPrNumber();
    const r = await admitPreview(targetPr, 'cp-new', 'cecelia', pool, { samplePath: jsonPath });
    if (r.admitted !== false) fail(`usage-limit 场景应拒绝，实际 ${JSON.stringify(r)}`);
    if (r.reason !== 'usage_pct_too_high') fail(`reason 应为 usage_pct_too_high，实际 ${r.reason}`);
    ok('admit-usage-limit');
  } else if (mode === 'concurrency-lock') {
    // 已有 5 个 active（LIMIT=6），并发发起 3 个新准入请求 —— pg_advisory_xact_lock 应保证
    // 全程串行判定，最终 admitted:true 的数量严格 <= 1（6-5），不允许双通过竞态
    writeSample();
    await seedActiveRows(pool, 5);
    const prs = [testPrNumber(), testPrNumber(), testPrNumber()];
    seededPrs.push(...prs); // 无论是否 admitted 都要清理，负向情形不留残留

    const results = await Promise.all(
      prs.map((pr) => admitPreview(pr, 'cp-race', 'cecelia', pool, { samplePath: jsonPath })),
    );
    const admittedCount = results.filter((r) => r.admitted === true).length;
    if (admittedCount !== 1) fail(`并发 3 请求在剩余 1 个名额下应恰好 1 个 admitted，实际 ${admittedCount}（advisory lock 未生效或判定非原子）`);

    // GAN Round 1 反馈问题2 核心修复：不能只数返回值里 admitted===true 的个数——必须验证
    // preview_environments 表针对这 3 个候选 PR 确实恰好新增了 1 行真实 DB 记录。
    // 如果 generator 让 admitPreview() 判定通过后，调用方再单独调无锁的旧 allocatePreview()
    // 做端口扫描+INSERT（两段式、TOCTOU 竞态未消除的错误实现），这里会抓出行数与 admittedCount 不一致
    // 或者行数本身就因竞态多写。
    const { rows: rowCountRows } = await pool.query(
      `SELECT count(*)::int AS n FROM preview_environments WHERE pr_number = ANY($1::int[])`,
      [prs],
    );
    const dbRowCount = rowCountRows[0].n;
    if (dbRowCount !== 1) {
      fail(`preview_environments 表针对 3 个候选 PR 应恰好新增 1 行真实记录，实际 ${dbRowCount} 行（admitted 返回计数为 ${admittedCount}）——admitPreview 判定与端口预留之间存在未加锁的竞态窗口`);
    }

    // 方案A schema 升级校验：admitted:true 的响应必须携带 port/db_name（不是纯判定 {admitted:true}）
    const admittedResult = results.find((r) => r.admitted === true);
    if (typeof admittedResult.port !== 'number' || typeof admittedResult.db_name !== 'string' || !admittedResult.db_name) {
      fail(`admitted:true 响应应携带 port(number)/db_name(string)，实际 ${JSON.stringify(admittedResult)}`);
    }

    ok('admit-concurrency-lock');
  } else if (mode === 'idempotent-reuse') {
    // 已存在该 PR 的活跃记录（re-push 场景）：即使采样过期/容量爆满，也应直接放行（幂等复用不重新走准入）
    writeSample({ sampled_at_epoch: Math.floor(Date.now() / 1000) - 999 }); // 明显 stale
    const pr = testPrNumber();
    seededPrs.push(pr);
    await pool.query(
      `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
       VALUES ($1, 'cp-existing', 'cecelia', 5399, $2, 'active')`,
      [pr, `cecelia_preview_${pr}`],
    );
    const r = await admitPreview(pr, 'cp-existing', 'cecelia', pool, { samplePath: jsonPath });
    if (r.admitted !== true) fail(`已有活跃记录的 PR 重推应幂等放行，实际 ${JSON.stringify(r)}`);
    ok('admit-idempotent-reuse');
  } else {
    fail(`未知 mode: ${mode}`);
  }
} catch (err) {
  fail(`执行异常: ${err.message}\n${err.stack || ''}`);
} finally {
  try {
    const pool = await realPool();
    for (const pr of seededPrs) await cleanupPrRow(pool, pr);
  } catch { /* best-effort cleanup */ }
  rmSync(workDir, { recursive: true, force: true });
}
