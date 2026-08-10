import { describe, expect, it, vi } from 'vitest';
import {
  cleanupStaleCaches,
  createReloadOnce,
  refreshServiceWorkers,
} from './cache-lifecycle';

describe('Dashboard 缓存升级生命周期', () => {
  it('Service Worker 查询失败时继续启动，不向上抛错', async () => {
    const serviceWorkers = {
      getRegistrations: vi.fn().mockRejectedValue(new Error('browser storage unavailable')),
    };

    await expect(refreshServiceWorkers(serviceWorkers)).resolves.toBeUndefined();
  });

  it('新 bundle 已加载时清理旧状态并直接继续，不再二次刷新', async () => {
    const storage = {
      getItem: vi.fn().mockReturnValue('old-version'),
      setItem: vi.fn(),
    };
    const unregister = vi.fn().mockResolvedValue(true);
    const serviceWorkers = {
      getRegistrations: vi.fn().mockResolvedValue([{ unregister }]),
    };
    const deleteCache = vi.fn().mockResolvedValue(true);
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['legacy-navigation-cache']),
      delete: deleteCache,
    };

    await expect(cleanupStaleCaches({
      version: 'new-version',
      storage,
      serviceWorkers,
      cacheStorage,
    })).resolves.toBeUndefined();

    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith('legacy-navigation-cache');
    expect(storage.setItem).toHaveBeenCalledWith('app-cache-version', 'new-version');
  });

  it('同一页面内 Service Worker 多次切换也只刷新一次', () => {
    const reload = vi.fn();
    const reloadOnce = createReloadOnce(reload);

    reloadOnce();
    reloadOnce();

    expect(reload).toHaveBeenCalledOnce();
  });
});
