// Contract: system_registry API 接口存在性验证
// 实际单元测试见 packages/brain/src/__tests__/registry.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_ROOT = resolve(__dirname, '../../../../packages/brain');

describe('system_registry contract', () => {
  it('migration 文件存在', () => {
    expect(() => accessSync(resolve(BRAIN_ROOT, 'migrations/197_system_registry.sql'))).not.toThrow();
  });

  it('registry 路由文件存在', () => {
    expect(() => accessSync(resolve(BRAIN_ROOT, 'src/routes/registry.js'))).not.toThrow();
  });

  it('server.js 已挂载 /api/brain/registry', () => {
    const content = readFileSync(resolve(BRAIN_ROOT, 'server.js'), 'utf8');
    expect(content).toContain('/api/brain/registry');
  });
});
