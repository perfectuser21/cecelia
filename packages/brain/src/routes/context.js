/**
 * context.js — Brain 全景状态汇总接口
 *
 * GET /api/brain/context
 * 返回 Claude 需要的当前状态摘要：OKR + 最近PR + 活跃任务 + 纯文本摘要
 * 用途：Claude 对话开始时调用，获取感知基础
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const [okrRows, prRows, taskRows] = await Promise.all([
      // 当前活跃 OKR（objectives）
      pool.query(`
        SELECT o.title, o.status,
          COALESCE(
            ROUND(AVG(kr.current_value::numeric / NULLIF(kr.target_value::numeric, 0) * 100), 0),
            0
          ) AS progress_pct
        FROM objectives o
        LEFT JOIN key_results kr ON kr.objective_id = o.id AND kr.status != 'archived'
        WHERE o.status != 'archived'
        GROUP BY o.id, o.title, o.status
        ORDER BY o.created_at DESC
        LIMIT 3
      `),
      // 最近 5 个 PR
      pool.query(`
        SELECT pr_title, branch, merged_at, learning_summary
        FROM dev_records
        WHERE merged_at IS NOT NULL
        ORDER BY merged_at DESC
        LIMIT 5
      `),
      // 进行中任务
      pool.query(`
        SELECT title, task_type, priority, status
        FROM tasks
        WHERE status IN ('queued', 'in_progress')
        ORDER BY
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          created_at DESC
        LIMIT 10
      `),
    ]);

    const okr = okrRows.rows;
    const recent_prs = prRows.rows;
    const active_tasks = taskRows.rows;

    // 构建纯文本摘要供 Claude 直接阅读
    const lines = ['=== Cecelia 当前状态（Brain 自动汇总）===', ''];

    if (okr.length > 0) {
      lines.push('【OKR 进度】');
      for (const o of okr) {
        lines.push(`  - ${o.title}（${o.progress_pct}%）`);
      }
      lines.push('');
    }

    if (active_tasks.length > 0) {
      lines.push('【进行中任务】');
      for (const t of active_tasks) {
        lines.push(`  - [${t.priority || '-'}] ${t.title}（${t.task_type}）`);
      }
      lines.push('');
    }

    if (recent_prs.length > 0) {
      lines.push('【最近合并 PR】');
      for (const p of recent_prs) {
        const date = p.merged_at ? new Date(p.merged_at).toISOString().slice(0, 10) : '?';
        lines.push(`  - ${date} ${p.pr_title}`);
      }
      lines.push('');
    }

    lines.push('查询更多：GET /api/brain/okr/current | /api/brain/tasks | /api/brain/dev-records');

    res.json({
      success: true,
      okr,
      recent_prs,
      active_tasks,
      summary_text: lines.join('\n'),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[GET /api/brain/context] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
