import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('projection loop production wiring', () => {
  it('server starts the independent projection loop beside the serial scheduler', () => {
    const server = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(server).toContain('startProjectionJobsLoop');
    expect(server).toMatch(/startSchedulerJobsLoop\(pool\);\s*startProjectionJobsLoop\(pool\);/);
  });
});
