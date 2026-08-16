// TDD RED — Fleet Runner run 级双容器：以下断言在实现前必须全红。
// 权威回归测试由 generator 落入 packages/brain 源测试文件（attempt-runner.test.cjs /
// workspace-manager.test.cjs / node-profile.test.js / attempt-machine-capacity.test.js），
// 见 contract-dod.md 的 BEHAVIOR。本文件仅证明新行为面当前缺失（红），非 evaluator oracle。
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NP = '/workspace/packages/brain/src/orchestrator/fleet-node/node-profile.js';
const AR = '/workspace/packages/brain/scripts/fleet-worker/attempt-runner.cjs';

const FIVE_GB = 5 * 1024 * 1024 * 1024;
const RUN8 = '11111111';
const ATTEMPT8 = '22222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

describe('RED: 容量按并发 run 容器计（node-profile.maxConcurrentRunContainers）', () => {
  it('5GB VM / 每 run 2GB → ≥2 个并发 run 容器', async () => {
    const mod = await import(NP);
    expect(typeof mod.maxConcurrentRunContainers).toBe('function');
    const n = mod.maxConcurrentRunContainers({ memoryBytes: FIVE_GB, cpuCores: 8 });
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe('RED: run/eval 双容器命名（attempt-runner.resolveContainerNames）', () => {
  const mod = require(AR);
  it('run-scoped 工作容器名 = cecelia-fleet-run-<run8>', () => {
    expect(typeof mod.resolveContainerNames).toBe('function');
    const r = mod.resolveContainerNames({ runId: RUN_ID, attemptId: ATTEMPT_ID, role: 'generator', runScoped: true });
    expect(r.workContainerName).toBe(`cecelia-fleet-run-${RUN8}`);
  });
  it('evaluator 评估容器名 = cecelia-fleet-eval-<attempt8>', () => {
    const r = mod.resolveContainerNames({ runId: RUN_ID, attemptId: ATTEMPT_ID, role: 'evaluator', runScoped: true });
    expect(r.evalContainerName).toBe(`cecelia-fleet-eval-${ATTEMPT8}`);
  });
  it('flag off → legacy 单 attempt 命名 cecelia-fleet-<attemptId>', () => {
    const r = mod.resolveContainerNames({ runId: RUN_ID, attemptId: ATTEMPT_ID, role: 'generator', runScoped: false });
    expect(r.containerName).toBe(`cecelia-fleet-${ATTEMPT_ID}`);
  });
});
