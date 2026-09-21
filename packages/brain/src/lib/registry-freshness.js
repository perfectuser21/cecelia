/**
 * 照相层账龄哨兵(刀0,spec: docs/superpowers/specs/2026-07-18-registry-photo-layer-revive-design.md)
 * 缺时间或 provenance 时 fail-closed 为 unknown。
 */

/**
 * 一轮全量扫描的实测耗时。2026-09-21 实测 cecelia：api 写于 08:40:04、graph 写于 08:45:24,
 * 一轮 5.4 分钟；zenithjoy-workspace 行数多 4 倍、更久。取 600s 留余量。
 */
export const FULL_SCAN_DURATION_SECONDS = 600;

/**
 * 触发重扫的账龄阈值。**必须与 scripts/scan/rescan-if-changed.sh 的
 * `RESCAN_MAX_AGE_SECONDS` 默认值一致**（由 registry-freshness-budget.test.js 机械比对）。
 */
export const RESCAN_TRIGGER_SECONDS = 600;

/** rescan 的 cron 粒度(SSOT 写在 rescan-if-changed.sh 头注释:每 5 分钟一次)。 */
export const RESCAN_CRON_PERIOD_SECONDS = 300;

/**
 * 照相层保鲜预算。
 *
 * ⚠️ 必须 > RESCAN_TRIGGER + FULL_SCAN_DURATION + CRON_PERIOD,否则「旧快照过期」
 * 在数学上必然早于「新快照落库」,派发闸每个刷新周期都有一段稳定死窗。
 *
 * 0921 事故:原值 10 分钟,与 rescan 的触发阈值同为 600s —— 等于「刚过期才去刷新」,
 * 而刷新本身要 5.4 分钟、cron 还有 5 分钟粒度、上一轮没跑完时本轮被锁挡掉
 * (日志实测 age=600/899/1200s)。结果落进死窗的 coding 任务一律抛 map_stale。
 * 扫描器一直在跑、source_revision 一直等于 main HEAD、24h 账龄哨兵全程报绿,
 * 所以烂了 11 天无人发现(issue e180b05c 误判成"扫描链全挂")。
 *
 * 放宽是安全的:正确性由 assertMapImpactContract 里的
 * `map.source_revision === base_sha` 精确保证(不匹配直接 map_revision_mismatch),
 * 账龄只是活性心跳——它防的是「扫描器死了」,而扫描器死了 main 又没动时,
 * 快照其实仍然准确。真正的停摆由 promise-map-nightly 的 24h 哨兵押尾。
 */
export const PHOTO_STALE_THRESHOLD_SECONDS = 1800;
export const PHOTO_STALE_THRESHOLD_HOURS = PHOTO_STALE_THRESHOLD_SECONDS / 3600;
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
