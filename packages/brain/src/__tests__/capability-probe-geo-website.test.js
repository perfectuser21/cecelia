/**
 * Regression test for PROBE_FAIL_GEO_WEBSITE timeout bug.
 *
 * Root cause: sequential fetch calls stacked up to 3×10s = 30s, hitting outer
 * probe timeout and causing posts_page to be aborted. Fix: parallel fetches +
 * 20s per-check timeout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- module mocks required by capability-probe.js ---
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../auto-fix.js', () => ({ shouldAutoFix: vi.fn(() => false), dispatchToDevSkill: vi.fn() }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: vi.fn(() => 0), MAX_SEATS: 10 }));
vi.mock('../alerting.js', () => ({ raise: vi.fn(), sendAlert: vi.fn() }));
vi.mock('../cortex.js', () => ({ performRCA: vi.fn() }));
vi.mock('../monitor-loop.js', () => ({
  getMonitorStatus: vi.fn(() => ({ running: true, interval_ms: 30000, cycle_count: 1, last_cycle_at: Date.now() })),
  startMonitorLoop: vi.fn(),
}));
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: vi.fn(() => true),
  getConsciousnessStatus: vi.fn(() => ({ enabled: true, env_override: false })),
  setConsciousnessEnabled: vi.fn(),
  initConsciousnessGuard: vi.fn(),
  logStartupDeclaration: vi.fn(),
  _resetCacheForTest: vi.fn(),
  _resetDeprecationWarn: vi.fn(),
  GUARDED_MODULES: [],
}));

// Helper: build a fetch mock that resolves after `delayMs` with status 200
function makeFetchMock(responses) {
  return vi.fn((url) => {
    const match = responses.find(r => url.includes(r.urlFragment));
    if (!match) {
      return Promise.resolve({ status: 404, text: async () => '' });
    }
    const { delayMs = 0, status = 200, body = '' } = match;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ status, text: async () => body }), delayMs);
      // AbortSignal support
      const signal = arguments[1]?.signal ?? match.passedSignal;
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted due to timeout', 'AbortError'));
        });
      }
    });
  });
}

describe('probeGeoWebsite', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockQuery.mockResolvedValue({
      rows: [{ task_count: 1, recent_runs: 0, learning_count: 0, cnt: 0, last_run: null }],
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it('passes when all pages respond with expected content', async () => {
    global.fetch = vi.fn((url, opts) => {
      const body = url.includes('/zh/') && !url.includes('blog') && !url.includes('posts')
        ? 'Welcome to ZenithJoyAI homepage'
        : url.includes('/zh/blog/')
          ? 'Visit our /zh/blog/ for articles'
          : 'Posts listing page';
      return Promise.resolve({ status: 200, text: async () => body });
    });

    const { runProbes } = await import('../capability-probe.js');
    const results = await runProbes();
    const geoResult = results.find(r => r.name === 'geo_website');

    expect(geoResult).toBeDefined();
    expect(geoResult.ok).toBe(true);
    expect(geoResult.detail).toContain('homepage=ok');
    expect(geoResult.detail).toContain('blog_list=ok');
    expect(geoResult.detail).toContain('posts_page=ok');
  });

  it('reports failure (not a crash) when posts_page times out after 10s', async () => {
    // This was the regression: posts_page AbortSignal fires before fetch resolves.
    // The probe must catch the error and return ok=false with a descriptive detail.
    global.fetch = vi.fn((url, opts) => {
      if (url.includes('/zh/posts/')) {
        // Simulate a request that the caller's AbortSignal will abort
        return new Promise((resolve, reject) => {
          const signal = opts?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted due to timeout', 'AbortError'));
            });
          }
          // Never resolves on its own (simulates a very slow server)
        });
      }
      const body = url.includes('/zh/blog/')
        ? 'Visit our /zh/blog/ for articles'
        : 'Welcome to ZenithJoyAI homepage';
      return Promise.resolve({ status: 200, text: async () => body });
    });

    // Override AbortSignal.timeout to fire almost immediately so the test is fast
    const realAbortSignalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = (ms) => {
      if (ms >= 15000) {
        // For per-check signals in the geo probe: fire after 50ms in tests
        return AbortSignal.timeout.bind(null)(50);
      }
      return realAbortSignalTimeout(ms);
    };
    // Restore original
    AbortSignal.timeout = realAbortSignalTimeout;

    // Use a proper approach: just verify the probe handles an aborted fetch gracefully
    // by triggering abort directly via a short-lived signal
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation was aborted due to timeout', 'AbortError')), 50);

    global.fetch = vi.fn((url, opts) => {
      if (url.includes('/zh/posts/')) {
        return new Promise((resolve, reject) => {
          const sig = opts?.signal;
          if (sig) {
            if (sig.aborted) {
              reject(sig.reason ?? new DOMException('aborted', 'AbortError'));
              return;
            }
            sig.addEventListener('abort', () => {
              reject(sig.reason ?? new DOMException('The operation was aborted due to timeout', 'AbortError'));
            });
          }
          // Never resolves — simulates slow server
        });
      }
      const body = url.includes('/zh/blog/')
        ? 'Visit our /zh/blog/ for articles'
        : 'Welcome to ZenithJoyAI homepage';
      return Promise.resolve({ status: 200, text: async () => body });
    });

    // Patch AbortSignal.timeout to use a very short timeout for the posts URL
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = vi.fn((ms) => {
      // Return a signal that fires in 50ms regardless of `ms` (test speed)
      const ac = new AbortController();
      setTimeout(() => ac.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 50);
      return ac.signal;
    });

    try {
      const { runProbes } = await import('../capability-probe.js');
      const results = await runProbes();
      const geoResult = results.find(r => r.name === 'geo_website');

      expect(geoResult).toBeDefined();
      // posts_page timed out → overall probe should fail
      expect(geoResult.ok).toBe(false);
      // The detail should mention posts_page error, not crash
      expect(geoResult.detail).toMatch(/posts_page=error/);
      // homepage and blog_list should still be ok (parallel execution)
      expect(geoResult.detail).toContain('homepage=ok');
      expect(geoResult.detail).toContain('blog_list=ok');
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });

  it('geo_website probe is listed in PROBES', async () => {
    const { PROBES } = await import('../capability-probe.js');
    const names = PROBES.map(p => p.name);
    expect(names).toContain('geo_website');
  });

  it('passes when posts_page returns 200 with no expected content check', async () => {
    global.fetch = vi.fn((url) => {
      return Promise.resolve({ status: 200, text: async () => 'some content ZenithJoyAI /zh/blog/' });
    });

    const { runProbes } = await import('../capability-probe.js');
    const results = await runProbes();
    const geoResult = results.find(r => r.name === 'geo_website');

    expect(geoResult.ok).toBe(true);
    expect(geoResult.detail).toContain('posts_page=ok');
  });

  it('fails when homepage returns non-200', async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/zh/') && !url.includes('blog') && !url.includes('posts')) {
        return Promise.resolve({ status: 503, text: async () => '' });
      }
      return Promise.resolve({ status: 200, text: async () => 'ZenithJoyAI /zh/blog/' });
    });

    const { runProbes } = await import('../capability-probe.js');
    const results = await runProbes();
    const geoResult = results.find(r => r.name === 'geo_website');

    expect(geoResult.ok).toBe(false);
    expect(geoResult.detail).toContain('homepage=fail(503)');
  });
});
