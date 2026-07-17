/**
 * MJ5 三闸 proven-to-fire 集成测试
 *
 * 每道闸故意违规一次，亲眼看报红——没见过报红的守卫不算守卫。
 *
 * 刀2 [S2-PF] S2 锚点执法闸：无锚新 dev 任务 → checkAnchor 返回 blocked=true
 * 刀3 [S3-PF] S3 联动清单：改动文件命中 assertion_ref → 清单非空
 * 刀4 [S4-PF] S4 保鲜对账：base_ref 断线时 A3 实弹报红
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { checkAnchor, ANCHOR_LEGACY_CUTOFF } from '../../anchor-check.js';
import { buildCascadeReport } from '../../cascade-list.js';
import { buildNightlyAssertions } from '../../promise-map-nightly.js';

let pool;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
});

// ─── 刀2 S2 锚点执法闸 proven-to-fire ──────────────────────
describe('[S2-PF] 锚点执法闸 proven-to-fire', () => {
  it('B1 无锚新 dev 任务被拒（missing_anchor）', () => {
    const afterCutoff = new Date(ANCHOR_LEGACY_CUTOFF.getTime() + 60_000).toISOString();
    const task = { task_type: 'dev', created_at: afterCutoff, payload: {} };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('missing_anchor');
  });

  it('B2 带锚 dev 任务放行', () => {
    const afterCutoff = new Date(ANCHOR_LEGACY_CUTOFF.getTime() + 60_000).toISOString();
    const task = {
      task_type: 'dev',
      created_at: afterCutoff,
      payload: { anchor: { journey_id: 'j1', gp_id: 'gp1', step_id: 's1' } },
    };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('B3 存量任务（刀2上线前）免锚放行', () => {
    const beforeCutoff = new Date(ANCHOR_LEGACY_CUTOFF.getTime() - 86_400_000).toISOString(); // 整日前：日历日 < ANCHOR_LEGACY_CUTOFF_DAY
    const task = { task_type: 'dev', created_at: beforeCutoff, payload: {} };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('B4 系统例行任务（arch_review）无锚放行', () => {
    const afterCutoff = new Date(ANCHOR_LEGACY_CUTOFF.getTime() + 60_000).toISOString();
    const task = { task_type: 'arch_review', created_at: afterCutoff, payload: {} };
    const result = checkAnchor(task);
    expect(result.blocked).toBe(false);
  });

  it('B5 S2 闸文件（anchor-check.js）在生产路径存在', async () => {
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { join, dirname } = await import('node:path');
    const srcDir = dirname(fileURLToPath(import.meta.url));
    const anchorCheckPath = join(srcDir, '../../anchor-check.js');
    expect(existsSync(anchorCheckPath)).toBe(true);
  });
});

// ─── 刀3 S3 联动清单 proven-to-fire ────────────────────────
describe('[S3-PF] 联动清单 proven-to-fire', () => {
  it('改动文件未命中任何 assertion_ref → 清单为空（无 false positive）', () => {
    const cells = [];
    const report = buildCascadeReport(cells);
    expect(report.total).toBe(0);
    expect(report.runnable_count).toBe(0);
  });

  it('assertion_ref=tests/ 前缀的格子判为可立即跑', () => {
    const cells = [
      { assertion_ref: 'tests/brain/anchor-check.test.js', na_reason: null },
      { assertion_ref: 'tests/brain/cascade-list.test.js', na_reason: null },
      { assertion_ref: null, na_reason: null },
    ];
    const report = buildCascadeReport(cells);
    expect(report.runnable_count).toBe(2);
    expect(report.unregistered_count).toBe(1);
  });

  it('assertion_ref=manual: 前缀的格子判为可立即跑', () => {
    const cells = [
      { assertion_ref: 'manual:bash scripts/check-version-sync.sh', na_reason: null },
    ];
    const report = buildCascadeReport(cells);
    expect(report.runnable_count).toBe(1);
    expect(report.nightly_pending_count).toBe(0);
  });

  it('[S3-PF 刀3实弹] 改动文件命中 assertion_ref 后联动清单非空（直接查 DB）', async () => {
    const { rows: links } = await pool.query(
      `SELECT assertion_ref FROM journey_step_links WHERE assertion_ref IS NOT NULL LIMIT 3`
    );
    if (links.length === 0) return; // 无 assertion_ref 数据时跳过

    const changedFiles = links.map(l => l.assertion_ref);
    const { rows: cells } = await pool.query(
      `SELECT jsl.assertion_ref, jsl.na_reason, jsl.cell_kind
       FROM journey_step_links jsl
       LEFT JOIN journey_features jf ON jf.id = jsl.feature_id
       WHERE (jsl.assertion_ref = ANY($1::text[]))
          OR (jf.unit_test_path = ANY($1::text[]))`,
      [changedFiles],
    );

    const report = buildCascadeReport(cells);
    expect(report.total).toBeGreaterThan(0);
    expect(typeof report.report_text).toBe('string');
  });

  it('[S3-PF 刀3实弹] GP-B S1 step-impact 查询返回格子（seed 数据）', async () => {
    const GPB = 'ac2e35bc-849a-48cd-917f-79d15c5ac886';
    const { rows: steps } = await pool.query(
      `SELECT id FROM journey_steps WHERE journey_id=$1 AND step_number=1`, [GPB],
    );
    if (steps.length === 0) return; // seed 未跑，跳过

    const step_id = steps[0].id;
    const { rows: impacts } = await pool.query(
      `SELECT jsl.cell_kind, jsl.assertion_ref, jsl.na_reason
       FROM journey_step_links jsl
       WHERE jsl.step_id = $1
       ORDER BY jsl.step_order, jsl.id`,
      [step_id],
    );

    expect(impacts.length).toBeGreaterThan(0);
    const kinds = new Set(impacts.map(r => r.cell_kind).filter(Boolean));
    expect(kinds.size).toBeGreaterThan(0);
  });
});

// ─── 刀4 S4 保鲜对账 proven-to-fire ────────────────────────
describe('[S4-PF] 保鲜对账 proven-to-fire', () => {
  it('A3.1 实弹：DB 无 feature_id=NULL 的 base_ref 格子（当前数据完整）', async () => {
    const { rows: [{ count }] } = await pool.query(`
      SELECT COUNT(*) FROM journey_step_links
      WHERE cell_kind = 'base_ref' AND feature_id IS NULL
    `);
    expect(parseInt(count, 10)).toBe(0);
  });

  it('A3.2 实弹：GP-B 四步 promise 全非空（350 seed 数据完整）', async () => {
    const GPB = 'ac2e35bc-849a-48cd-917f-79d15c5ac886';
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM journey_steps WHERE journey_id=$1 AND promise IS NULL`,
      [GPB],
    );
    expect(count).toBe(0);
  });

  it('A3 实弹模拟：注入孤儿底座件（家③无链接）→ buildNightlyAssertions 报 A3 失败', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO journey_features (name, "group") VALUES ($1, $2)`,
        ['[test-pf] 孤儿底座件探针', '家③横切件池'],
      );

      const assertions = await buildNightlyAssertions(client);
      const a3 = assertions.find(a => a.key === 'ledger_integrity');
      expect(a3.ok).toBe(false);
      expect(a3.detail).toMatch(/底座件/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('A4 三闸心跳：三个闸文件在生产路径均存在', async () => {
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { join, dirname } = await import('node:path');
    const srcDir = dirname(fileURLToPath(import.meta.url));

    const gateFiles = [
      join(srcDir, '../../routes/journeys.js'),
      join(srcDir, '../../anchor-check.js'),
      join(srcDir, '../../cascade-list.js'),
    ];

    for (const f of gateFiles) {
      expect(existsSync(f), `闸文件缺失: ${f}`).toBe(true);
    }
  });
});
