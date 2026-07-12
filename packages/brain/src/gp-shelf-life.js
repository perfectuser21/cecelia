// GP 保质期 delta job（GP loop T1，DoD F6/F7）——照 receipt-collector.js 10min 自 gate 模式
// 只 import 不依赖任何模块；严禁 import notifier/alerting（防环）。全路径 fail-open。
const INTERVAL_MS = parseInt(
  process.env.CECELIA_GP_SHELF_LIFE_INTERVAL_MS || String(10 * 60 * 1000),
  10
);
let lastRunAt = 0;
export function __resetGpShelfLifeForTest() { lastRunAt = 0; }

export async function runGpShelfLife(dbPool) {
  const now = Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true, expired: 0, autoReleased: 0 };
  lastRunAt = now;

  let expired = 0;
  let autoReleased = 0;
  try {
    // 规则1（DoD F7）：保质期——approved 超 review_after 未开工 → expired（重上批审段）
    const r1 = await dbPool.query(
      `UPDATE golden_paths
       SET status = 'expired',
           status_reason = '保质期过期：approved 超 review_after 未开工（delta）',
           updated_at = now()
       WHERE status = 'approved' AND review_after IS NOT NULL AND review_after < now()
       RETURNING id, title`
    );
    expired = r1.rows.length;
    if (expired > 0) {
      console.warn(`[gp-shelf-life] ${expired} 条 approved GP 保质期过期置 expired: ${r1.rows.map(r => r.id).join(',')}`);
    }

    // 规则2（DoD F6）：报备否决窗——converged+auto_release 过 veto_deadline 未否决 → 自动生效 approved 留痕
    const r2 = await dbPool.query(
      `UPDATE golden_paths
       SET status = 'approved', approved_at = now(), review_after = now() + interval '14 days',
           status_reason = '报备制自动生效：24h 否决窗过期无否决（b416bfb3）',
           updated_at = now()
       WHERE status = 'converged' AND auto_release = true
         AND veto_deadline IS NOT NULL AND veto_deadline < now()
       RETURNING id, title`
    );
    autoReleased = r2.rows.length;
    if (autoReleased > 0) {
      console.warn(`[gp-shelf-life] ${autoReleased} 条报备 GP 否决窗过期自动生效 approved: ${r2.rows.map(r => r.id).join(',')}`);
    }
  } catch (err) {
    console.warn('[gp-shelf-life] 检查失败（fail-open）:', err.message);
  }
  return { expired, autoReleased };
}
