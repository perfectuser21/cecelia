import { Router } from 'express';
import pool from '../db.js';
import {
  getActiveSuggestions,
  approveSuggestion,
  rejectSuggestion,
  saveSuggestions,
} from '../topic-suggestion-manager.js';
import { generateTopics } from '../topic-selector.js';

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
      queryText = `
        SELECT id, selected_date, keyword, content_type,
               title_candidates, hook, why_hot, priority_score, created_at
        FROM topic_selection_log
        WHERE selected_date = $1
        ORDER BY priority_score DESC, created_at DESC
      `;
      params = [date];
    } else {
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

/**
 * GET /api/brain/topics/suggestions
 * 获取选题推荐队列（默认今日 pending）
 * 支持 ?date=YYYY-MM-DD&status=pending|approved|rejected|auto_promoted
 */
router.get('/suggestions', async (req, res) => {
  try {
    const { date, status = 'pending' } = req.query;
    const data = await getActiveSuggestions(pool, { date, status });
    res.json({ data, total: data.length, status });
  } catch (err) {
    console.error('[topics-route] GET /suggestions 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/topics/suggestions/:id/approve
 * Alex 批准选题 → 创建 content-pipeline task
 * Body: { reviewer?: string }
 */
router.post('/suggestions/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const reviewer = req.body?.reviewer || 'alex';
    const result = await approveSuggestion(pool, id, reviewer);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, pipeline_task_id: result.pipeline_task_id });
  } catch (err) {
    console.error('[topics-route] POST /suggestions/:id/approve 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/topics/suggestions/:id/reject
 * Alex 拒绝选题
 * Body: { reviewer?: string }
 */
router.post('/suggestions/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const reviewer = req.body?.reviewer || 'alex';
    const result = await rejectSuggestion(pool, id, reviewer);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[topics-route] POST /suggestions/:id/reject 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/topics/generate
 * 手动触发选题生成（调试/测试用，不受每日触发窗口限制）
 * 生成选题后保存为 pending 推荐，返回保存数量
 * Body: { date?: "YYYY-MM-DD" }
 */
router.post('/generate', async (req, res) => {
  try {
    const today = req.body?.date || new Date().toISOString().slice(0, 10);
    const topics = await generateTopics(pool);
    const saved = await saveSuggestions(pool, topics, today);
    res.json({ ok: true, triggered: saved, total_generated: topics.length, date: today });
  } catch (err) {
    console.error('[topics-route] POST /generate 失败:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
