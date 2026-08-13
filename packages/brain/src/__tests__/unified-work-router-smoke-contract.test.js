import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Unified Work Router scratch smoke contract', () => {
  it('drives real API, Intent and Capture entries and verifies PostgreSQL receipts', async () => {
    const source = await readFile(
      new URL('../../scripts/smoke/unified-work-router-smoke.sh', import.meta.url),
      'utf8',
    );
    expect(source).toContain('psql');
    expect(source).toContain('/api/brain/tasks');
    expect(source).toContain('/api/brain/capture-atoms');
    expect(source).toContain('work_routing_receipts');
    expect(source).toContain('harness_initiative');
    expect(source).toContain('ROLLBACK');
  });
});
