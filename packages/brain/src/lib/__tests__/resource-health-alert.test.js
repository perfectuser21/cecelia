/** 资源健康变坏预警（任务 5bf2512a）：掉线/风控 → Bark 紧急 + P1 系统告警；降级 → P1；恢复 → P2；告警自身出错绝不外抛。 */
import { describe, it, expect, vi } from 'vitest';
import { decideHealthAlert, notifyHealthTransition } from '../resource-health-alert.js';

describe('decideHealthAlert', () => {
  it.each([
    [null, 'restricted', 'urgent'],
    ['healthy', 'offline', 'urgent'],
    ['offline', 'restricted', 'urgent'],
    ['degraded', 'offline', 'urgent'],
    ['healthy', 'degraded', 'warn'],
    ['unknown', 'degraded', 'warn'],
    [null, 'degraded', 'warn'],
    ['offline', 'healthy', 'recover'],
    ['restricted', 'healthy', 'recover'],
    ['healthy', 'healthy', null],
    ['offline', 'offline', null],
    ['offline', 'degraded', null],
    [null, 'healthy', null],
    ['healthy', 'unknown', null],
  ])('%s → %s = %s', (prev, next, expected) => {
    expect(decideHealthAlert(prev, next)).toBe(expected);
  });
});

describe('notifyHealthTransition', () => {
  const row = { resource_type: 'account', resource_key: 'douyin:a1', status: 'restricted', reason: '切换要人脸', source: 'phone-rpa' };

  it('紧急：Bark（按资源+状态去重）+ P1 系统告警', async () => {
    const sendBark = vi.fn().mockResolvedValue(true);
    const raise = vi.fn().mockResolvedValue(undefined);
    const level = await notifyHealthTransition(row, 'healthy', { sendBark, raise });
    expect(level).toBe('urgent');
    expect(sendBark).toHaveBeenCalledWith(
      expect.stringContaining('被风控'),
      expect.stringContaining('douyin:a1'),
      expect.objectContaining({ dedupeKey: 'resource-health:account:douyin:a1:restricted' }),
    );
    expect(raise).toHaveBeenCalledWith('P1', 'resource_health_restricted', expect.stringContaining('切换要人脸'));
  });

  it('降级只走 P1，不 Bark', async () => {
    const sendBark = vi.fn();
    const raise = vi.fn();
    await notifyHealthTransition({ ...row, status: 'degraded', reason: '电量低' }, 'healthy', { sendBark, raise });
    expect(sendBark).not.toHaveBeenCalled();
    expect(raise).toHaveBeenCalledWith('P1', 'resource_health_degraded', expect.any(String));
  });

  it('恢复走 P2', async () => {
    const raise = vi.fn();
    await notifyHealthTransition({ ...row, status: 'healthy', reason: null }, 'offline', { sendBark: vi.fn(), raise });
    expect(raise).toHaveBeenCalledWith('P2', 'resource_health_recovered', expect.stringContaining('douyin:a1'));
  });

  it('Bark/告警抛错 → 吞掉只记日志，不外抛', async () => {
    const sendBark = vi.fn().mockRejectedValue(new Error('bark down'));
    const raise = vi.fn().mockRejectedValue(new Error('alert down'));
    await expect(notifyHealthTransition(row, 'healthy', { sendBark, raise })).resolves.toBe('urgent');
  });

  it('无需告警 → 不调任何通道', async () => {
    const sendBark = vi.fn();
    const raise = vi.fn();
    expect(await notifyHealthTransition({ ...row, status: 'healthy' }, 'healthy', { sendBark, raise })).toBeNull();
    expect(sendBark).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });
});
