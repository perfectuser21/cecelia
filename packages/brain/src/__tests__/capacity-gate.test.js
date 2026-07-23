// capacity-gate.test.js [BEHAVIOR] — 模块2 容量准入闸门
// TDD Red 证据（vitest）。禁 mock 被测边：真连 cecelia_test Postgres（不 mock ../db.js），真文件系统。
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const GIB = 1073741824;
let pool;
let readHostDisk;
let admitPreview;
const seededPrs = [];

function testPr() {
  return 910000 + Math.floor(Math.random() * 9000);
}

beforeAll(async () => {
  pool = (await import('../db.js')).default;
  ({ readHostDisk, admitPreview } = await import('../capacity-gate.js'));
});

afterEach(async () => {
  while (seededPrs.length) {
    const pr = seededPrs.pop();
    await pool.query('DELETE FROM preview_environments WHERE pr_number = $1', [pr]);
  }
});

function mkSampleFile(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cap-gate-red-'));
  mkdirSync(join(dir, '.runtime'), { recursive: true });
  const p = join(dir, '.runtime', 'host-disk.json');
  writeFileSync(p, JSON.stringify({
    sampled_at_epoch: Math.floor(Date.now() / 1000),
    data_avail_bytes: 60 * GIB,
    apfs_unallocated_bytes: 62 * GIB,
    effective_free_bytes: 60 * GIB,
    usage_pct: 60,
    ...overrides,
  }));
  return p;
}

describe('readHostDisk [BEHAVIOR] — 4 种拒绝分支', () => {
  it('样本文件缺失 → reason sample_missing', async () => {
    const r = await readHostDisk('/tmp/definitely-not-exist-host-disk.json');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sample_missing');
  });

  it('样本 JSON 损坏 → reason sample_corrupt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-gate-corrupt-'));
    mkdirSync(join(dir, '.runtime'), { recursive: true });
    const p = join(dir, '.runtime', 'host-disk.json');
    writeFileSync(p, '{not json');
    const r = await readHostDisk(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sample_corrupt');
    rmSync(dir, { recursive: true, force: true });
  });

  it('样本过期（>180s）→ reason sample_stale', async () => {
    const p = mkSampleFile({ sampled_at_epoch: Math.floor(Date.now() / 1000) - 300 });
    const r = await readHostDisk(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sample_stale');
  });

  it('样本字段不完整 → reason sample_incomplete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-gate-incomplete-'));
    mkdirSync(join(dir, '.runtime'), { recursive: true });
    const p = join(dir, '.runtime', 'host-disk.json');
    writeFileSync(p, JSON.stringify({ sampled_at_epoch: Math.floor(Date.now() / 1000) }));
    const r = await readHostDisk(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sample_incomplete');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('admitPreview [BEHAVIOR] — 四层判定 + 并发串行化', () => {
  it('active/starting/cleaning 数量 >= 6 → 拒绝 too_many_active', async () => {
    const samplePath = mkSampleFile();
    for (let i = 0; i < 6; i++) {
      const pr = testPr();
      seededPrs.push(pr);
      await pool.query(
        `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
         VALUES ($1, 'cp-fixture', 'cecelia', $2, $3, 'active')`,
        [pr, 5300 + i, `cecelia_preview_${pr}`],
      );
    }
    const target = testPr();
    const r = await admitPreview(target, 'cp-new', 'cecelia', pool, { samplePath });
    expect(r.admitted).toBe(false);
    expect(r.reason).toBe('too_many_active');
  });

  it('effective_free_bytes - 3.5GiB < 35GiB → 拒绝 insufficient_free_space（字节级比较）', async () => {
    const samplePath = mkSampleFile({ effective_free_bytes: 38 * GIB, data_avail_bytes: 38 * GIB, apfs_unallocated_bytes: 39 * GIB });
    const target = testPr();
    const r = await admitPreview(target, 'cp-new', 'cecelia', pool, { samplePath });
    expect(r.admitted).toBe(false);
    expect(r.reason).toBe('insufficient_free_space');
    expect(r.free_bytes).toBe(38 * GIB);
  });

  it('usage_pct >= 85 → 拒绝 usage_pct_too_high', async () => {
    const samplePath = mkSampleFile({ usage_pct: 90 });
    const target = testPr();
    const r = await admitPreview(target, 'cp-new', 'cecelia', pool, { samplePath });
    expect(r.admitted).toBe(false);
    expect(r.reason).toBe('usage_pct_too_high');
  });

  it('并发准入通过 pg_advisory_xact_lock 串行化，剩余 1 名额时 3 并发请求只 1 个 admitted，且 DB 恰好新增 1 行真实预留记录', async () => {
    const samplePath = mkSampleFile();
    for (let i = 0; i < 5; i++) {
      const pr = testPr();
      seededPrs.push(pr);
      await pool.query(
        `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
         VALUES ($1, 'cp-fixture', 'cecelia', $2, $3, 'active')`,
        [pr, 5340 + i, `cecelia_preview_${pr}`],
      );
    }
    const prs = [testPr(), testPr(), testPr()];
    seededPrs.push(...prs); // 无论是否 admitted 都要清理

    const results = await Promise.all(prs.map((pr) => admitPreview(pr, 'cp-race', 'cecelia', pool, { samplePath })));
    expect(results.filter((r) => r.admitted).length).toBe(1);

    // GAN Round 1 反馈问题2 核心修复：不能只数返回值里 admitted===true 的个数，必须验证
    // preview_environments 表针对这 3 个候选 PR 确实恰好新增了 1 行真实 DB 记录——
    // 抓出"admitPreview 判 true 后调用方再单独调无锁 allocatePreview() 做预留"的 TOCTOU 实现。
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM preview_environments WHERE pr_number = ANY($1::int[])`,
      [prs],
    );
    expect(rows[0].n).toBe(1);

    // 方案A schema 升级：admitted:true 的响应必须携带 port/db_name（不是纯判定 {admitted:true}）
    const admittedResult = results.find((r) => r.admitted === true);
    expect(typeof admittedResult.port).toBe('number');
    expect(typeof admittedResult.db_name).toBe('string');
    expect(admittedResult.db_name.length).toBeGreaterThan(0);
  });

  it('已存在活跃记录的 PR 重推（幂等复用）跳过准入，即使样本过期也放行', async () => {
    const samplePath = mkSampleFile({ sampled_at_epoch: Math.floor(Date.now() / 1000) - 999 });
    const pr = testPr();
    seededPrs.push(pr);
    await pool.query(
      `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
       VALUES ($1, 'cp-existing', 'cecelia', 5390, $2, 'active')`,
      [pr, `cecelia_preview_${pr}`],
    );
    const r = await admitPreview(pr, 'cp-existing', 'cecelia', pool, { samplePath });
    expect(r.admitted).toBe(true);
  });
});
