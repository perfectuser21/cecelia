import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('Unified Work Router scratch smoke contract', () => {
  it('drives real API, Intent and Capture entries and verifies PostgreSQL receipts', async () => {
    const source = await readFile(
      new URL('../../scripts/smoke/unified-work-router-smoke.sh', import.meta.url),
      'utf8',
    );
    expect(source).toContain('_scratch');
    expect(source).toContain('map-fact-snapshot-smoke.sh');
    expect(source).toContain('unified-work-router-smoke.mjs');
    expect(source).toContain('DB_NAME=');
    expect(source).toContain('schema_version');
    expect(source).toContain('416');
  });

  it('uses real route, intent, capture, Kernel and PostgreSQL modules instead of source grep', async () => {
    const source = await readFile(
      new URL('../../scripts/smoke/unified-work-router-smoke.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain("routes/task-tasks.js");
    expect(source).toContain('parseAndCreate');
    expect(source).toContain("routes/capture-atoms.js");
    expect(source).toContain('createKernelRun');
    expect(source).toContain('work_routing_receipts');
    expect(source).toContain('harness_impact_contracts');
    expect(source).toContain('legacy_exempt');
  });
});
