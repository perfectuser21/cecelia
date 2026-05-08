/**
 * lib/harness-thread-lookup.test.js — LangGraph 修正 Sprint Stream 1
 *
 * Stub 阶段单元测试。当前 lookupHarnessThread 永远返回 null（→ router 返回 404），
 * 真实 PG 查询逻辑在 Layer 3 spawn 节点重构时插入。
 *
 * 这些断言守住"接口契约"，下游 callback router 已按此 mock：
 *   - 返回 null 表示找不到（router 应 404）
 *   - 返回 { compiledGraph, threadId } 表示成功
 *   - 不抛错、不依赖网络/PG（stub 阶段）
 */
import { describe, it, expect } from 'vitest';
import { lookupHarnessThread } from '../harness-thread-lookup.js';

describe('lib/harness-thread-lookup (Stream 1 stub)', () => {
  it('exports lookupHarnessThread 函数', () => {
    expect(typeof lookupHarnessThread).toBe('function');
  });

  it('未知 containerId 返回 null（stub 阶段，不抛错）', async () => {
    const result = await lookupHarnessThread('any-container-id');
    expect(result).toBeNull();
  });

  it('空字符串 / undefined 也返回 null（stub 阶段不做参数校验）', async () => {
    expect(await lookupHarnessThread('')).toBeNull();
    expect(await lookupHarnessThread(undefined)).toBeNull();
  });

  it('返回的 Promise 不依赖网络/PG（stub 在 50ms 内 settle）', async () => {
    const start = Date.now();
    await lookupHarnessThread('xyz');
    expect(Date.now() - start).toBeLessThan(50);
  });
});
