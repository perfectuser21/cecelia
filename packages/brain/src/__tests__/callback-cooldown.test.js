import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.useRealTimers());

it('完成回调固定冷却满5000ms才允许继续，不能提前补充调度槽位', async () => {
  const cooldown = await import('../lib/callback-cooldown.js').catch(() => null);
  expect(cooldown, '完成回调需要可独立控制且保留生产5秒语义的冷却依赖').not.toBeNull();
  vi.useFakeTimers();
  let completed = false;
  const pending = cooldown.waitForCallbackCooldown().then(() => { completed = true; });
  await vi.advanceTimersByTimeAsync(4999);
  expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(completed).toBe(true);
});
