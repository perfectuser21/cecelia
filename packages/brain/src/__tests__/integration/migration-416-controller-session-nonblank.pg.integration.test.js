/**
 * [BEHAVIOR] migration 416 真 PostgreSQL upgrade/rollback/re-upgrade/幂等。
 * 禁止以 SQL 文本 grep 代替 schema_version、CHECK 与真实写入后验。
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../migrate.js';
import { writeHeartbeat } from '../../orchestrator/heartbeat.js';
import { reconcileOwnerlessKernelRuns } from '../../orchestrator/kernel-controller-lifecycle.js';
import { createKernelLeasePgFixture } from './kernel-controller-lease-renewal.pg-fixture.js';
const fixture = createKernelLeasePgFixture();
const rollbackSql = readFileSync(
  new URL('../../../migrations/rollback/416_controller_session_nonblank.down.sql', import.meta.url),
  'utf8',
);
let testPool;
async function constraintOracle() {
  const { rows } = await testPool.query(
    `SELECT (
              SELECT c.convalidated
                FROM pg_constraint c
               WHERE c.conrelid = 'initiative_runs'::regclass
                 AND c.conname = 'initiative_runs_controller_session_nonblank_check'
            ) AS constraint_validated,
            (SELECT count(*)::int FROM schema_version WHERE version = '416') AS version_count`,
  );
  return rows;
}
beforeAll(async () => {
  await fixture.createIsolatedDatabase();
  testPool = fixture.pool();
}, 60_000);
afterAll(() => fixture.dropIsolatedDatabase(), 30_000);
describe('migration 416 controller session nonblank（真 PG）', () => {
  it('CREATE-SESSION-C: JS 创建边拒绝 TAB/NBSP/ideographic space ownership', async () => {
    for (const blankSession of ['\t', '\u00a0', '\u3000']) {
      await expect(fixture.seedOwnedRun({ controllerSessionId: blankSession }))
        .rejects.toThrow('missing controller ownership (fail-closed)');
    }
  });
  it('MIGRATION-C: upgrade/第二次 upgrade/rollback/re-upgrade/第二次 re-upgrade 保持 invariant', async () => {
    await testPool.query(rollbackSql);
    const historical = [
      await fixture.seedHistoricalBlankRun(''),
      await fixture.seedHistoricalBlankRun('   '),
      await fixture.seedHistoricalBlankRun('\t'),
      await fixture.seedHistoricalBlankRun('\u00a0'),
      await fixture.seedHistoricalBlankRun('\u3000'),
    ];
    const upgrade = await runMigrations(testPool);
    const secondUpgrade = await runMigrations(testPool);
    expect(upgrade).toContain('416');
    expect(secondUpgrade).toEqual([]);
    expect(await constraintOracle()).toEqual([{ constraint_validated: true, version_count: 1 }]);
    const { rows: normalized } = await testPool.query(
      `SELECT controller_session_id
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [historical.map(({ runId }) => runId)],
    );
    expect(normalized).toHaveLength(5);
    expect(normalized.every(({ controller_session_id: session }) => session === null)).toBe(true);
    await testPool.query(rollbackSql);
    expect(await constraintOracle()).toEqual([{ constraint_validated: null, version_count: 0 }]);
    const reUpgrade = await runMigrations(testPool);
    const secondReUpgrade = await runMigrations(testPool);
    expect(reUpgrade).toContain('416');
    expect(secondReUpgrade).toEqual([]);
    expect(await constraintOracle()).toEqual([{ constraint_validated: true, version_count: 1 }]);
  });
  it('NEW-WRITE-C: 数据库权威边拒绝新写入空串或纯空白 ownership', async () => {
    const errors = [];
    for (const blankSession of ['', '   ', '\t', '\u00a0', '\u3000']) {
      const initiativeId = randomUUID();
      const taskId = randomUUID();
      await testPool.query(
        `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
         VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
        [taskId, `kernel-blank-write-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
      );
      try {
        await testPool.query(
          `INSERT INTO initiative_runs (
             initiative_id, current_task_id, phase, orchestrator_version, created_source,
             deadline_at, controller_session_id, controller_lease_expires_at
           ) VALUES (
             $1, $2, 'planning', 'v2', 'historical_reconstruction',
             NOW() + INTERVAL '8 hours', $3, NOW() + INTERVAL '1 hour'
           )`,
          [initiativeId, taskId, blankSession],
        );
        errors.push(null);
        await testPool.query('DELETE FROM initiative_runs WHERE current_task_id = $1', [taskId]);
      } catch (error) {
        errors.push(error.code);
      }
    }
    expect(errors).toEqual(['23514', '23514', '23514', '23514', '23514']);
  });
  it('BLANK-C: rollout 空白行不能 heartbeat 续命且未过期 lease 也被 reconcile 收敛', async () => {
    await testPool.query(rollbackSql);
    const historical = [
      { session: '', ...(await fixture.seedHistoricalBlankRun('')) },
      { session: '   ', ...(await fixture.seedHistoricalBlankRun('   ')) },
      { session: '\t', ...(await fixture.seedHistoricalBlankRun('\t')) },
      { session: '\u00a0', ...(await fixture.seedHistoricalBlankRun('\u00a0')) },
      { session: '\u3000', ...(await fixture.seedHistoricalBlankRun('\u3000')) },
    ];
    const heartbeatRows = [];
    for (const row of historical) {
      const heartbeat = await writeHeartbeat(testPool, {
        runId: row.runId,
        host: 'kernel-blank-owner',
        pid: 4242,
        now: new Date(),
        controllerSessionId: row.session,
      });
      heartbeatRows.push(heartbeat.rowCount);
    }
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date() });
    const recoveredIds = recovered.map(({ runId }) => runId);
    const { rows } = await testPool.query(
      `SELECT id, phase, orchestrator_heartbeat_at
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [historical.map(({ runId }) => runId)],
    );
    expect(heartbeatRows).toEqual([0, 0, 0, 0, 0]);
    expect(historical.every(({ runId }) => recoveredIds.includes(runId))).toBe(true);
    expect(rows.every(({ phase }) => phase === 'failed')).toBe(true);
    expect(rows.every(({ orchestrator_heartbeat_at: at }) => at === null)).toBe(true);
  });
});
