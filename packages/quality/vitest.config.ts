import { defineConfig } from 'vitest/config';
import {skillSourceExcludes} from '../../scripts/ci/skill-source-tests.mjs';

export default defineConfig({
  test: {
    // 在线 Brain/Workspace CRUD 与独立 workflows 脚本需专用环境。
    // 精确排除现存测试，避免新增本地回归被目录级规则静默排除。
    exclude: [
      ...skillSourceExcludes('quality'),
      'tests/api/cross-package-integration.test.ts',
      'tests/ci-poll-sh-regression.test.ts',
      '**/node_modules/**',
      'e2e/**',
    ],
  },
});
