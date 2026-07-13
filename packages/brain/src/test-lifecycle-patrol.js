import { existsSync } from 'fs';
import { join } from 'path';
import { raise } from './alerting.js';
import pool from './db.js';
import { pushCaptureAtom } from './capture-inbox.js';

export const PATROL_HOUR_UTC = 2;
export const PATROL_WINDOW_MINUTES = 5;
const STALE_DAYS = 30;

export function isInPatrolWindow(now = new Date()) {
  return now.getUTCHours() === PATROL_HOUR_UTC && now.getUTCMinutes() < PATROL_WINDOW_MINUTES;
}

function repoRoot() {
  return process.env.REPO_ROOT || new URL('../../..', import.meta.url).pathname;
}

export async function runTestLifecyclePatrol(db = pool, now = new Date()) {
  const patrolDate = now.toISOString().slice(0, 10);
  const root = repoRoot();

  const { rows } = await db.query(
    'SELECT id, file_path, status, feature_id, scanned_at FROM test_registry'
  );

  const featureIds = [...new Set(rows.filter(r => r.feature_id != null).map(r => r.feature_id))];
  let aliveFeatureIds = new Set();
  if (featureIds.length > 0) {
    const { rows: aliveRows } = await db.query(
      'SELECT id FROM journey_features WHERE id = ANY($1)',
      [featureIds]
    );
    aliveFeatureIds = new Set(aliveRows.map(r => r.id));
  }

  const staleAlerts = [];

  for (const row of rows) {
    const fileExists = existsSync(join(root, row.file_path));

    if (!fileExists) {
      await db.query('DELETE FROM test_registry WHERE id = $1', [row.id]);
      continue;
    }

    const featureDeleted = row.feature_id != null && !aliveFeatureIds.has(row.feature_id);

    if (!featureDeleted && row.status === 'orphan') {
      await db.query(
        `UPDATE test_registry SET status = 'active', orphan_reason = NULL, lifecycle_checked_at = NOW() WHERE id = $1`,
        [row.id]
      );
      continue;
    }

    if (featureDeleted) {
      await db.query(
        `UPDATE test_registry SET status = 'orphan', orphan_reason = $1, lifecycle_checked_at = NOW() WHERE id = $2`,
        ['feature_deleted', row.id]
      );

      const alertResult = await db.query(
        `INSERT INTO test_lifecycle_alerts (file_path, orphan_reason, feature_id, patrol_date, detected_at)
         VALUES ($1, $2, $3, $4::date, NOW())
         ON CONFLICT (file_path, patrol_date) DO NOTHING
         RETURNING id`,
        [row.file_path, 'feature_deleted', row.feature_id, patrolDate]
      ).catch(e => {
        console.error('[test-lifecycle-patrol] alert insert failed:', e.message);
        return { rows: [] };
      });

      const isFirstAlertToday = alertResult.rows.length > 0;

      if (isFirstAlertToday) {
        await raise('P2', 'test_lifecycle_orphan_feature_deleted', `孤儿 test：${row.file_path} 关联能力(feature_id=${row.feature_id})已不存在`)
          .catch(e => console.warn('[test-lifecycle-patrol] raise failed:', e.message));

        // journey_id 显式传 NULL：feature 已被删除，巡检语境里无法推断其原 journey 归属，
        // 显式列出优于隐式缺省（一眼可辨"已考虑过、确实不可推断"vs"遗漏未写"）
        const orphanTitle = `孤儿 test：${row.file_path}`;
        const orphanIns = await db.query(
          `INSERT INTO issues (title, priority, status, sub_area, body, notion_synced_at, journey_id)
           VALUES ($1, 'P2', 'In progress', 'brain', $2, NULL, NULL) RETURNING id`,
          [
            orphanTitle,
            `巡检发现 test_registry 中 ${row.file_path} 关联的 journey_features(id=${row.feature_id}) 已不存在。请确认该 test 是否仍有效；若确认无效，走 /dev 删除该 test 文件。`,
          ]
        ).catch(e => { console.error('[test-lifecycle-patrol] issue insert failed:', e.message); return { rows: [] }; });
        // T10 统一收件箱：issue 落库后顺手进箱
        if (orphanIns.rows?.[0]?.id) {
          await pushCaptureAtom(db, {
            content: `issue: ${orphanTitle}`,
            targetType: 'issue',
            targetSubtype: 'P2',
            routedToTable: 'issues',
            routedToId: orphanIns.rows[0].id,
          });
        }
      }

      continue;
    }

    const scannedAt = new Date(row.scanned_at);
    const staleDays = (now - scannedAt) / (1000 * 60 * 60 * 24);
    if (staleDays > STALE_DAYS) {
      staleAlerts.push({ file_path: row.file_path, days: Math.floor(staleDays) });
    }
  }

  return { staleAlerts };
}
