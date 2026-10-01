import { defineConfig } from 'vitest/config';
import brainConfig from './vitest.config.js';

// 真实写入正例只归已验证身份的专属测试容器 job；普通 unit/PG job 保持安全默认。
export default defineConfig({
  ...brainConfig,
  test: {
    ...brainConfig.test,
    include: ['src/__tests__/real-env/map-manifest-smoke.real-env.test.js'],
    exclude: brainConfig.test.exclude.filter(path => path !== 'src/__tests__/real-env/**'),
  },
});
