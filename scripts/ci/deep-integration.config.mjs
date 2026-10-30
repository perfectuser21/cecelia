import brainConfig, { POSTGRES_INTEGRATION_TESTS } from '../../packages/brain/vitest.config.js';

// 与单测配置共享数据库测试清单，新增集成测试由目录约定自动发现。
export default {
  ...brainConfig,
  test: {
    ...brainConfig.test,
    include: [...POSTGRES_INTEGRATION_TESTS, 'src/**/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**'],
  },
};
