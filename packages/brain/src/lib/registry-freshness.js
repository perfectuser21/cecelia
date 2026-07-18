/**
 * 照相层账龄哨兵(刀0,spec: docs/superpowers/specs/2026-07-18-registry-photo-layer-revive-design.md)
 * cron 停摆 >24h 时所有消费方响应自动带 stale:true——哨兵即守卫,无需额外监控件。
 */
export const PHOTO_STALE_THRESHOLD_HOURS = 24;

export function computeFreshness(latestScanAt, now = new Date(), thresholdHours = PHOTO_STALE_THRESHOLD_HOURS) {
  if (!latestScanAt) {
    return {
      latest_scan: null,
      age_hours: null,
      stale: true,
      warning: '照相层无数据:扫描器从未运行,先跑 scripts/scan/run-all-scans.sh',
    };
  }
  const latest = latestScanAt instanceof Date ? latestScanAt : new Date(latestScanAt);
  const ageHours = (now.getTime() - latest.getTime()) / 3600000;
  const stale = ageHours > thresholdHours;
  return {
    latest_scan: latest.toISOString(),
    age_hours: Math.round(ageHours * 10) / 10,
    stale,
    warning: stale
      ? `照相层已 ${Math.round(ageHours)}h 未刷新(阈值 ${thresholdHours}h),检查 host cron: registry-scan`
      : null,
  };
}
