export const ATTEMPT_CLEANUP_INTERVAL_MS = 30_000;

export function shouldStartAttemptCleanupLoop(env = {}) {
  const preview = env.BRAIN_PREVIEW === '1' || env.BRAIN_PREVIEW === 'true';
  return !preview && env.BRAIN_EVALUATOR_MODE !== 'true';
}

function requireLoopConfiguration({ worker, intervalMs, setIntervalFn, clearIntervalFn, onError }) {
  if (!worker || typeof worker.runOnce !== 'function') {
    throw new TypeError('worker.runOnce is required');
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new TypeError('intervalMs must be a positive integer');
  }
  if (typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function') {
    throw new TypeError('timer functions are required');
  }
  if (typeof onError !== 'function') {
    throw new TypeError('onError must be a function');
  }
}

export function createAttemptCleanupLoop({
  worker,
  intervalMs = ATTEMPT_CLEANUP_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = (error) => console.error('[attempt-cleanup-loop] drain failed:', error),
} = {}) {
  requireLoopConfiguration({ worker, intervalMs, setIntervalFn, clearIntervalFn, onError });
  let timer = null;
  let running = false;

  const drain = async () => {
    if (running) return false;
    running = true;
    try {
      await worker.runOnce();
      return true;
    } catch (error) {
      try {
        onError(error);
      } catch {
        // Error reporting must not turn a contained delivery failure into rejection noise.
      }
      return false;
    } finally {
      running = false;
    }
  };

  const scheduleDrain = () => {
    void Promise.resolve().then(drain);
  };

  return Object.freeze({
    start() {
      if (timer) return false;
      timer = setIntervalFn(scheduleDrain, intervalMs);
      timer?.unref?.();
      scheduleDrain();
      return true;
    },
    stop() {
      if (!timer) return false;
      clearIntervalFn(timer);
      timer = null;
      return true;
    },
  });
}
