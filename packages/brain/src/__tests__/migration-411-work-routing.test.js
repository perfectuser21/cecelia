import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('migration 411', () => {
  it('creates immutable routing receipts and recovery contracts', async () => {
    const sql = await readFile(new URL('../../migrations/411_work_routing_receipts.sql', import.meta.url), 'utf8');
    expect(sql).toContain('work_routing_receipts');
    expect(sql).toContain('map_recovery_contracts');
    expect(sql).toContain('TRIGGER');
  });
});
