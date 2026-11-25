import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { fail } from './policy.mjs';

// 只限制begin的锁竞争等待；拿锁后的原有快照/写账继续遵守原事务语义。
export async function beginWithContentionRetry(ledger, request, {
  waitMs = 30000, now = () => performance.now(), sleep = setTimeout,
} = {}) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 30000) throw fail('INVALID_BEGIN_WAIT_BUDGET');
  const deadline = now() + waitMs;
  for (let attempt = 0; attempt < 31; attempt += 1) {
    if (attempt > 0 && now() >= deadline) break;
    try {
      return await ledger.begin(request);
    } catch (error) {
      if (error?.code !== 'IMAGE_RETENTION_BUSY') throw error;
    }
    const remaining = deadline - now();
    if (remaining <= 0 || attempt === 30) break;
    await sleep(Math.min(1000, remaining));
  }
  throw fail('IMAGE_RETENTION_BUSY_TIMEOUT');
}
