/**
 * Task Projects route（棒1，任务 9e785997，决策 ee4842a6/3feeae3e：迁到 projects 真身表）
 *
 * GET /        — 列出所有项目（从 projects 查询，支持 area_id, status, kr_id 过滤）
 * GET /:id     — 获取单个 project，附 children_count / completed_count（该 project 下非 project 类型任务的统计）
 * POST /       — 新建 project（name 必填；kr_id 若给必须存在于 key_results，否则 400 kr_id_not_key_result）
 * PATCH /:id   — 更新 project 字段（name/title(兼容)/description/status/kr_id/owner_role/start_date/end_date/metadata/area_id）
 *
 * 棒4（决策 ee4842a6/3feeae3e）起：/api/brain/okr/projects（routes/okr-hierarchy.js）
 * 直接 `router.use('/projects', taskProjectsRoutes)` 复用本文件的 router，与
 * /api/brain/projects 是同一份代码、同一张 projects 表，不会读到不同的行。
 * 原 okr_projects 表保留不动，只读历史（migration 499 加了写保护 trigger）。
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// POST /projects — 新建（name 必填；kr_id 若给必须是真实 key_results）
router.post('/', async (req, res) => {
  try {
    const {
      name, description = null, status = 'planning', area_id = null, kr_id = null,
      owner_role = null, start_date = null, end_date = null, metadata = null, custom_props = null,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    if (kr_id) {
      const kr = await pool.query('SELECT id FROM key_results WHERE id = $1', [kr_id]);
      if (!kr.rows.length) {
        return res.status(400).json({ error: 'kr_id_not_key_result', message: `kr_id ${kr_id} 不是 key_results 表里的行` });
      }
    }

    // custom_props 是 NOT NULL DEFAULT '{}'（迁移 497）：显式传 null 会撞 not-null 违例，
    // 未传时必须落回 DB 默认值，COALESCE 兜底（棒4 起 /api/brain/okr/projects 复用本路由，
    // 真库集成测试才把这条撞出来——之前只有 mock 测试覆盖不到 NOT NULL 约束）。
    const result = await pool.query(
      `INSERT INTO projects (name, description, status, area_id, kr_id, owner_role, start_date, end_date, metadata, custom_props)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, '{}'::jsonb)) RETURNING *`,
      [name, description, status, area_id, kr_id, owner_role, start_date, end_date, metadata, custom_props]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create project', details: err.message });
  }
});

// GET /projects — 列出项目（支持 area_id, status, kr_id 过滤）
router.get('/', async (req, res) => {
  try {
    const { area_id, status, kr_id } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (area_id) {
      conditions.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (kr_id) {
      conditions.push(`kr_id = $${paramIndex++}`);
      params.push(kr_id);
    }

    let query = 'SELECT *, name AS title FROM projects';
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

// GET /projects/:id — 获取单个 project（title 兼容旧读方；附 children_count/completed_count）
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    'SELECT *, name AS title FROM projects WHERE id = $1',
    [id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'project not found' });
  const project = result.rows[0];
  const counts = await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'completed')::int AS completed
       FROM tasks WHERE project_id = $1::uuid AND task_type <> 'project'`,
    [id]
  );
  res.json({
    ...project,
    children_count: counts.rows[0]?.total ?? 0,
    completed_count: counts.rows[0]?.completed ?? 0,
  });
});

// PATCH /projects/:id — 更新 project 字段
router.patch('/:id', async (req, res) => {
  try {
    const {
      status, title, name, area_id, owner_role, kr_id, description,
      start_date, end_date, metadata, custom_props,
    } = req.body;

    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    // name 映射到 name 列；title 只是旧读方的兼容别名
    const nameValue = name !== undefined ? name : title;
    if (nameValue !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(nameValue);
    }
    if (description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(description);
    }
    if (area_id !== undefined) {
      setClauses.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (owner_role !== undefined) {
      setClauses.push(`owner_role = $${paramIndex++}`);
      params.push(owner_role);
    }
    if (kr_id !== undefined) {
      setClauses.push(`kr_id = $${paramIndex++}`);
      params.push(kr_id);
    }
    if (start_date !== undefined) {
      setClauses.push(`start_date = $${paramIndex++}`);
      params.push(start_date);
    }
    if (end_date !== undefined) {
      setClauses.push(`end_date = $${paramIndex++}`);
      params.push(end_date);
    }
    if (metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      params.push(metadata);
    }
    if (custom_props !== undefined) {
      setClauses.push(`custom_props = $${paramIndex++}`);
      params.push(custom_props);
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
