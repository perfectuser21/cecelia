// Contract: system_registry API 接口存在性验证
// 实际单元测试见 packages/brain/src/__tests__/registry.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'fs';

describe('system_registry contract', () => {
  it('migration 文件存在', () => {
    expect(() => accessSync('packages/brain/migrations/197_system_registry.sql')).not.toThrow();
  });

  it('registry 路由文件存在', () => {
    expect(() => accessSync('packages/brain/src/routes/registry.js')).not.toThrow();
  });

  it('server.js 已挂载 /api/brain/registry', () => {
    const content = readFileSync('packages/brain/server.js', 'utf8');
    expect(content).toContain('/api/brain/registry');
  });

  it('selfcheck.js EXPECTED_SCHEMA_VERSION 为 197', () => {
    const content = readFileSync('packages/brain/src/selfcheck.js', 'utf8');
    expect(content).toContain("'197'");
  });
});
