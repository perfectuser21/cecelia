/**
 * Brain v2 Phase D3 — Codex 免疫检查抽出
 *
 * 原在 tick.js L182-L213（共 1 个函数 + 常量），从主文件瘦身抽出独立模块。
 * tick.js 通过 re-export 维持既有 caller 兼容（cecelia-immune-runner 等）。
 *
 * 职责：
 *   - ensureCodexImmune(dbPool) — 每 20 小时触发一次 Codex 免疫检查任务
 */

const IMMUNE_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 小时

/**
 * 确保每 20 小时触发一次 Codex 免疫检查
 * 查询最近一条 codex_qa 任务，若超过 20h（或从未有过），自动创建
 * @param {import('pg').Pool} dbPool
 */
export async function ensureCodexImmune(dbPool) {
  const result = await dbPool.query(`
    SELECT created_at FROM tasks
    WHERE task_type = 'codex_qa'
      AND status NOT IN ('cancelled', 'canceled')
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const lastCreatedAt = result.rows[0]?.created_at;
  const elapsed = lastCreatedAt
    ? Date.now() - new Date(lastCreatedAt).getTime()
    : Infinity;

  if (elapsed < IMMUNE_INTERVAL_MS) {
    return { skipped: true, reason: 'too_soon', elapsed_ms: elapsed };
  }

  await dbPool.query(`
    INSERT INTO tasks (title, description, status, priority, task_type, trigger_source)
    VALUES ($1, $2, 'queued', 'P1', 'codex_qa', 'brain_auto')
  `, [
    'Codex 免疫检查 - cecelia-core',
    '/Users/administrator/perfect21/cecelia/quality/scripts/run-codex-immune.sh'
  ]);

  console.log('[codex-immune] task created (last check: ' +
    (lastCreatedAt ? new Date(lastCreatedAt).toISOString() : 'never') + ')');
  return { created: true, elapsed_ms: elapsed };
}
