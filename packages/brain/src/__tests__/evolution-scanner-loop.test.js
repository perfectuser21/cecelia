/**
 * Regression: evolution-scanner 必须周期性跑（接回 live tick）。
 *
 * 根因（2026-06-30 审计）：PR #3469 把 scanEvolutionIfNeeded 移进 executeTick()，
 * 但 executeTick() 自 Wave 2（2026-05-04）起从不被调用（tick-loop.js 改调 runScheduler()）。
 * scanner 自 2026-06-18 不再运行，probe=PROBE_FAIL_EVOLUTION(scanner_stale)。
 * 修复：仿 pipeline-patrol-loop 创建独立 setInterval 循环。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runEvolutionScanOnce,
  startEvolutionScannerLoop,
  stopEvolutionScannerLoop,
} from '../evolution-scanner-loop.js';

const fakePool = { query: async () => ({ rows: [] }) };

describe('evolution-scanner-loop runEvolutionScanOnce', () => {
  it('同时调 scanEvolutionIfNeeded + synthesizeEvolutionIfNeeded', async () => {
    const scanEvolutionIfNeeded = vi.fn(async () => ({ ok: true, checked: 5, inserted: 2, skipped: 3 }));
    const synthesizeEvolutionIfNeeded = vi.fn(async () => ({ skipped: 'synthesized_within_7_days' }));
    const r = await runEvolutionScanOnce({ pool: fakePool, scanEvolutionIfNeeded, synthesizeEvolutionIfNeeded });
    expect(scanEvolutionIfNeeded).toHaveBeenCalledTimes(1);
    expect(synthesizeEvolutionIfNeeded).toHaveBeenCalledTimes(1);
    expect(r.scanResult).toMatchObject({ ok: true, checked: 5 });
    expect(r.synthResult).toMatchObject({ skipped: 'synthesized_within_7_days' });
  });

  it('scanEvolutionIfNeeded 抛错不影响 synthesizeEvolutionIfNeeded（non-fatal）', async () => {
    const scanEvolutionIfNeeded = vi.fn(async () => { throw new Error('github api down'); });
    const synthesizeEvolutionIfNeeded = vi.fn(async () => ({ synthesized: 1 }));
    const r = await runEvolutionScanOnce({ pool: fakePool, scanEvolutionIfNeeded, synthesizeEvolutionIfNeeded });
    expect(synthesizeEvolutionIfNeeded).toHaveBeenCalledTimes(1);
    expect(r.scanResult).toBeNull();
    expect(r.synthResult).toMatchObject({ synthesized: 1 });
  });

  it('synthesizeEvolutionIfNeeded 抛错不影响 scanEvolutionIfNeeded（non-fatal）', async () => {
    const scanEvolutionIfNeeded = vi.fn(async () => ({ ok: true, inserted: 1 }));
    const synthesizeEvolutionIfNeeded = vi.fn(async () => { throw new Error('llm timeout'); });
    const r = await runEvolutionScanOnce({ pool: fakePool, scanEvolutionIfNeeded, synthesizeEvolutionIfNeeded });
    expect(scanEvolutionIfNeeded).toHaveBeenCalledTimes(1);
    expect(r.scanResult).toMatchObject({ ok: true });
    expect(r.synthResult).toBeNull();
  });

  it('两者均抛错时返回 null/null（loop 不崩）', async () => {
    const scanEvolutionIfNeeded = vi.fn(async () => { throw new Error('boom'); });
    const synthesizeEvolutionIfNeeded = vi.fn(async () => { throw new Error('crash'); });
    const r = await runEvolutionScanOnce({ pool: fakePool, scanEvolutionIfNeeded, synthesizeEvolutionIfNeeded });
    expect(r.scanResult).toBeNull();
    expect(r.synthResult).toBeNull();
  });
});

describe('evolution-scanner-loop start/stop（独立 setInterval，重复启动幂等）', () => {
  afterEach(() => {
    stopEvolutionScannerLoop();
  });

  it('startEvolutionScannerLoop 首次 true、重复 false；stop 后可再启动', () => {
    const first = startEvolutionScannerLoop({ intervalMs: 999999 });
    const second = startEvolutionScannerLoop({ intervalMs: 999999 });
    expect(first).toBe(true);
    expect(second).toBe(false);
    stopEvolutionScannerLoop();
    const third = startEvolutionScannerLoop({ intervalMs: 999999 });
    expect(third).toBe(true);
  });

  it('stopEvolutionScannerLoop 未启动时不报错', () => {
    expect(() => stopEvolutionScannerLoop()).not.toThrow();
  });
});
