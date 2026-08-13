import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const smokeSource = readFileSync(
  new URL('../../scripts/smoke/unified-work-router-smoke.mjs', import.meta.url),
  'utf8',
);

describe('Unified Work Router scratch smoke contract', () => {
  it('保留 scratch、Map 刷新和三个真实入口合同', () => {
    const shellSource = readFileSync(
      new URL('../../scripts/smoke/unified-work-router-smoke.sh', import.meta.url),
      'utf8',
    );
    expect(shellSource).toContain('_scratch');
    expect(shellSource).toContain('map-fact-snapshot-smoke.sh');
    expect(shellSource).toContain('unified-work-router-smoke.mjs');
    expect(shellSource).toContain('DB_NAME=');
    expect(shellSource).toContain('schema_version');
    expect(smokeSource).toContain('routes/task-tasks.js');
    expect(smokeSource).toContain('parseAndCreate');
    expect(smokeSource).toContain('routes/capture-atoms.js');
    expect(smokeSource).toContain('work_routing_receipts');
    expect(smokeSource).toContain('harness_impact_contracts');
    expect(smokeSource).toContain('legacy_exempt');
  });

  it('必须经过真实 Dispatcher、Attempt Store 与 Runner 动作闸门', () => {
    expect(smokeSource).toContain('createAttemptStore');
    expect(smokeSource).toContain('createDispatcher');
    expect(smokeSource).toContain('createDetachedLauncher');
    expect(smokeSource).toContain('dispatchSmokeKernelAttempt');
    expect(smokeSource).toContain('harness_attempts');
    expect(smokeSource).toContain('install_routing_action_gate');
  });

  it('把 BASELINE_SHA 当实现基线校验，而不是伪装成当前 Map revision', () => {
    expect(smokeSource).toContain('process.env.BASELINE_SHA');
    expect(smokeSource).toContain('merge-base');
    expect(smokeSource).toContain('sourceRevision');
  });
});
