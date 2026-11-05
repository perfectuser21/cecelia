import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Coverage Configuration', () => {
  // 手动 test:coverage 仍消费这里保护的收集范围。
  // 无 global thresholds 的既有配置合同由 tests/brain/vitest-config-no-threshold.test.ts
  // 单源保护；本文件不再重复该断言，也不声明另一个 CI coverage 门。

  it('should include all source files in coverage', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that all: true is set to include all source files
    expect(configContent).toContain('all: true');
  });

  it('should exclude test files from coverage', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check exclusions
    expect(configContent).toContain('src/**/*.test.js');
    expect(configContent).toContain('src/__tests__/**');
  });
});