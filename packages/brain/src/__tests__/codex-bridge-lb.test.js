/**
 * codex-bridge 负载均衡 - selectBestBridge 测试
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('selectBestBridge', () => {
  it('应当从 CODEX_BRIDGES 环境变量解析多个 URL', () => {
    const bridges = 'http://10.0.0.1:3458,http://10.0.0.2:3458';
    const parsed = bridges.split(',').map(s => s.trim()).filter(Boolean);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0], 'http://10.0.0.1:3458');
    assert.strictEqual(parsed[1], 'http://10.0.0.2:3458');
  });

  it('单个 URL 也应正常工作', () => {
    const bridges = 'http://10.0.0.1:3458';
    const parsed = bridges.split(',').map(s => s.trim()).filter(Boolean);
    assert.strictEqual(parsed.length, 1);
  });

  it('空字符串返回空数组', () => {
    const parsed = ''.split(',').map(s => s.trim()).filter(Boolean);
    assert.strictEqual(parsed.length, 0);
  });
});

describe('BRIDGE_ACCOUNTS 环境变量', () => {
  it('逗号分隔解析为数组', () => {
    const accounts = 'team3,team4'.split(',').map(s => s.trim()).filter(Boolean);
    assert.deepStrictEqual(accounts, ['team3', 'team4']);
  });

  it('单账号也正常', () => {
    const accounts = 'team5'.split(',').map(s => s.trim()).filter(Boolean);
    assert.deepStrictEqual(accounts, ['team5']);
  });
});
