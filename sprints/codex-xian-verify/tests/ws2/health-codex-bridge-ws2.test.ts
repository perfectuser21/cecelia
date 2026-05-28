/**
 * WS2 Red Test — health-codex-bridge-status 集成测试文件
 *
 * 在 WS2 实现前这些测试全部 FAIL（expect() 断言失败，不是 throw）：
 *   - 测试文件尚未创建 → existsSync 返回 false → expect(false).toBe(true) AssertionError
 *   - online/offline 分支覆盖缺失 → content 为空字符串 → expect('').toContain(...) AssertionError
 *
 * WS2 完成后（generator 在 packages/brain/src/__tests__/integration/ 创建真实测试文件），
 * 所有断言应 PASS。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const TEST_FILE = resolve(
  './packages/brain/src/__tests__/integration/health-codex-bridge-status.integration.test.js'
);

describe('[WS2 Red] health-codex-bridge-status 集成测试文件', () => {
  it('测试文件存在于 packages/brain/src/__tests__/integration/', () => {
    // FAIL before WS2: expected false to be true
    expect(existsSync(TEST_FILE)).toBe(true);
  });

  it('测试文件包含 online 分支测试', () => {
    // FAIL before WS2: expected '' to contain '"online"'
    const content = existsSync(TEST_FILE) ? readFileSync(TEST_FILE, 'utf8') : '';
    expect(content).toContain('"online"');
  });

  it('测试文件包含 offline 分支测试', () => {
    // FAIL before WS2: expected '' to contain '"offline"'
    const content = existsSync(TEST_FILE) ? readFileSync(TEST_FILE, 'utf8') : '';
    expect(content).toContain('"offline"');
  });
});
