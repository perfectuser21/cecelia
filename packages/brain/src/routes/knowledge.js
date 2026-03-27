/**
 * Knowledge 路由 — 知识库查询 API
 *
 * GET /api/brain/knowledge
 *   查询参数：type（过滤类型，如 learning_rule）
 *   返回：knowledge 条目列表
 *
 * GET /api/brain/knowledge/modules
 *   返回：docs/knowledge/BACKLOG.yaml 解析后的模块列表，按 brain/engine/system/workflows 分组
 */

/* global console, URL */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import pool from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// BACKLOG.yaml 位于 repo 根目录 docs/knowledge/
const BACKLOG_PATH = resolve(__dirname, '../../../../docs/knowledge/BACKLOG.yaml');

const router = Router();

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

/**
 * GET /modules
 * 解析 docs/knowledge/BACKLOG.yaml，按4个模块分组返回结构化数据
 */
router.get('/modules', (req, res) => {
  try {
    const raw = readFileSync(BACKLOG_PATH, 'utf8');
    const data = yamlLoad(raw);
    const GROUPS = ['brain', 'engine', 'system', 'workflows'];
    const result = {};

    for (const group of GROUPS) {
      const items = data[group];
      if (!Array.isArray(items)) {
        result[group] = [];
        continue;
      }
      result[group] = items.map(item => ({
        id: item.id,
        title: item.title,
        desc: item.desc || '',
        priority: item.priority || 'P2',
        status: item.status || 'todo',
        source_files: item.source_files || [],
        output_url: item.output_url || item.output || null,
      }));
    }

    res.json({
      meta: data.meta || {},
      groups: result,
    });
  } catch (err) {
    console.error('[API] knowledge /modules error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
