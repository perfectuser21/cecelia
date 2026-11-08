import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CFG_PATH = resolve(__dirname, '../../packages/brain/vitest.config.js');

// 保留既有无 global thresholds 配置合同；手动 test:coverage 仍使用此配置。
// 此断言不代表 diff-cover 或任何其他覆盖率任务当前在 CI 中执行。
describe('packages/brain/vitest.config.js', () => {
  it('preserves the existing no-global-threshold coverage configuration', () => {
    const content = readFileSync(CFG_PATH, 'utf8');
    expect(content).not.toMatch(/thresholds:\s*\{/);
  });

  it('still defines coverage block with v8 provider', () => {
    const content = readFileSync(CFG_PATH, 'utf8');
    expect(content).toMatch(/coverage:\s*\{/);
    expect(content).toMatch(/provider:\s*'v8'/);
  });
});
