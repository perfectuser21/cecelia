/**
 * Self-Drive Flow Integration Tests
 *
 * Tests the lifecycle of startSelfDriveLoop() under failure scenarios
 * that can't be caught by simple unit tests (hang vs throw).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- mocks ---

const mockQuery = vi.fn();

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue('test-task-id'),
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({
    text: JSON.stringify({ reasoning: '无需行动', actions: [] }),
  }),
}));

vi.mock('../dopamine.js', () => ({
  getRewardScore: vi.fn().mockResolvedValue({ score: 1.0, count: 1, breakdown: {} }),
}));

vi.mock('../proactive-mouth.js', () => ({
  sendProactiveMessage: vi.fn().mockResolvedValue({}),
}));

// ============================================================
// Path 6: Initial cycle hang → safety timeout behavior
// ============================================================

describe('Path 6: startSelfDriveLoop safety timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Path 6a: initial cycle hangs → safety-net fires → setInterval established (loop survives)', async () => {
    // Arrange: getConfig query succeeds, loop_started INSERT succeeds,
    // but runSelfDrive's first DB query hangs forever (never resolves).
    let hangingQueryResolve; // will never be called in this test

    mockQuery
      // getConfig: self_drive_interval_ms
      .mockResolvedValueOnce({ rows: [{ key: 'self_drive_interval_ms', value: '14400000' }] })
      // recordEvent loop_started: succeeds
      .mockResolvedValueOnce({ rows: [] })
      // runSelfDrive → getLatestProbeResults: hangs forever
      .mockImplementationOnce(() => new Promise(resolve => { hangingQueryResolve = resolve; }))
      // After safety-net fires, cycle_error recordEvent (fire-and-forget)
      .mockResolvedValue({ rows: [] });

    const { startSelfDriveLoop, getSelfDriveStatus, CYCLE_SAFETY_TIMEOUT_MS } = await import('../self-drive.js');

    // Act: start the loop
    await startSelfDriveLoop();

    // _driveTimer should be set immediately (not null), even before first cycle
    expect(getSelfDriveStatus().running).toBe(true);

    // Advance: 2min initial delay fires the first cycle (which hangs)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    // Advance: CYCLE_SAFETY_TIMEOUT_MS fires the safety net
    await vi.advanceTimersByTimeAsync(CYCLE_SAFETY_TIMEOUT_MS);

    // Advance: 4h interval — if setInterval was established, a new cycle starts
    const callCountBefore = mockQuery.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    const callCountAfter = mockQuery.mock.calls.length;

    // setInterval must have fired (new DB queries means new cycle ran)
    expect(callCountAfter).toBeGreaterThan(callCountBefore);
    expect(getSelfDriveStatus().running).toBe(true);
  });

  it('Path 6b: initial cycle hangs → safety-net records cycle_error (probe can detect)', async () => {
    // Arrange: getConfig succeeds, loop_started succeeds,
    // runSelfDrive's first DB query hangs.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ key: 'self_drive_interval_ms', value: '14400000' }] })
      .mockResolvedValueOnce({ rows: [] }) // loop_started event
      .mockImplementationOnce(() => new Promise(() => {})) // hangs
      .mockResolvedValue({ rows: [] }); // cycle_error INSERT + subsequent queries

    const { startSelfDriveLoop, CYCLE_SAFETY_TIMEOUT_MS } = await import('../self-drive.js');

    await startSelfDriveLoop();

    // advance past initial delay + safety timeout
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + CYCLE_SAFETY_TIMEOUT_MS + 100);

    // Find the cycle_error INSERT call
    const insertCalls = mockQuery.mock.calls.filter(args =>
      typeof args[0] === 'string' && args[0].includes('INSERT INTO cecelia_events')
    );
    const cycleErrorCall = insertCalls.find(args => {
      try {
        const payload = JSON.parse(args[1][0]);
        return payload.subtype === 'cycle_error' && payload.error && payload.error.includes('safety_net');
      } catch { return false; }
    });

    expect(cycleErrorCall).toBeDefined();
  });
});
