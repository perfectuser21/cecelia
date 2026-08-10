const CACHE_VERSION_KEY = 'app-cache-version';

interface RegistrationLike {
  update(): Promise<void>;
  unregister(): Promise<boolean>;
}

interface ServiceWorkersLike {
  getRegistrations(): Promise<readonly RegistrationLike[]>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
}

interface CleanupOptions {
  version: string;
  storage: StorageLike;
  serviceWorkers?: ServiceWorkersLike;
  cacheStorage?: CacheStorageLike;
}

export async function refreshServiceWorkers(
  serviceWorkers?: ServiceWorkersLike,
): Promise<void> {
  if (!serviceWorkers) return;

  try {
    const registrations = await serviceWorkers.getRegistrations();
    await Promise.allSettled(
      registrations.map((registration) => registration.update()),
    );
  } catch {
    // 浏览器隐私设置可能拒绝读取 Service Worker；页面仍须正常启动。
  }
}

export async function cleanupStaleCaches({
  version,
  storage,
  serviceWorkers,
  cacheStorage,
}: CleanupOptions): Promise<void> {
  let storedVersion: string | null = null;
  try {
    storedVersion = storage.getItem(CACHE_VERSION_KEY);
  } catch {
    // 隐私浏览可能禁用 Web Storage；仍须清掉会接管深链导航的旧 PWA 状态。
  }

  if (storedVersion === version) return;

  if (serviceWorkers) {
    try {
      const registrations = await serviceWorkers.getRegistrations();
      await Promise.allSettled(
        registrations.map((registration) => registration.unregister()),
      );
    } catch {
      // 清理失败不能阻断 React 挂载。
    }
  }

  if (cacheStorage) {
    try {
      const cacheNames = await cacheStorage.keys();
      await Promise.allSettled(
        cacheNames.map((cacheName) => cacheStorage.delete(cacheName)),
      );
    } catch {
      // 清理失败不能阻断 React 挂载。
    }
  }

  try {
    storage.setItem(CACHE_VERSION_KEY, version);
  } catch {
    // 禁用本地存储时仍继续启动应用。
  }
}
