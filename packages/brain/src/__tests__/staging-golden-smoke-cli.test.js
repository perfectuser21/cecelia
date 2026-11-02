import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
const { runGoldenSmokeRegression } = await import('../staging-e2e-runner.js');

describe('staging回归扫描的真实Vitest入口', () => {
  it('从仓库根实际执行迁移后的relay HTTP回归，不能因配置过滤而空跑', () => {
    const result = runGoldenSmokeRegression({ cwd: fileURLToPath(new URL('../../../../', import.meta.url)) });
    expect(result).toEqual({
      verdict: 'PASS', total: 4, passed: 4, failed: 0, skipped: 0,
      files: ['packages/brain/src/__tests__/regression/relay-runs-endpoint.golden-smoke.test.ts'],
    });
  }, 20000);
});
