import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('migration 413', () => {
  it('creates immutable routing receipts and recovery contracts', async () => {
    const sql = await readFile(new URL('../../migrations/413_work_routing_receipts.sql', import.meta.url), 'utf8');
    expect(sql).toContain('work_routing_receipts');
    expect(sql).toContain('map_recovery_contracts');
    expect(sql).toContain('TRIGGER');
  });

  it('has a complete rollback for every migration 413 object', async () => {
    const sql = await readFile(new URL('../../migrations/rollback/413_work_routing_receipts.down.sql', import.meta.url), 'utf8');
    expect(sql).toContain('DROP TABLE IF EXISTS map_recovery_contracts');
    expect(sql).toContain('DROP TABLE IF EXISTS work_routing_receipts');
    expect(sql).toContain("DELETE FROM schema_version WHERE version = '413'");
  });

  it('hardens the mutable task projection after receipt creation', async () => {
    const sql = await readFile(new URL('../../migrations/417_work_routing_projection_guard.sql', import.meta.url), 'utf8');
    expect(sql).toContain('work_routing_task_projection_immutable');
    expect(sql).toContain("NEW.payload->>'routing_receipt_id'");
    expect(sql).toContain("NEW.payload->>'harness_runtime'");
    expect(sql).toContain('BEFORE UPDATE OF task_type, payload ON tasks');
  });
});
