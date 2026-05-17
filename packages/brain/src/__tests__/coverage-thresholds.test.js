import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Coverage Configuration', () => {
  // 注意：vitest 全局 thresholds（statements/branches/functions/lines/perFile）
  // 已在 cp-0425113824 中删除，门禁交给 CI brain-diff-coverage 的
  // diff-cover --fail-under=80（PR 增量覆盖率）。
  // 因此本文件不再断言 thresholds / perFile 字段存在。

  it('must NOT contain global coverage thresholds (diff-cover is the sole gate)', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    expect(configContent).not.toMatch(/thresholds:\s*\{/);
  });

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