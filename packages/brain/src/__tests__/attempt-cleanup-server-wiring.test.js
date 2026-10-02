import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { shouldStartAttemptCleanupLoop } from '../orchestrator/attempt-cleanup-loop.js';

const server = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

describe('attempt cleanup delivery server wiring', () => {
  it('给生产终态清理 transport 注入现有数据库 pool', () => {
    const start = server.indexOf('const kernelFleetTerminalTransport =');
    const end = server.indexOf('// 启动自检', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const pool = { query: vi.fn() };
    const createProductionExecutionTransport = vi.fn(() => ({}));

    runInNewContext(server.slice(start, end), {
      pool,
      process: { env: {} },
      globalThis: { fetch: vi.fn() },
      createProductionExecutionTransport,
    });

    expect(createProductionExecutionTransport).toHaveBeenCalledTimes(1);
    expect(createProductionExecutionTransport.mock.calls[0][0].pool).toBe(pool);
  });

  it('constructs one production transport and reuses it for terminal and cleanup delivery', () => {
    expect(server.match(/createProductionExecutionTransport\s*\(/g)).toHaveLength(1);
    expect(server).toContain('createAttemptCleanupWorker');
    expect(server).toContain('createAttemptCleanupLoop');
    expect(server).toMatch(
      /createAttemptCleanupWorker\(\{[\s\S]*?transport:\s*kernelFleetTerminalTransport[\s\S]*?\}\)/,
    );
  });

  it('starts non-blockingly before harness revival and automatic tick dispatch', () => {
    const startIndex = server.indexOf('attemptCleanupLoop.start()');
    expect(startIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeLessThan(server.indexOf('reviveOrphanedHarnessTasks'));
    expect(startIndex).toBeLessThan(server.indexOf('await initTickLoop()'));
    expect(server).not.toContain('await attemptCleanupLoop.start()');
  });

  it('keeps preview and evaluator processes passive and stops on shutdown', () => {
    expect(server).toContain('shouldStartAttemptCleanupLoop(process.env)');
    expect(server).toContain('attemptCleanupLoop.stop()');
  });

  it.each(['1', 'true'])('keeps BRAIN_PREVIEW=%s passive', (preview) => {
    expect(shouldStartAttemptCleanupLoop({ BRAIN_PREVIEW: preview })).toBe(false);
  });
});
