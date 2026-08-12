/**
 * 照相层账龄哨兵(刀0,spec: docs/superpowers/specs/2026-07-18-registry-photo-layer-revive-design.md)
 * 默认预算 10 分钟；缺时间或 provenance 时 fail-closed 为 unknown。
 */
export const PHOTO_STALE_THRESHOLD_HOURS = 10 / 60;
export const SNAPSHOT_FUTURE_TOLERANCE_MS = 60_000;
const GIT_OBJECT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SCANNER_VERSION_RE = /^[a-z][a-z0-9-]*-v[1-9][0-9]*$/;

function result({
  status, reasonCode, latest = null, ageHours = null, stale = true,
  warning, sourceRevision = null, scannerVersion = null, rowCount = null,
}) {
  const lastSuccessAt = latest ? latest.toISOString() : null;
  return {
    status,
    reason_code: reasonCode,
    last_success_at: lastSuccessAt,
    source_revision: sourceRevision,
    scanner_version: scannerVersion,
    row_count: rowCount,
    latest_scan: lastSuccessAt,
    age_hours: ageHours,
    stale,
    warning,
  };
}

export function computeFreshness(snapshot, now = new Date(), thresholdHours = PHOTO_STALE_THRESHOLD_HOURS) {
  const isMetadata = typeof snapshot === 'object' && snapshot !== null && !(snapshot instanceof Date);
  const sourceRevision = isMetadata && typeof snapshot.source_revision === 'string'
    ? snapshot.source_revision.trim()
    : null;
  const scannerVersion = isMetadata && typeof snapshot.scanner_version === 'string'
    ? snapshot.scanner_version.trim()
    : null;
  const rowCount = isMetadata && Number.isInteger(snapshot.row_count) ? snapshot.row_count : null;
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) {
    return result({
      status: 'unknown', reasonCode: 'clock_invalid', sourceRevision, scannerVersion, rowCount,
      warning: `照相层判龄时钟无效(${String(now)}),按 unknown 处理`,
    });
  }

  if (!snapshot) {
    return result({
      status: 'unknown',
      reasonCode: 'snapshot_missing',
      warning: '照相层无数据:扫描器从未运行,先跑 scripts/scan/run-all-scans.sh',
    });
  }

  const scannedAt = isMetadata ? snapshot.scanned_at : snapshot;

  if (!scannedAt) {
    return result({
      status: 'unknown', reasonCode: 'snapshot_missing', sourceRevision, scannerVersion, rowCount,
      warning: '照相层无数据:扫描器从未运行,先跑 scripts/scan/run-all-scans.sh',
    });
  }

  const latest = scannedAt instanceof Date ? scannedAt : new Date(scannedAt);
  if (Number.isNaN(latest.getTime())) {
    return result({
      status: 'unknown', reasonCode: 'snapshot_time_invalid', sourceRevision, scannerVersion, rowCount,
      warning: `照相层 scanned_at 无效(${String(scannedAt)}),按 unknown 处理`,
    });
  }

  const ageMs = current.getTime() - latest.getTime();
  if (ageMs < -SNAPSHOT_FUTURE_TOLERANCE_MS) {
    return result({
      status: 'unknown', reasonCode: 'snapshot_from_future', latest, ageHours: 0,
      sourceRevision, scannerVersion, rowCount,
      warning: '照相层 scanned_at 超过时钟容差,按 unknown 处理',
    });
  }
  const ageHours = Math.max(0, ageMs) / 3600000;
  const roundedAgeHours = Math.round(ageHours * 10) / 10;
  const ageIsStale = ageHours > thresholdHours;
  const thresholdMinutes = Math.round(thresholdHours * 60);

  if (!sourceRevision) {
    return result({
      status: 'unknown', reasonCode: 'source_revision_missing', latest,
      ageHours: roundedAgeHours, sourceRevision, scannerVersion, rowCount,
      warning: '照相层缺少 source_revision,按 unknown 处理',
    });
  }
  if (sourceRevision === 'legacy-unknown') {
    return result({
      status: 'unknown', reasonCode: 'source_revision_legacy', latest,
      ageHours: roundedAgeHours, sourceRevision, scannerVersion, rowCount,
      warning: '照相层 source_revision 为 legacy-unknown,按 unknown 处理',
    });
  }
  if (!GIT_OBJECT_ID_RE.test(sourceRevision)) {
    return result({
      status: 'unknown', reasonCode: 'source_revision_invalid', latest,
      ageHours: roundedAgeHours, sourceRevision, scannerVersion, rowCount,
      warning: '照相层 source_revision 不是完整 Git object id,按 unknown 处理',
    });
  }
  if (!scannerVersion) {
    return result({
      status: 'unknown', reasonCode: 'scanner_version_missing', latest,
      ageHours: roundedAgeHours, sourceRevision, scannerVersion, rowCount,
      warning: '照相层缺少 scanner_version,按 unknown 处理',
    });
  }
  if (scannerVersion === 'legacy') {
    return result({
      status: 'unknown', reasonCode: 'scanner_version_legacy', latest,
      ageHours: roundedAgeHours, sourceRevision, scannerVersion, rowCount,
      warning: '照相层 scanner_version 为 legacy,按 unknown 处理',
    });
  }
  if (!SCANNER_VERSION_RE.test(scannerVersion)) {
    return result({
      status: 'unknown', reasonCode: 'scanner_version_invalid', latest,
      ageHours: roundedAgeHours, sourceRevision, scannerVersion, rowCount,
      warning: '照相层 scanner_version 格式无效,按 unknown 处理',
    });
  }
  if (ageIsStale) {
    return result({
      status: 'unknown', reasonCode: 'snapshot_stale', latest,
      ageHours: roundedAgeHours, sourceRevision, scannerVersion, rowCount,
      warning: `照相层已 ${Math.round(ageHours * 60)}min 未刷新(阈值 ${thresholdMinutes}min),检查 host cron: registry-scan`,
    });
  }

  return result({
    status: 'fresh', reasonCode: null, latest, ageHours: roundedAgeHours,
    stale: false, warning: null, sourceRevision, scannerVersion, rowCount,
  });
}
