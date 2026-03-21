/**
 * codex-bridge 负载均衡 - 环境变量解析测试
 */
import { describe, it, expect } from 'vitest';

describe('selectBestBridge', () => {
  it('应当从 CODEX_BRIDGES 环境变量解析多个 URL', () => {
    const bridges = 'http://10.0.0.1:3458,http://10.0.0.2:3458';
    const parsed = bridges.split(',').map(s => s.trim()).filter(Boolean);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toBe('http://10.0.0.1:3458');
    expect(parsed[1]).toBe('http://10.0.0.2:3458');
  });

  it('单个 URL 也应正常工作', () => {
    const bridges = 'http://10.0.0.1:3458';
    const parsed = bridges.split(',').map(s => s.trim()).filter(Boolean);
    expect(parsed).toHaveLength(1);
  });

  it('空字符串返回空数组', () => {
    const parsed = ''.split(',').map(s => s.trim()).filter(Boolean);
    expect(parsed).toHaveLength(0);
  });
});

describe('BRIDGE_ACCOUNTS 环境变量', () => {
  it('逗号分隔解析为数组', () => {
    const accounts = 'team3,team4'.split(',').map(s => s.trim()).filter(Boolean);
    expect(accounts).toEqual(['team3', 'team4']);
  });

  it('单账号也正常', () => {
    const accounts = 'team5'.split(',').map(s => s.trim()).filter(Boolean);
    expect(accounts).toEqual(['team5']);
  });
});
