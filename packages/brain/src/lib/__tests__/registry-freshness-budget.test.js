/**
 * 照相层保鲜预算 vs 刷新周期的机械守卫。
 *
 * 0921 事故：`PHOTO_STALE_THRESHOLD_HOURS` 是 10 分钟，而 rescan-if-changed.sh 的
 * `RESCAN_MAX_AGE_SECONDS` 默认也是 600 秒——两个数碰巧相等，语义却成了
 * 「刚过期才去刷新」。而一轮全扫要 5.4 分钟（2026-09-21 实测 cecelia），cron 粒度
 * 5 分钟，上一轮没跑完时本轮还会被锁挡掉（日志实测 age=600/899/1200s）。
 * 于是「旧快照过期」在数学上必然早于「新快照落库」，派发闸每个周期都有一段稳定死窗，
 * 落进死窗的 coding 任务一律 `map_stale`。
 *
 * 这不是「扫描链挂了」：扫描一直在跑、source_revision 一直等于 main HEAD，
 * 24h 账龄哨兵全程报绿——所以烂了 11 天没人发现（issue e180b05c 误判成扫描链全挂）。
 * 正确性由 `map.source_revision === base_sha` 单独精确保证，账龄只是活性心跳。
 *
 * 本守卫把那条不变式写死：预算必须覆盖一整轮刷新周期，且 JS 记的触发阈值必须与
 * shell 脚本里的真实默认值一致——只改一边就红，不会再悄悄收敛成同一个数。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PHOTO_STALE_THRESHOLD_SECONDS,
  PHOTO_STALE_THRESHOLD_HOURS,
  RESCAN_TRIGGER_SECONDS,
  RESCAN_CRON_PERIOD_SECONDS,
  FULL_SCAN_DURATION_SECONDS,
} from '../registry-freshness.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESCAN_SH = resolve(HERE, '../../../../../scripts/scan/rescan-if-changed.sh');

describe('照相层保鲜预算 vs 刷新周期', () => {
  it('预算必须严格大于一整轮刷新周期，否则每周期都有死窗', () => {
    const cycle = RESCAN_TRIGGER_SECONDS + FULL_SCAN_DURATION_SECONDS + RESCAN_CRON_PERIOD_SECONDS;
    expect(
      PHOTO_STALE_THRESHOLD_SECONDS,
      `保鲜预算 ${PHOTO_STALE_THRESHOLD_SECONDS}s 没盖住刷新周期 ${cycle}s`
      + `（触发 ${RESCAN_TRIGGER_SECONDS} + 扫描 ${FULL_SCAN_DURATION_SECONDS} + cron 粒度 ${RESCAN_CRON_PERIOD_SECONDS}）`
      + '：旧快照会在新快照落库前过期，派发闸周期性抛 map_stale',
    ).toBeGreaterThan(cycle);
  });

  it('JS 侧记的触发阈值必须等于 rescan-if-changed.sh 的真实默认值', () => {
    const src = readFileSync(RESCAN_SH, 'utf8');
    const m = src.match(/RESCAN_MAX_AGE_SECONDS:-(\d+)/);
    expect(m, 'rescan-if-changed.sh 里没找到 RESCAN_MAX_AGE_SECONDS 默认值（脚本被改过？）').toBeTruthy();
    expect(
      Number(m[1]),
      `shell 默认 ${m?.[1]}s 与 JS 记的 RESCAN_TRIGGER_SECONDS=${RESCAN_TRIGGER_SECONDS}s 不一致`
      + '：两边必须同步改，否则上面那条周期断言算的是假数',
    ).toBe(RESCAN_TRIGGER_SECONDS);
  });

  it('小时值与秒值必须自洽（别的模块读的是小时值）', () => {
    expect(PHOTO_STALE_THRESHOLD_HOURS).toBe(PHOTO_STALE_THRESHOLD_SECONDS / 3600);
  });

  it('四个常量必须是正有限数，防止被改成 0/NaN 让周期断言变成恒真', () => {
    for (const [name, v] of Object.entries({
      PHOTO_STALE_THRESHOLD_SECONDS,
      RESCAN_TRIGGER_SECONDS,
      RESCAN_CRON_PERIOD_SECONDS,
      FULL_SCAN_DURATION_SECONDS,
    })) {
      expect(Number.isFinite(v), `${name} 不是有限数`).toBe(true);
      expect(v, `${name} 必须为正`).toBeGreaterThan(0);
    }
  });
});
