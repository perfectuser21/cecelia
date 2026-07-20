/**
 * capture-inbox.js — 统一收件箱"推"入口（九要素T10）P1 升级版
 *
 * pushCapture: 新主干入口，先写 captures 表（信封），再生成 capture_atom
 * pushCaptureAtom: 原有签名保留，内部改为先写 capture 再写 atom（向后兼容）
 * Spec: docs/superpowers/specs/2026-07-10-capture-inbox-t10-design.md
 */
const MAX_CONTENT_LEN = 2000;

/**
 * 新主干进箱入口：先写 captures（信封），再生成 capture_atom
 * 写入失败绝不抛——进箱失败不允许阻塞主流程。
 */
export async function pushCapture(pool, {
  content,
  source = 'harness',
  nature = null,
  repo = null,
  lane = null,
  refTaskId = null,
  refJourneyId = null,
  refPrUrl = null,
  dedupeKey = null,
  // atom params
  targetType = null,
  targetSubtype = null,
} = {}) {
  if (!content) return null;
  try {
    const truncated = String(content).slice(0, MAX_CONTENT_LEN);
    const status = nature ? 'clarified' : 'captured';

    // 1. 写 captures（信封）——dedupe_key 幂等
    let captureId = null;
    if (dedupeKey) {
      const { rows: existing } = await pool.query(
        'SELECT id FROM captures WHERE dedupe_key = $1',
        [dedupeKey]
      );
      if (existing.length > 0) {
        captureId = existing[0].id;
      }
    }
    if (!captureId) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO captures (content, source, nature, repo, lane, ref_task_id, ref_journey_id, ref_pr_url, dedupe_key, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (dedupe_key) DO UPDATE SET updated_at = now()
           RETURNING id`,
          [truncated, source, nature, repo, lane, refTaskId, refJourneyId, refPrUrl, dedupeKey, status]
        );
        captureId = rows[0]?.id ?? null;
      } catch (insertErr) {
        // dedupe_key race condition fallback
        if (insertErr.code === '23505') {
          const { rows } = await pool.query('SELECT id FROM captures WHERE dedupe_key = $1', [dedupeKey]);
          captureId = rows[0]?.id ?? null;
        } else {
          throw insertErr;
        }
      }
    }

    // 2. 写 capture_atom（如有 targetType）
    if (targetType && captureId) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO capture_atoms (capture_id, content, target_type, target_subtype)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [captureId, truncated, targetType, targetSubtype]
        );
        return { captureId, atomId: rows[0]?.id ?? null };
      } catch (atomErr) {
        console.warn(`[capture-inbox] atom write failed (non-fatal): ${atomErr.message}`);
        return { captureId, atomId: null };
      }
    }

    return { captureId, atomId: null };
  } catch (err) {
    console.warn(`[capture-inbox] pushCapture failed (non-fatal): ${err.message}`);
    return null;
  }
}

/**
 * 原有入口保留（向后兼容）——内部改为先写 capture 再写 atom
 */
export async function pushCaptureAtom(pool, { content, targetType, targetSubtype = null, routedToTable = null, routedToId = null } = {}) {
  if (!content || !targetType) return null;
  try {
    // 派生 nature（三类系统产出 targetType 即 nature）
    const knownNatures = ['learning', 'issue', 'handoff'];
    const nature = knownNatures.includes(targetType) ? targetType : null;

    const result = await pushCapture(pool, {
      content,
      source: 'harness',
      nature,
      targetType,
      targetSubtype,
    });
    return result?.atomId ?? null;
  } catch (err) {
    console.warn(`[capture-inbox] pushCaptureAtom failed (non-fatal, targetType=${targetType}): ${err.message}`);
    return null;
  }
}
