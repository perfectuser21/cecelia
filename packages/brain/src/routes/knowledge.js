/**
 * Knowledge 路由 — 知识库查询 API
 *
 * GET /api/brain/knowledge
 *   查询参数：type（过滤类型，如 learning_rule）
 *   返回：knowledge 条目列表
 *
 * GET /api/brain/knowledge/modules
 *   从 docs/knowledge/BACKLOG.yaml 读取知识模块清单
 *   返回：{ meta, groups: [{ id, label, items: [...] }] }
 */

/* global console */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import pool from '../db.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
// BACKLOG.yaml 位于 monorepo 根目录的 docs/knowledge/
const BACKLOG_PATH = join(_dirname, '../../../../docs/knowledge/BACKLOG.yaml');

const router = Router();

const GROUP_LABELS = {
  brain: 'Brain 后端',
  engine: 'Engine 开发引擎',
  workflows: 'Workflows 协议',
  system: 'System 基础设施',
};

/**
 * GET /modules
 * 从 BACKLOG.yaml 读取知识模块清单，按分组返回
 */
router.get('/modules', (req, res) => {
  try {
    const raw = readFileSync(BACKLOG_PATH, 'utf8');
    const data = yaml.load(raw);

    const groups = ['brain', 'engine', 'workflows', 'system']
      .filter(key => Array.isArray(data[key]))
      .map(key => ({
        id: key,
        label: GROUP_LABELS[key] || key,
        items: data[key].map(item => ({
          id: item.id,
          title: item.title,
          desc: item.desc,
          priority: item.priority,
          status: item.status,
          output_url: item.output_url || item.output || null,
          source_files: item.source_files || [],
          completed: item.completed || null,
        })),
      }));

    res.json({
      meta: data.meta || {},
      groups,
    });
  } catch (err) {
    console.error('[API] knowledge/modules GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
