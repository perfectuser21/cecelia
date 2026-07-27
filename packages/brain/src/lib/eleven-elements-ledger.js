/**
 * 11要素账本状态计算——Brain 内部模块健康追踪与 journey_features 体检的共享纯函数。
 * 调用方负责传入 nfrMap / invMap（decisions 表的预聚合结果），本模块不做 DB 查询。
 */

export function daysSince(isoStr, now = Date.now()) {
  if (!isoStr) return null;
  return Math.floor((now - new Date(isoStr).getTime()) / 86400000);
}

export const ELEMENT_CELL_STATUSES = Object.freeze([
  'gray',
  'red',
  'pending',
  'green',
  'na',
]);

/**
 * 对 F1 承诺地图格子执行五态互斥事实分类。
 * 调用方提供已采集的 evidence_envelope；本函数不把静态文档当作 PASS。
 */
export function classifyElementCell(cell) {
  const sourceRefs = Array.isArray(cell.source_refs) ? cell.source_refs : [];
  const missingEvidence = Array.isArray(cell.missing_evidence)
    ? cell.missing_evidence
    : [];
  const envelope = cell.evidence_envelope;
  const currentPass = Boolean(
    envelope
    && envelope.current_sha === true
    && envelope.probe_started === true
    && envelope.exit_code === 0
    && envelope.expired !== true,
  );
  const currentFailure = Boolean(
    envelope
    && envelope.current_sha === true
    && envelope.probe_started === true
    && (
      envelope.exit_code !== 0
      || envelope.observed_result !== envelope.expected_result
    ),
  );
  const currentScanNoMatch = Boolean(
    envelope
    && envelope.current_sha === true
    && envelope.inventory_scan_started === true
    && Array.isArray(envelope.searched_paths)
    && envelope.searched_paths.length > 0
    && envelope.match_count === 0,
  );

  return [
    cell.reason_code === 'requirement_undefined'
      && sourceRefs.length === 0
      && missingEvidence.includes('requirement_definition')
      && !cell.assertion_ref
      && currentScanNoMatch
      ? 'gray' : null,
    ['known_gap', 'probe_failed'].includes(cell.reason_code)
      && sourceRefs.length > 0
      && missingEvidence.length > 0
      && (cell.reason_code === 'known_gap' ? Boolean(cell.known_gap_ref) : currentFailure)
      ? 'red' : null,
    ['awaiting_executable_evidence', 'evidence_expired'].includes(cell.reason_code)
      && sourceRefs.length > 0
      && missingEvidence.length > 0
      && !currentPass
      ? 'pending' : null,
    cell.reason_code === 'verified'
      && sourceRefs.length > 0
      && Boolean(cell.assertion_ref)
      && missingEvidence.length === 0
      && currentPass
      ? 'green' : null,
    cell.reason_code === 'not_applicable'
      && Boolean(cell.na_reason)
      && sourceRefs.length > 0
      && !currentPass
      ? 'na' : null,
  ].filter(Boolean);
}

/**
 * @param {object} feature  - brain_modules 或 journey_features 行（需含相关字段）
 * @param {object} nfrMap   - { [id]: count } decisions category='nfr' 按 target_id 聚合
 * @param {object} invMap   - { [id]: count } decisions category='invariant' 按 target_id 聚合
 * @param {number} [now]    - 可注入的当前时间戳（ms），用于测试
 * @returns {object} 11要素状态对象
 */
export function computeLedgerStatus(feature, nfrMap, invMap, now = Date.now()) {
  const daysVerified = daysSince(feature.last_verified, now);
  const daysUpdated  = daysSince(feature.updated_at, now);
  const testScore = (feature.has_unit_test       ? 1 : 0) +
                    (feature.has_integration_test ? 1 : 0) +
                    (feature.has_e2e              ? 1 : 0);

  return {
    // 1. FR: 功能描述是否齐全
    fr: feature.description ? 'ok' : 'missing',
    // 2. NFR: 非功能决策（DB 关联 + smoke_cmd 作补充）
    nfr: (nfrMap[feature.id] || 0) > 0 ? 'ok' : (feature.smoke_cmd ? 'partial' : 'missing'),
    // 3. Invariant: 不变量（DB 关联 + smoke_cmd 兜底）
    invariant: (invMap[feature.id] || 0) > 0 ? 'ok'
               : (feature.smoke_cmd ? 'partial' : 'missing'),
    // 4. 判定点: 测试覆盖分数 (0-3)
    checkpoints: testScore,
    checkpoints_max: 3,
    checkpoints_status: testScore === 3 ? 'ok' : testScore > 0 ? 'partial' : 'missing',
    // 5. 保质期: 上次验证距今天数
    freshness_days: daysVerified,
    freshness_status: daysVerified === null ? 'missing'
                      : daysVerified <= 30 ? 'ok'
                      : daysVerified <= 90 ? 'partial' : 'stale',
    // 6. 死亡告警: 当前 smoke 状态
    death_alert: feature.smoke_status === 'failing' ? 'alert'
                 : feature.smoke_status === 'passing' ? 'ok'
                 : feature.smoke_cmd ? 'unknown' : 'missing',
    // 7. 失败语义: notes 描述了什么叫失败
    failure_semantics: feature.notes ? 'ok' : 'missing',
    // 8. 效果确认: smoke_cmd 存在且通过
    effect_confirmed: feature.smoke_status === 'passing' ? 'ok'
                      : feature.smoke_cmd ? 'partial' : 'missing',
    // 9. 输入对抗面: 暂从 notes 推断
    adversarial: (feature.notes && /对抗|adversar/i.test(feature.notes)) ? 'ok' : 'missing',
    // 10. 账本保鲜: 上次更新距今天数
    ledger_age_days: daysUpdated,
    ledger_status: daysUpdated === null ? 'missing'
                   : daysUpdated <= 7 ? 'ok'
                   : daysUpdated <= 30 ? 'partial' : 'stale',
    // 11. 两轴衔接: priority 已设且状态 active
    axis_aligned: (feature.priority && feature.status === 'active') ? 'ok'
                  : feature.priority ? 'partial' : 'missing',
  };
}
