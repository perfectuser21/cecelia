/**
 * WS2 Red Test — Brain 单元测试（mock pool）
 * 验证 packages/brain/src/__tests__/harness-ws-progress.test.js 存在且覆盖关键路径
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'fs';

describe('Brain 单测文件结构 [BEHAVIOR]', () => {
  const TEST_FILE = 'packages/brain/src/__tests__/harness-ws-progress.test.js';

  it('单测文件存在', () => {
    expect(() => accessSync(TEST_FILE)).not.toThrow();
  });

  it('含 describe + it 块', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    expect(src).toContain('describe(');
    expect(src).toContain('it(');
  });

  it('mock pool 返回含 initiative_id + workstreams 字段（schema 完整性）', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    expect(src).toContain('initiative_id');
    expect(src).toContain('workstreams');
  });

  it('含 empty workstreams 边界测试', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    // 必须有空数组场景
    expect(src).toMatch(/workstreams.*\[\]|\[\].*workstreams/s);
  });

  it('含 404 not found 错误路径测试', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    expect(src).toContain('404');
    expect(src).toContain('initiative not found');
  });

  it('不含禁用字段名在 mock 响应 body 中', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    // 禁用字段不应出现在预期 body 的字段 key 里
    expect(src).not.toMatch(/"steps"\s*:/);
    expect(src).not.toMatch(/"phases"\s*:/);
    expect(src).not.toMatch(/"ws_list"\s*:/);
  });

  it('含 fix_round 字段验证（number 类型）', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    expect(src).toContain('fix_round');
  });
});
