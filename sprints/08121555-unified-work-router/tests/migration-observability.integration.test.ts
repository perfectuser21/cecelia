import { describe, it, expect } from 'vitest';

describe('Knife 5 迁移与可观测性 [BEHAVIOR]', () => {
  it('dry-run 不写库且 apply 保留 task id/payload并追加后继 receipt', async () => {
    const migration = await import('../../../packages/brain/src/work-routing-legacy-migration.js');
    const dbUrl = process.env.DB_URL;
    expect(dbUrl).toBeTruthy();
    const result = await migration.runLegacyRoutingMigration({ dbUrl, dryRun: true });
    expect(result.before_checksum).toBe(result.after_checksum);
    expect(result).toMatchObject({ writes: 0 });
    const applied = await migration.runLegacyRoutingMigration({ dbUrl, dryRun: false });
    expect(applied.task_ids_preserved).toBe(true);
    expect(applied.payloads_preserved).toBe(true);
    expect(applied.successor_receipts_created).toBeGreaterThan(0);
  });

  it('running attempt 只写 legacy_execution_audit 且事件指标可查询', async () => {
    const migration = await import('../../../packages/brain/src/work-routing-legacy-migration.js');
    const observed = await migration.verifyRunningAndObservability({ dbUrl: process.env.DB_URL });
    expect(observed.running_attempt_mutations).toBe(0);
    expect(observed.legacy_execution_audits).toBeGreaterThan(0);
    expect(observed.events).toEqual(expect.arrayContaining(['work_routed', 'work_route_blocked', 'route_violation', 'legacy_task_rerouted', 'map_preflight_failed', 'impact_contract_created']));
    expect(observed.metrics).toMatchObject({ coding_receipt_coverage: 1, coding_dev_direct_dispatch: 0, new_legacy_exempt: 0 });
  });
});
