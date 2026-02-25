/**
 * Shared data fetching hook with loading/error state management
 * Replaces 15+ duplicate patterns across the codebase
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseDataFetchOptions<T> {
  /** Initial data value */
  initialData?: T | null;
  /** Polling interval in ms (0 = disabled) */
  pollInterval?: number;
  /** Auto-fetch on mount */
  autoFetch?: boolean;
  /** Dependencies that trigger re-fetch */
  dependencies?: unknown[];
  /** Transform response data */
  transform?: (data: T) => T;
  /** Called on successful fetch */
  onSuccess?: (data: T) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface UseDataFetchResult<T> {
  /** Fetched data */
  data: T | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Manual refresh function */
  refresh: () => Promise<void>;
  /** Reset to initial state */
  reset: () => void;
  /** Last successful fetch time */
  lastUpdated: Date | null;
}

/**
 * Generic data fetching hook with automatic polling and error handling
 *
 * @example
 * const { data, loading, error, refresh } = useDataFetch(
 *   () => api.getStatus(),
 *   { pollInterval: 10000 }
 * );
 */
export function useDataFetch<T>(
  fetcher: () => Promise<T>,
  options: UseDataFetchOptions<T> = {}
): UseDataFetchResult<T> {
  const {
    initialData = null,
    pollInterval = 0,
    autoFetch = true,
    dependencies = [],
    transform,
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Use ref to track mounted state
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);

  // Update fetcher ref when it changes
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await fetcherRef.current();

      if (!mountedRef.current) return;

      const transformedData = transform ? transform(result) : result;
      setData(transformedData);
      setLastUpdated(new Date());
      onSuccess?.(transformedData);
    } catch (err) {
      if (!mountedRef.current) return;

      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      onError?.(err instanceof Error ? err : new Error(message));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [transform, onSuccess, onError]);

  const reset = useCallback(() => {
    setData(initialData);
    setLoading(false);
    setError(null);
    setLastUpdated(null);
  }, [initialData]);

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    if (autoFetch) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, fetchData, ...dependencies]);

  // Polling
  useEffect(() => {
    if (pollInterval <= 0) return;

    const interval = setInterval(fetchData, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, fetchData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
    reset,
    lastUpdated,
  };
}

/**
 * Simplified version for common use case: fetch once with polling
 */
export function usePolledData<T>(
  fetcher: () => Promise<T>,
  pollInterval: number,
  dependencies: unknown[] = []
): UseDataFetchResult<T> {
  return useDataFetch(fetcher, {
    pollInterval,
    dependencies,
  });
}
