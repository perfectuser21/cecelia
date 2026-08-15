import { describe, expect, it, vi } from 'vitest';

import { createAttemptCleanupLoop } from '../attempt-cleanup-loop.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness(runOnce = vi.fn(async () => ({ claimed: 0 }))) {
  let intervalCallback;
  const timer = { unref: vi.fn() };
  const setIntervalFn = vi.fn((callback) => {
    intervalCallback = callback;
    return timer;
  });
  const clearIntervalFn = vi.fn();
  const onError = vi.fn();
  const loop = createAttemptCleanupLoop({
    worker: { runOnce },
    intervalMs: 30_000,
    setIntervalFn,
    clearIntervalFn,
    onError,
  });
  return {
    loop,
    runOnce,
    timer,
    setIntervalFn,
    clearIntervalFn,
    onError,
    interval: () => intervalCallback(),
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

describe('attempt cleanup delivery loop', () => {
  it('starts an immediate asynchronous drain and an unrefed 30 second interval', async () => {
    const fixture = harness();

    expect(fixture.loop.start()).toBe(true);
    expect(fixture.runOnce).not.toHaveBeenCalled();
    expect(fixture.setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(fixture.timer.unref).toHaveBeenCalledOnce();

    await flushMicrotasks();
    expect(fixture.runOnce).toHaveBeenCalledOnce();
  });

  it('is start-idempotent and never creates a second timer', () => {
    const fixture = harness();

    expect(fixture.loop.start()).toBe(true);
    expect(fixture.loop.start()).toBe(false);
    expect(fixture.setIntervalFn).toHaveBeenCalledOnce();
  });

  it('does not enter a second drain while the current worker call is pending', async () => {
    const pending = deferred();
    const fixture = harness(vi.fn(() => pending.promise));
    fixture.loop.start();
    await flushMicrotasks();

    fixture.interval();
    fixture.interval();
    await flushMicrotasks();
    expect(fixture.runOnce).toHaveBeenCalledOnce();

    pending.resolve({ claimed: 1 });
    await flushMicrotasks();
    fixture.interval();
    await flushMicrotasks();
    expect(fixture.runOnce).toHaveBeenCalledTimes(2);
  });

  it('contains worker errors and permits the next scheduled drain', async () => {
    const failure = new Error('cleanup worker failed');
    const runOnce = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ claimed: 0 });
    const fixture = harness(runOnce);
    fixture.loop.start();
    await flushMicrotasks();

    expect(fixture.onError).toHaveBeenCalledWith(failure);
    fixture.interval();
    await flushMicrotasks();
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('stops and releases its timer without interrupting future restart', async () => {
    const fixture = harness();
    fixture.loop.start();

    expect(fixture.loop.stop()).toBe(true);
    expect(fixture.clearIntervalFn).toHaveBeenCalledWith(fixture.timer);
    expect(fixture.loop.stop()).toBe(false);
    expect(fixture.loop.start()).toBe(true);
    expect(fixture.setIntervalFn).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
  });
});
