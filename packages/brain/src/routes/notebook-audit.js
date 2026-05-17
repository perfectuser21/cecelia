/**
 * Notebook Audit — NotebookLM source 对账 endpoint
 *
 * GET /api/brain/notebook-audit
 *
 * 对比 DB 中记录的 notebook_source_id 与 NotebookLM 实际 source 列表，
 * 返回差异报告。差异超阈值时触发 ALERT 事件到丘脑。
 */

import { Router } from 'express';
import pool from '../db.js';
import { listSources } from '../notebook-adapter.js';

const router = Router();

// 孤儿记录阈值：DB 有但 NotebookLM 没有的 source 数超过此值时告警
const ORPHAN_ALERT_THRESHOLD = 2;

router.get('/', async (req, res) => {
  try {
    const db = pool;

    // 1. 查询 DB 中所有 notebook_source_id（非 NULL）
    const { rows: dbRows } = await db.query(
      `SELECT id, level, period_start, notebook_source_id
       FROM synthesis_archive
       WHERE notebook_source_id IS NOT NULL
       ORDER BY period_start DESC`
    );

    // 2. 查询所有 notebook IDs（working + self）
    const { rows: notebookIdRows } = await db.query(
      `SELECT key, value_json FROM working_memory
       WHERE key IN ('notebook_id_working', 'notebook_id_self', 'notebook_id_alex')`
    );
    const notebookIds = Object.fromEntries(notebookIdRows.map(r => [r.key, r.value_json]));

    // 3. 获取所有 notebook 的实际 source 列表
    const notebookSourceMap = {}; // notebookId → Set<sourceId>
    const listErrors = [];
    for (const [key, nbId] of Object.entries(notebookIds)) {
      if (!nbId) continue;
      const result = await listSources(nbId);
      if (result.ok && Array.isArray(result.sources)) {
        notebookSourceMap[nbId] = new Set(result.sources.map(s => s.id));
      } else {
        listErrors.push({ notebook: key, notebookId: nbId, error: result.error });
      }
    }

    // 4. 对账：DB 记录 vs NotebookLM 实际
    const allNotebookSourceIds = new Set(
      Object.values(notebookSourceMap).flatMap(s => [...s])
    );
    const dbSourceIds = new Set(dbRows.map(r => r.notebook_source_id));

    // DB 有但 NotebookLM 没有（孤儿记录 — 可能已被删除或 ID 失效）
    const orphanedInDb = dbRows
      .filter(r => !allNotebookSourceIds.has(r.notebook_source_id))
      .map(r => ({ id: r.id, level: r.level, period_start: r.period_start, source_id: r.notebook_source_id }));

    // NotebookLM 有但 DB 没有记录的 sourceIds（未追踪的外部 source）
    const untrackedSourceIds = [...allNotebookSourceIds].filter(sid => !dbSourceIds.has(sid));

    const auditResult = {
      matched: dbRows.length - orphanedInDb.length,
      total_db_tracked: dbRows.length,
      orphaned_in_db: orphanedInDb,
      untracked_in_notebooklm_count: untrackedSourceIds.length,
      notebook_coverage: Object.entries(notebookSourceMap).map(([nbId, sources]) => ({
        notebookId: nbId,
        sourceCount: sources.size,
      })),
      list_errors: listErrors,
      audit_time: new Date().toISOString(),
    };

    // 5. 差异超阈值时记录 ALERT 日志（丘脑将在下次 tick 读取 memory_stream 时感知）
    if (orphanedInDb.length > ORPHAN_ALERT_THRESHOLD) {
      console.error(`[notebook-audit] ALERT: ${orphanedInDb.length} orphaned sources detected (threshold: ${ORPHAN_ALERT_THRESHOLD})`);
      // 写入 working_memory 让 tick 感知
      pool.query(
        `INSERT INTO working_memory (key, value_json, expires_at)
         VALUES ('notebook_audit_alert', $1, NOW() + INTERVAL '24 hours')
         ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, expires_at = EXCLUDED.expires_at`,
        [JSON.stringify({ orphaned_count: orphanedInDb.length, detected_at: new Date().toISOString() })]
      ).catch(e => console.warn('[notebook-audit] alert write failed:', e.message));
    }

    res.json({ ok: true, ...auditResult });
  } catch (err) {
    console.error('[notebook-audit] error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
