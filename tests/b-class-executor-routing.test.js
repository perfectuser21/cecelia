/**
 * B类任务 executor 路由决策测试
 *
 * 验证：
 *   - location=us + executor=codex → 本机 Codex CLI (local-codex)
 *   - location=us + executor=其他/null → cecelia-bridge (Claude Code)
 */
import { describe, it, expect } from 'vitest';
import { getCachedConfig, getCachedLocation } from '../packages/brain/src/task-type-config-cache.js';

// ─── 纯逻辑辅助函数（镜像 executor.js triggerCeceliaRun 路由决策）──────────
/**
 * 判断 US 机器应使用哪个执行器。
 * 对应 executor.js 中 triggerCeceliaRun 新增的 2.8 分支。
 * @param {string} location - 任务路由 location
 * @param {string|null} dynamicExecutor - 来自 getCachedConfig 的 executor 字段
 * @returns {'local-codex'|'cecelia-bridge'}
 */
function resolveUsExecutorMode(location, dynamicExecutor) {
  if (location === 'us' && dynamicExecutor === 'codex') {
    return 'local-codex';
  }
  return 'cecelia-bridge';
}

// ─── 测试：路由决策逻辑 ──────────────────────────────────────────────────────
describe('B类任务 executor 路由决策', () => {
  it('location=us + executor=codex → local-codex（Codex CLI）', () => {
    expect(resolveUsExecutorMode('us', 'codex')).toBe('local-codex');
  });

  it('location=us + executor=null → cecelia-bridge（Claude Code，默认）', () => {
    expect(resolveUsExecutorMode('us', null)).toBe('cecelia-bridge');
  });

  it('location=us + executor=claude_code → cecelia-bridge', () => {
    expect(resolveUsExecutorMode('us', 'claude_code')).toBe('cecelia-bridge');
  });

  it('location=us + executor=undefined → cecelia-bridge', () => {
    expect(resolveUsExecutorMode('us', undefined)).toBe('cecelia-bridge');
  });

  it('location=xian + executor=codex → cecelia-bridge（非 US 机器不走此分支）', () => {
    // location 不为 us 时，不走 US executor 分支，此函数返回 cecelia-bridge
    // 实际 xian 路由会在前面的 location=xian 分支处理（走 Codex Bridge）
    expect(resolveUsExecutorMode('xian', 'codex')).toBe('cecelia-bridge');
  });
});

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
