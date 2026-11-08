import { vi } from 'vitest';

const effects = vi.hoisted(() => {
  const unexpected = vi.fn(() => { throw Error('battle fixture forbids other child process'); });
  return {
    execFileSync: vi.fn(), writeFileSync: vi.fn(), unexpected,
    sendFeishu: vi.fn(async () => true), receipts: vi.fn(async () => []),
  };
});
// Match the dynamic production imports exactly; aliases share the same record-only binding.
vi.mock('child_process', () => ({ execFileSync: effects.execFileSync,
  exec: effects.unexpected, execSync: effects.unexpected, execFile: effects.unexpected,
  spawn: effects.unexpected, spawnSync: effects.unexpected, fork: effects.unexpected }));
vi.mock('node:child_process', () => ({ execFileSync: effects.execFileSync,
  exec: effects.unexpected, execSync: effects.unexpected, execFile: effects.unexpected,
  spawn: effects.unexpected, spawnSync: effects.unexpected, fork: effects.unexpected }));
vi.mock('fs', () => ({ writeFileSync: effects.writeFileSync }));
vi.mock('node:fs', () => ({ writeFileSync: effects.writeFileSync }));
vi.mock('../../notifier.js', () => ({ sendFeishu: effects.sendFeishu }));
vi.mock('../../receipt-collector.js', () => ({ getUnconfirmedReceipts: effects.receipts }));

export const battleEffects = effects;

export function resetBattleEffects() {
  effects.execFileSync.mockReset().mockReturnValue(Buffer.from(''));
  effects.writeFileSync.mockReset();
  effects.unexpected.mockClear();
  effects.sendFeishu.mockReset().mockResolvedValue(true);
  effects.receipts.mockReset().mockResolvedValue([]);
}
