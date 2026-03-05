import { Router } from 'express';
import pool from '../db.js';
import { runFullScan } from '../code-scanner.js';

const router = Router();

// POST /api/brain/code-scan/trigger - 触发代码质量扫描
router.post('/trigger', async (req, res) => {
  try {
    const scanResults = runFullScan();

    if (scanResults.length === 0) {
      return res.json({ count: 0, results: [], message: '扫描完成，未发现问题' });
    }

    // 批量写入数据库
    const inserted = [];
    for (const item of scanResults) {
      const result = await pool.query(
        `INSERT INTO code_scan_results
          (scan_type, file_path, issue_description, suggested_task_title)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          item.scanType,
          item.filePath,
          item.issueDescription,
          item.suggestedTaskTitle || null,
        ]
      );
      inserted.push(result.rows[0]);
    }

    res.json({
      count: inserted.length,
      results: inserted,
      message: `扫描完成，发现 ${inserted.length} 个问题`,
    });
  } catch (err) {
    console.error('[code-scan] POST /trigger error:', err.message);
    res.status(500).json({ error: '扫描失败', details: err.message });
  }
});

// GET /api/brain/code-scan/results - 获取历史扫描结果
router.get('/results', async (req, res) => {
  try {
    const { limit = '50', offset = '0', scan_type } = req.query;

    let query = `SELECT * FROM code_scan_results`;
    const params = [];

    if (scan_type) {
      query += ` WHERE scan_type = $${params.length + 1}`;
      params.push(scan_type);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[code-scan] GET /results error:', err.message);
    res.status(500).json({ error: '获取扫描结果失败', details: err.message });
  }
});

export default router;
