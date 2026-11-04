/**
 * Knowledge 查询API。旧知识生成目录只保留诚实退役响应；历史BACKLOG不再是运行输入。
 * GET /api/brain/knowledge 继续查询原知识条目，不影响Memory/Notion知识接口。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/modules', (_req, res) => {
  res.status(410).json({
    success: false,
    error: 'knowledge_modules_retired',
    message: '旧知识生成进度已退役。请前往 Notion 知识库。',
    knowledge_url: 'https://app.notion.com/p/770c40c2ba6383ea86d001eba832c218',
  });
});

/**
 * GET /
 * 查询 knowledge 表条目
 * 支持 ?type=learning_rule 过滤
 */
router.get('/', async (req, res) => {
  try {
    const { type, limit = '200' } = req.query;
    const params = [];
    let where = '';

    if (type) {
      params.push(type);
      where = `WHERE type = $${params.length}`;
    }

    params.push(parseInt(limit, 10) || 200);
    const limitClause = `LIMIT $${params.length}`;

    const result = await pool.query(
      `SELECT id, name, type, status, sub_area, content, created_at
       FROM knowledge
       ${where}
       ORDER BY created_at DESC
       ${limitClause}`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[API] knowledge GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
