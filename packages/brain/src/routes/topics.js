import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /api/brain/topics
 * 查询 topic_selection_log 记录
 * 默认返回今日（WHERE selected_date = CURRENT_DATE）
 * 支持 ?date=YYYY-MM-DD 参数过滤指定日期
 */
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;

    let queryText;
    let params;

    if (date) {
      // 指定日期
      queryText = `
        SELECT id, selected_date, keyword, content_type,
               title_candidates, hook, why_hot, priority_score, created_at
        FROM topic_selection_log
        WHERE selected_date = $1
        ORDER BY priority_score DESC, created_at DESC
      `;
      params = [date];
    } else {
      // 默认今日
      queryText = `
        SELECT id, selected_date, keyword, content_type,
               title_candidates, hook, why_hot, priority_score, created_at
        FROM topic_selection_log
        WHERE selected_date = CURRENT_DATE
        ORDER BY priority_score DESC, created_at DESC
      `;
      params = [];
    }

    const result = await pool.query(queryText, params);

    const selectedDate = date || new Date().toISOString().slice(0, 10);

    res.json({
      data: result.rows,
      date: selectedDate,
      total: result.rows.length,
    });
  } catch (err) {
    console.error('[topics-route] 查询失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
