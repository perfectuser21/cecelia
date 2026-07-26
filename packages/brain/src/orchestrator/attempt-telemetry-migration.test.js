import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('kernel attempt telemetry production migration', () => {
  it('用独立 362 版本重放 telemetry DDL，不能与生产既有 361 冲突', () => {
    const sql = readFileSync(
      new URL('../../migrations/362_kernel_attempt_telemetry_reconcile.sql', import.meta.url),
      'utf8',
    );

    for (const column of [
      'logical_cycle_id',
      'attempt_kind',
      'retry_of_attempt_id',
      'restart_reason',
      'workstream_key',
      'time_derived',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toMatch(/VALUES\s*\(\s*'362'/);
    expect(sql).not.toMatch(/VALUES\s*\(\s*'361'/);
  });
});
