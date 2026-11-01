import brainConfig, { POSTGRES_INTEGRATION_TESTS } from '../../packages/brain/vitest.config.js';

// 与单测配置共享数据库测试清单，新增集成测试由目录约定自动发现。
export default {
  ...brainConfig,
  test: {
    ...brainConfig.test,
    // 混合文件的原生mock并发断言仍在unit；其真实PG describe由本跑道显式执行。
    include: [...POSTGRES_INTEGRATION_TESTS,
      'src/orchestrator/__tests__/contract-store.test.js',
      'src/__tests__/migration-370-gp-governance-decisions.test.js',
      'src/__tests__/nightly-orchestrator.integration.test.js',
      'src/**/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**'],
  },
};
