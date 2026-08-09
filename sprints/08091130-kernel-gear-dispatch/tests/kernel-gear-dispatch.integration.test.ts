import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// @ts-nocheck
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * TDD RED / 验收 oracle（真 PG）——落地版由 generator 写入
 * packages/brain/src/orchestrator/__tests__/kernel-gear-dispatch.integration.test.js
 * （it 名逐字一致，供 DoD -t 映射；beforeAll bootstrap schema，各 it 自含 fixture）。
 *
 * 禁 mock 被改的边：真 Postgres（$DATABASE_URL 空库）、真 derive、真 attemptStore 写
 * harness_attempts；仅允许录制式 launcher 替身（不真拉 Docker），attempt 行仍真落 PG。
 *
 * 驱动约定（generator 实现的测试驱动器 seam，见 contract-draft.md ## 集成测试驱动约定）：
 *   driveKernelGearRun({ pool, gear, initiativeId }) —— 用真 dispatcher + 录制式 launcher +
 *   真 attemptStore 跑一条 kernel run 到自然终态，返回 { runId }；attempt 行真落 harness_attempts。
 *   非法 gear 时驱动器返回 { runId, failed:true }，且不产生任何 attempt 行。
 *
 * sentinel initiative_id（供 ## E2E 验收 外部 psql 复核，driveKernelGearRun 落 committed 行）：
 *   hotfix  = 00000000-0000-4000-8000-00000000f1c5
 *   default = 00000000-0000-4000-8000-00000000def0
 *   invalid = 00000000-0000-4000-8000-0000000baad0
 */

const HOTFIX_ID = '00000000-0000-4000-8000-00000000f1c5';
const DEFAULT_ID = '00000000-0000-4000-8000-00000000def0';
const INVALID_ID = '00000000-0000-4000-8000-0000000baad0';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pool;
let driveKernelGearRun;

async function roleCount(runId, roles) {
  const inList = roles.map((r) => `'${r}'`).join(',');
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM harness_attempts
      WHERE run_id=$1 AND role IN (${inList})
        AND created_at > NOW() - interval '10 minutes'`,
    [runId],
  );
  return rows[0].n;
}

describe.skipIf(!process.env.DATABASE_URL)('kernel gear 三档分流（真 PG 集成）', () => {
  beforeAll(async () => {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    // 空库 bootstrap：跑仓库真实 migration（幂等，IF NOT EXISTS）
    execFileSync('node', ['src/migrate.js'], {
      cwd: path.resolve(HERE, '../../../packages/brain'),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'inherit',
      timeout: 120_000,
    });
    // generator 提供的驱动器 seam
    ({ driveKernelGearRun } = await import('../kernel-gear-testkit.js'));
  }, 180_000);

  afterAll(async () => {
    await pool?.end?.();
  });

  it('gear 持久化到 initiative_runs gear 列', async () => {
    const { rows: cols } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name='initiative_runs' AND column_name='gear'`,
    );
    expect(cols.length).toBe(1); // 无 gear 列 = RED
    const { runId } = await driveKernelGearRun({ pool, gear: 'hotfix', initiativeId: HOTFIX_ID });
    const { rows } = await pool.query('SELECT gear FROM initiative_runs WHERE id=$1', [runId]);
    expect(rows[0].gear).toBe('hotfix');
  });

  it('hotfix run harness_attempts 无 planner proposer reviewer 且 generator 至少一条', async () => {
    const { runId } = await driveKernelGearRun({ pool, gear: 'hotfix', initiativeId: HOTFIX_ID });
    expect(await roleCount(runId, ['planner', 'proposer', 'reviewer'])).toBe(0);
    expect(await roleCount(runId, ['generator'])).toBeGreaterThanOrEqual(1);
  });

  it('default run harness_attempts 三角色均至少一条', async () => {
    const { runId } = await driveKernelGearRun({ pool, gear: 'default', initiativeId: DEFAULT_ID });
    expect(await roleCount(runId, ['planner'])).toBeGreaterThanOrEqual(1);
    expect(await roleCount(runId, ['proposer'])).toBeGreaterThanOrEqual(1);
    expect(await roleCount(runId, ['reviewer'])).toBeGreaterThanOrEqual(1);
  });

  it('非法 gear kernel 侧 fail-closed reason invalid_gear', async () => {
    const { runId } = await driveKernelGearRun({ pool, gear: 'turbo', initiativeId: INVALID_ID });
    const { rows } = await pool.query(
      'SELECT failure_reason FROM initiative_runs WHERE id=$1', [runId],
    );
    expect(String(rows[0].failure_reason)).toContain('invalid_gear');
    const { rows: att } = await pool.query(
      'SELECT count(*)::int AS n FROM harness_attempts WHERE run_id=$1', [runId],
    );
    expect(att[0].n).toBe(0); // fail-closed：不 spawn 任何相位
  });
});
