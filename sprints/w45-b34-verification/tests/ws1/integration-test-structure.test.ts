import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGET = resolve(
  __dirname,
  '../../../../packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js'
);

describe('WS1 — 集成测试文件结构验证 [BEHAVIOR]', () => {
  it('集成测试文件存在', () => {
    expect(existsSync(TARGET)).toBe(true);
  });

  it('不 mock node:fs/promises（真实 fs 集成测试）', () => {
    const content = readFileSync(TARGET, 'utf8');
    expect(content).not.toContain("vi.mock('node:fs/promises')");
    expect(content).not.toContain('vi.mock("node:fs/promises")');
  });

  it('包含 parsePrdNode 和 defaultReadContractFile 两个 import', () => {
    const content = readFileSync(TARGET, 'utf8');
    expect(content).toContain('parsePrdNode');
    expect(content).toContain('defaultReadContractFile');
  });

  it('包含 os.tmpdir() 真实 tmp 目录构造', () => {
    const content = readFileSync(TARGET, 'utf8');
    expect(content).toContain('tmpdir');
  });
});
