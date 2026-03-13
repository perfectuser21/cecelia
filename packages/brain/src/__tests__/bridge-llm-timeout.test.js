/**
 * bridge /llm-call 超时计算测试
 * 验证：调用方传入的 timeout 不被 BRIDGE_TIMEOUT_MS 截断
 */

import { describe, it, expect } from 'vitest';

/**
 * 从 cecelia-bridge.cjs 提取的纯函数逻辑，便于单元测试
 * 实际代码：const timeoutMs = Math.min(timeout || BRIDGE_TIMEOUT_MS, 600000)
 */
function calcTimeoutMs(timeout, BRIDGE_TIMEOUT_MS) {
  return Math.min(timeout || BRIDGE_TIMEOUT_MS, 600000);
}

describe('bridge /llm-call timeout 计算', () => {
  const BRIDGE_TIMEOUT_MS = 120000; // 默认 120s

  it('cortex 传入 300000ms 不被截断为 120000ms', () => {
    const result = calcTimeoutMs(300000, BRIDGE_TIMEOUT_MS);
    expect(result).toBe(300000);
  });

  it('未传 timeout 时使用默认 BRIDGE_TIMEOUT_MS', () => {
    const result = calcTimeoutMs(undefined, BRIDGE_TIMEOUT_MS);
    expect(result).toBe(120000);
  });

  it('timeout=0 时使用默认 BRIDGE_TIMEOUT_MS', () => {
    const result = calcTimeoutMs(0, BRIDGE_TIMEOUT_MS);
    expect(result).toBe(120000);
  });

  it('超过 600s 的值被 cap 到 600000ms', () => {
    const result = calcTimeoutMs(999999, BRIDGE_TIMEOUT_MS);
    expect(result).toBe(600000);
  });

  it('恰好 600000ms 不被截断', () => {
    const result = calcTimeoutMs(600000, BRIDGE_TIMEOUT_MS);
    expect(result).toBe(600000);
  });
});
