/**
 * incident-reporter.js — 探针红信号归一化写入
 * task_id: c11cdec4-c845-447f-80da-9d528753be1d
 * sprint: incidents-layer（刀5-小刀1）
 *
 * Invariant:
 *   I-1 幂等去重：同一 fingerprint 第二次触发累加 recurrence_count，不新增行
 *   I-2 非阻塞：失败只 warn，不抛出，不阻塞探针主逻辑
 */

import pool from './db/pool.js';

/**
 * 向 incidents 表写入一条探针红信号（幂等）
 *
 * @param {string} probeId    - 探针标识（如 'launchd-patrol'）
 * @param {string} fingerprint - 去重键（如 'launchd-patrol:com.cecelia.bridge'）
 * @param {string} severity   - 级别（'p0'|'p1'|'p2'|'p3'）
 * @param {object} evidence   - 现场证据（任意 JSONB）
 * @returns {Promise<void>}   - 始终 resolve，失败时只 warn
 */
export async function reportIncident(probeId, fingerprint, severity, evidence) {
  try {
    await pool.query(
      `INSERT INTO incidents (probe_id, fingerprint, severity, evidence, status, recurrence_count)
       VALUES ($1, $2, $3, $4, 'open', 1)
       ON CONFLICT (fingerprint) DO UPDATE SET
         recurrence_count = recurrence_count + 1,
         evidence         = EXCLUDED.evidence,
         severity         = EXCLUDED.severity,
         updated_at       = NOW()`,
      [probeId, fingerprint, severity, JSON.stringify(evidence)]
    );
  } catch (err) {
    console.warn(`[incident-reporter] reportIncident 失败 fingerprint=${fingerprint}: ${err.message}`);
  }
}
