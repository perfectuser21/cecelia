/**
 * Shared polling hook for interval-based data refresh
 * Simpler alternative to useDataFetch when you just need the interval logic
 */

import { useEffect, useRef, useCallback } from 'react';

export interface UsePollingOptions {
  /** Polling interval in ms */
  interval: number;
  /** Whether polling is enabled */
  enabled?: boolean;
  /** Run callback immediately on mount */
  immediate?: boolean;
}

/**
 * Simple polling hook that runs a callback at regular intervals
 *
 * @example
 * usePolling(fetchData, { interval: 10000, immediate: true });
 */
export function usePolling(
  callback: () => void | Promise<void>,
  options: UsePollingOptions
): void {
  const { interval, enabled = true, immediate = true } = options;

  const callbackRef = useRef(callback);

  // Update callback ref when it changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Run immediately if enabled
  useEffect(() => {
    if (enabled && immediate) {
      callbackRef.current();
    }
  }, [enabled, immediate]);

  // Setup interval
  useEffect(() => {
    if (!enabled || interval <= 0) return;

    const id = setInterval(() => {
      callbackRef.current();
    }, interval);

    return () => clearInterval(id);
  }, [interval, enabled]);
}

/**
 * Polling hook that also returns a manual trigger function
 *
 * @example
 * const refresh = usePollingWithRefresh(fetchData, { interval: 30000 });
 * // Later: <button onClick={refresh}>Refresh</button>
 */
export function usePollingWithRefresh(
  callback: () => void | Promise<void>,
  options: UsePollingOptions
): () => void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  usePolling(callback, options);

  return useCallback(() => {
    callbackRef.current();
  }, []);
}

/**
 * Countdown hook - for display countdown timers
 *
 * @example
 * const countdown = useCountdown(offWorkTime);
 * // countdown = { hours: 2, minutes: 30 } or null if past
 */
export function useCountdown(
  targetTime: Date | null,
  updateInterval = 60000
): { hours: number; minutes: number } | null {
  const calculateCountdown = useCallback(() => {
    if (!targetTime) return null;

    const now = new Date();
    const diff = targetTime.getTime() - now.getTime();

    if (diff <= 0) return null;

    return {
      hours: Math.floor(diff / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
    };
  }, [targetTime]);

  // Use ref to store current value
  const countdownRef = useRef(calculateCountdown());

  usePolling(
    () => {
      countdownRef.current = calculateCountdown();
    },
    { interval: updateInterval, immediate: true }
  );

  return countdownRef.current;
}
