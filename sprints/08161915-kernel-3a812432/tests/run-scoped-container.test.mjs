import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// TDD Red: run-container.cjs 尚不存在 / capacity.computeRunContainerCapacity 尚未导出。
// 本文件 pin run 级双容器的命名 + 复用 + 隔离粒度决策，禁 mock（真实纯函数）。
const RUN_A = 'e64c335a-63a0-457e-bd58-02b43ed2ad83';
const RUN_B = '11111111-2222-4333-8444-555555555555';
const ATT_1 = '41457bc7-a28e-48a9-aa1d-eb052a151ee3';
const ATT_2 = 'aaaaaaaa-0000-4000-8000-000000000001';

function loadRunContainer() {
  return require('../../../packages/brain/scripts/fleet-worker/run-container.cjs');
}

describe('Fleet run-scoped work container [BEHAVIOR]', () => {
  it('derives run-scoped work container name from run id (cecelia-fleet-run-<run8>)', () => {
    const m = loadRunContainer();
    const t = m.resolveContainerTarget({ role: 'planner', runId: RUN_A, attemptId: ATT_1 });
    expect(t.name).toBe('cecelia-fleet-run-e64c335a');
    expect(t.scope).toBe('run');
    expect(t.reuse).toBe(true);
    expect(t.clean).toBe(false);
    expect(t.memMb).toBe(2048);
    expect(t.cpus).toBe(2);
  });

  it('same run reuses the same work container across proposer/reviewer/generator', () => {
    const m = loadRunContainer();
    const roles = ['proposer', 'reviewer', 'generator'];
    const names = roles.map((role, i) =>
      m.resolveContainerTarget({ role, runId: RUN_A, attemptId: `${ATT_2.slice(0, -1)}${i}` }).name,
    );
    expect(new Set(names).size).toBe(1);
    expect(names[0]).toBe('cecelia-fleet-run-e64c335a');
  });

  it('different run gets a different work container (isolation granularity = run)', () => {
    const m = loadRunContainer();
    const a = m.resolveContainerTarget({ role: 'generator', runId: RUN_A, attemptId: ATT_1 });
    const b = m.resolveContainerTarget({ role: 'generator', runId: RUN_B, attemptId: ATT_2 });
    expect(a.name).not.toBe(b.name);
    expect(b.name).toBe('cecelia-fleet-run-11111111');
  });

  it('rejects invalid run id (non-uuid) instead of returning a half-formed name', () => {
    const m = loadRunContainer();
    expect(() => m.resolveContainerTarget({ role: 'planner', runId: 'not-a-uuid', attemptId: ATT_1 })).toThrow();
  });
});

describe('Fleet per-run capacity [BEHAVIOR]', () => {
  it('computes at least 2 concurrent run containers for a 5GB / 8-core VM (2GB per run)', () => {
    const c = require('../../../packages/brain/src/capacity.js');
    const n = c.computeRunContainerCapacity({ totalMemMb: 5120, cpuCount: 8 });
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('is memory-bounded by the 2GB per-run budget (tiny VM floors to 1, not 0)', () => {
    const c = require('../../../packages/brain/src/capacity.js');
    expect(c.computeRunContainerCapacity({ totalMemMb: 2048, cpuCount: 8 })).toBeGreaterThanOrEqual(1);
    expect(c.computeRunContainerCapacity({ totalMemMb: 20480, cpuCount: 8 })).toBeGreaterThan(
      c.computeRunContainerCapacity({ totalMemMb: 5120, cpuCount: 8 }),
    );
  });
});
