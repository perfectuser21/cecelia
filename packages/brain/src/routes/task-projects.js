/**
 * Task Projects route (migrated from apps/api/src/task-system/projects.js)
 *
 * GET /        — 列出所有项目（支持多种过滤参数）
 * GET /:id     — 获取单个 project（供 /decomp Phase 2 读取 Initiative/Project 信息）
 * PATCH /:id   — 更新 project 字段（status/description/name，供 /decomp 标记 Initiative 完成）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /projects — 列出项目（支持 workspace_id, area_id, status, parent_id, kr_id, type, top_level 过滤）
router.get('/', async (req, res) => {
  try {
    const { workspace_id, area_id, status, parent_id, top_level, kr_id, type } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (workspace_id) {
      conditions.push(`workspace_id = $${paramIndex++}`);
      params.push(workspace_id);
    }
    if (area_id) {
      conditions.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (parent_id) {
      conditions.push(`parent_id = $${paramIndex++}`);
      params.push(parent_id);
    } else if (top_level === 'true') {
      conditions.push('parent_id IS NULL');
    }
    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(type);
    }
    // kr_id 过滤：通过 project_kr_links 关联查询
    if (kr_id) {
      conditions.push(`id IN (SELECT project_id FROM project_kr_links WHERE kr_id = $${paramIndex++})`);
      params.push(kr_id);
    }

    let query = 'SELECT * FROM projects';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list projects', details: err.message });
  }
});

// GET /projects/compare — 跨项目对比指标（含 KR 进度 + 历史趋势）
// 必须在 /:id 之前注册，否则 "compare" 会被当作 UUID 拦截
router.get('/compare', async (req, res) => {
  try {
    const { ids, format = 'json', trend_weeks = '4' } = req.query;
    const project_ids = ids ? ids.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (project_ids.length < 2) {
      return res.status(400).json({ success: false, error: 'ids must contain at least 2 project UUIDs' });
    }
    const weeks = Math.min(Math.max(parseInt(trend_weeks, 10) || 4, 1), 12);
    const { getCompareMetrics } = await import('../project-compare.js');
    const result = await getCompareMetrics({ project_ids, format, trend_weeks: weeks });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// POST /projects/compare/report — 跨项目对比报告生成
router.post('/compare/report', async (req, res) => {
  try {
    const { project_ids, format = 'json', include_tasks = false } = req.body;
    const { generateCompareReport } = await import('../project-compare.js');
    const report = await generateCompareReport({ project_ids, format, include_tasks });
    res.json(report);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// POST /projects/compare/report/push — 推送对比报告到指定目标（当前支持 notion）
router.post('/compare/report/push', async (req, res) => {
  try {
    const { project_ids, destination, format = 'markdown', notion_parent_id } = req.body;

    if (destination !== 'notion') {
      return res.status(400).json({
        success: false,
        error: `不支持的推送目标: ${destination}，当前仅支持 "notion"`,
      });
    }

    const { pushCompareReportToNotion } = await import('../project-compare.js');
    const result = await pushCompareReportToNotion({ project_ids, format, notion_parent_id });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    const body = { success: false, error: err.message };
    if (err.code) body.code = err.code;
    res.status(status).json(body);
  }
});

// POST /projects/compare/report/push-notion — 推送对比报告到 Notion
// 无 NOTION_API_TOKEN 时返回 501
router.post('/compare/report/push-notion', async (req, res) => {
  const notionToken = process.env.NOTION_API_TOKEN;
  if (!notionToken) {
    return res.status(501).json({ success: false, error: 'Notion 未配置（NOTION_API_TOKEN 未设置）' });
  }

  try {
    const { project_ids } = req.body;
    if (!Array.isArray(project_ids) || project_ids.length < 2) {
      return res.status(400).json({ success: false, error: 'project_ids must contain at least 2 UUIDs' });
    }

    // 生成 markdown 格式报告
    const { generateCompareReport } = await import('../project-compare.js');
    const report = await generateCompareReport({ project_ids, format: 'markdown', include_tasks: false });

    const dateStr = new Date().toISOString().slice(0, 10);
    const pageTitle = `项目对比报告 ${dateStr}`;
    const markdownContent = report.markdown || report.summary || '';

    // 将 markdown 转换为 Notion blocks（简化版：段落 blocks）
    const blocks = markdownContent
      .split('\n')
      .filter(line => line.trim())
      .slice(0, 100) // Notion 单次最多 100 blocks
      .map(line => {
        if (line.startsWith('# ')) {
          return { object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2).trim() } }] } };
        }
        if (line.startsWith('## ')) {
          return { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3).trim() } }] } };
        }
        if (line.startsWith('### ')) {
          return { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4).trim() } }] } };
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2).trim() } }] } };
        }
        return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line.trim() } }] } };
      });

    // 获取父页面：使用 NOTION_PAGE_ID 指定，否则使用 workspace 根
    const parentPageId = process.env.NOTION_PAGE_ID;
    const parent = parentPageId
      ? { type: 'page_id', page_id: parentPageId }
      : { type: 'workspace', workspace: true };

    // 调用 Notion REST API 创建页面
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        parent,
        properties: {
          title: { title: [{ type: 'text', text: { content: pageTitle } }] },
        },
        children: blocks,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return res.status(502).json({ success: false, error: errBody.message || `Notion API 返回 ${response.status}` });
    }

    const page = await response.json();
    const pageId = page.id;
    const notionUrl = `https://notion.so/${pageId.replace(/-/g, '')}`;

    res.json({ success: true, notion_url: notionUrl, page_id: pageId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /projects/:id — 获取单个 project
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Project not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get project', details: err.message });
  }
});

// PATCH /projects/:id — 更新 project 字段（status / description / name / priority / progress / area_id）
router.patch('/:id', async (req, res) => {
  try {
    const { status, description, name, priority, progress, area_id } = req.body;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(description);
    }
    if (name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    if (priority !== undefined) {
      setClauses.push(`priority = $${paramIndex++}`);
      params.push(priority);
    }
    if (progress !== undefined) {
      setClauses.push(`progress = $${paramIndex++}`);
      params.push(progress);
    }
    if (area_id !== undefined) {
      setClauses.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE projects SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Project not found', id: req.params.id });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project', details: err.message });
  }
});

export default router;
