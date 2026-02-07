/**
 * useApi - SWR-like data fetching hook with in-memory cache
 *
 * Features:
 * - Stale-while-revalidate: returns cached data instantly, refreshes in background
 * - Request deduplication: same key = same inflight request
 * - Polling support
 * - No new dependencies
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ==================== Global Cache ====================

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/** Check if cache is fresh (not stale) */
function isFresh(key: string, staleTime: number): boolean {
  const entry = cache.get(key);
  if (!entry) return false;
  return Date.now() - entry.timestamp <= staleTime;
}

/** Set cache entry */
function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ==================== Hook ====================

export interface UseApiOptions<T> {
  /** Cache key (defaults to URL) */
  key?: string;
  /** Time in ms before data is considered stale (default: 60s) */
  staleTime?: number;
  /** Polling interval in ms (0 = disabled) */
  pollInterval?: number;
  /** Skip fetch (for conditional fetching) */
  enabled?: boolean;
  /** Transform response */
  transform?: (data: unknown) => T;
  /** Initial data before any fetch */
  initialData?: T;
}

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;  // true only on first load with no cache
  refreshing: boolean;  // true during background revalidation
  error: string | null;
  refresh: () => void;
}

/**
 * Fetch JSON from a URL with SWR caching
 *
 * @example
 * const { data, loading } = useApi<Goal[]>('/api/tasks/goals');
 * const { data } = useApi('/api/brain/status', { pollInterval: 10000 });
 */
export function useApi<T = unknown>(
  url: string,
  options: UseApiOptions<T> = {}
): UseApiResult<T> {
  const {
    key: cacheKey,
    staleTime = 60_000,
    pollInterval = 0,
    enabled = true,
    transform,
    initialData,
  } = options;

  const key = cacheKey || url;
  const mountedRef = useRef(true);
  const versionRef = useRef(0);

  // Initialize from cache or initialData
  const cached = cache.get(key)?.data as T | undefined;
  const [data, setData] = useState<T | null>(cached ?? initialData ?? null);
  const [loading, setLoading] = useState(!cached && enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async () => {
    if (!enabled) return;
    const version = ++versionRef.current;

    // If we have cached data, this is a background refresh
    const hasCachedData = cache.has(key);
    if (hasCachedData) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // Deduplicate: reuse inflight request for same key
      let promise = inflight.get(key) as Promise<unknown> | undefined;
      if (!promise) {
        promise = fetch(url).then(r => {
          if (!r.ok) throw new Error(`API error: ${r.status}`);
          return r.json();
        });
        inflight.set(key, promise);
        promise.finally(() => inflight.delete(key));
      }

      const raw = await promise;
      if (!mountedRef.current || version !== versionRef.current) return;

      const result = transform ? transform(raw) : (raw as T);
      setCache(key, result);
      setData(result);
      setError(null);
    } catch (err) {
      if (!mountedRef.current || version !== versionRef.current) return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (mountedRef.current && version === versionRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [url, key, enabled, transform]);

  // Initial fetch - skip if cache is fresh
  useEffect(() => {
    if (!enabled) return;
    if (isFresh(key, staleTime)) {
      // Cache is fresh, just use it
      const entry = cache.get(key);
      if (entry) {
        setData(entry.data as T);
        setLoading(false);
      }
      return;
    }
    // Cache is stale or missing — fetch (but keep showing stale data)
    if (cache.has(key)) {
      setData(cache.get(key)!.data as T);
      setLoading(false);
    }
    doFetch();
  }, [key, enabled, staleTime, doFetch]);

  // Polling
  useEffect(() => {
    if (!enabled || pollInterval <= 0) return;
    const id = setInterval(doFetch, pollInterval);
    return () => clearInterval(id);
  }, [enabled, pollInterval, doFetch]);

  // Cleanup
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => { doFetch(); }, [doFetch]);

  return { data, loading, refreshing, error, refresh };
}

/**
 * Fetch with a custom fetcher function (for non-URL APIs)
 *
 * @example
 * const { data } = useApiFn('cluster-status', fetchClusterStatus, { pollInterval: 10000 });
 */
export function useApiFn<T = unknown>(
  key: string,
  fetcher: () => Promise<T>,
  options: Omit<UseApiOptions<T>, 'key' | 'transform'> = {}
): UseApiResult<T> {
  const {
    staleTime = 60_000,
    pollInterval = 0,
    enabled = true,
    initialData,
  } = options;

  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const cached = cache.get(key)?.data as T | undefined;
  const [data, setData] = useState<T | null>(cached ?? initialData ?? null);
  const [loading, setLoading] = useState(!cached && enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async () => {
    if (!enabled) return;
    const hasCachedData = cache.has(key);
    if (hasCachedData) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      let promise = inflight.get(key) as Promise<T> | undefined;
      if (!promise) {
        promise = fetcherRef.current();
        inflight.set(key, promise as Promise<unknown>);
        promise.finally(() => inflight.delete(key));
      }

      const result = await promise;
      if (!mountedRef.current) return;
      setCache(key, result);
      setData(result);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (isFresh(key, staleTime)) {
      const entry = cache.get(key);
      if (entry) { setData(entry.data as T); setLoading(false); }
      return;
    }
    if (cache.has(key)) {
      setData(cache.get(key)!.data as T);
      setLoading(false);
    }
    doFetch();
  }, [key, enabled, staleTime, doFetch]);

  useEffect(() => {
    if (!enabled || pollInterval <= 0) return;
    const id = setInterval(doFetch, pollInterval);
    return () => clearInterval(id);
  }, [enabled, pollInterval, doFetch]);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const refresh = useCallback(() => { doFetch(); }, [doFetch]);

  return { data, loading, refreshing, error, refresh };
}
