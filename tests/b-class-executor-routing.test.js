/**
 * 动态任务配置缓存兜底测试
 *
 * 未加载缓存时不伪造动态配置或location。
 */
import { describe, it, expect } from 'vitest';
import { getCachedConfig, getCachedLocation } from '../packages/brain/src/task-type-config-cache.js';

// ─── 测试：getCachedConfig 结构验证 ─────────────────────────────────────────
describe('getCachedConfig 未加载时返回 null', () => {
  it('未调用 loadCache 时 getCachedConfig 返回 null（安全兜底）', () => {
    // 缓存未加载（_loaded=false），getCachedConfig 应返回 null
    const result = getCachedConfig('some_task_type');
    expect(result).toBeNull();
  });

  it('未调用 loadCache 时 getCachedLocation 返回 null', () => {
    const result = getCachedLocation('some_task_type');
    expect(result).toBeNull();
  });
});
