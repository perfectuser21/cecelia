import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('production routing authority migrations 413/414/416', () => {
  it('keeps the production 413 receipt anchor one-version/one-meaning', async () => {
    const sql = await readFile(new URL('../../migrations/413_work_routing_receipts.sql', import.meta.url), 'utf8');
    expect(sql).toContain('work_routing_receipts');
    expect(sql).toContain('TRIGGER');
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS map_recovery_contracts');
  });

  it('keeps the production 414 recovery-contract anchor separate', async () => {
    const sql = await readFile(new URL('../../migrations/414_map_recovery_contracts.sql', import.meta.url), 'utf8');
    expect(sql).toContain('map_recovery_contracts');
    expect(sql).toContain("VALUES ('414'");
  });

  it('hardens both production anchors only in migration 416', async () => {
    const sql = await readFile(new URL('../../migrations/416_work_routing_anchor_hardening.sql', import.meta.url), 'utf8');
    expect(sql).toContain('idx_work_routing_receipts_task_created');
    expect(sql).toContain('map_recovery_contracts_attempt_id_fkey');
    expect(sql).toContain('map_recovery_contracts_immutable');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS work_routing_receipts_task_id_key');
    expect(sql).toContain("VALUES ('416'");
  });

  it('hardens the mutable task projection after receipt creation', async () => {
    const sql = await readFile(new URL('../../migrations/420_work_routing_projection_guard.sql', import.meta.url), 'utf8');
    expect(sql).toContain('work_routing_task_projection_immutable');
    expect(sql).toContain("NEW.payload->>'routing_receipt_id'");
    expect(sql).toContain("NEW.payload->>'harness_runtime'");
    expect(sql).toContain('BEFORE UPDATE OF task_type, payload ON tasks');
  });
});
