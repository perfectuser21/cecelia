import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldStartAttemptCleanupLoop } from '../orchestrator/attempt-cleanup-loop.js';

const server = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

describe('attempt cleanup delivery server wiring', () => {
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
