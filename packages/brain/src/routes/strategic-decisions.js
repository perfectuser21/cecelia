/**
 * Strategic Decisions 路由
 *
 * 服务 decisions 表中的战略决策（category/topic/decision/reason/status）
 * 区别于丘脑决策日志（/api/brain/decisions → brainRoutes）
 *
 * GET  /api/brain/strategic-decisions        — 列表（?status=active&limit=100&made_by=user&author=xxx）
 * POST /api/brain/strategic-decisions        — 新建决策
 * PUT  /api/brain/strategic-decisions/:id    — 更新状态/内容
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_STATUSES = ['active', 'executed', 'expired'];

// category 允许值唯一真身 = 数据库约束 decisions_category_chk（不手抄副本）
const CATEGORY_CONSTRAINT = 'decisions_category_chk';
let allowedCategoriesCache = null;

/**
 * 从 decisions_category_chk 约束定义解析允许的 category 列表。
 * 成功结果缓存；{ fresh: true } 绕过缓存重查。
 * 返回 { values }：values 为数组；库里没有该约束时为 null（不限制取值）。
 * 查询失败返回 { unavailable: true }；有旧缓存时退回旧缓存（不缓存失败）。
 */
export async function loadAllowedCategories({ fresh = false } = {}) {
  if (allowedCategoriesCache && !fresh) return { values: allowedCategoriesCache };
  try {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'decisions'::regclass AND conname = $1`,
      [CATEGORY_CONSTRAINT]
    );
    const def = rows?.[0]?.def;
    if (typeof def !== 'string') return { values: null };
    const values = [...new Set([...def.matchAll(/'([^']+)'::/g)].map((m) => m[1]))].sort();
    if (values.length === 0) return { values: null };
    allowedCategoriesCache = values;
    return { values };
  } catch (err) {
    console.error('[strategic-decisions] load categories error:', err.message);
    if (allowedCategoriesCache) return { values: allowedCategoriesCache };
    return { unavailable: true };
  }
}

export function _resetAllowedCategoriesCache() {
  allowedCategoriesCache = null;
}

const CATEGORIES_UNAVAILABLE = {
  status: 503,
  body: { success: false, error: 'category 允许值暂时无法读取，请稍后重试' },
};

function categoryRejection(loaded) {
  if (loaded.unavailable || !loaded.values) return CATEGORIES_UNAVAILABLE;
  return {
    status: 400,
    body: {
      success: false,
      error: `category 非法，合法值：${loaded.values.join('|')}`,
      allowed_categories: loaded.values,
    },
  };
}

/**
 * 校验 category。返回 null 表示放行，否则返回 { status, body }。
 * 允许值读不到（且无缓存）时不放行：返回 503，非法值绝不进 INSERT。
 */
async function checkCategory(category) {
  if (category === undefined || category === null || category === '') return null;
  if (typeof category !== 'string') {
    return categoryRejection(await loadAllowedCategories());
  }
  const cached = await loadAllowedCategories();
  if (cached.unavailable) return CATEGORIES_UNAVAILABLE;
  if (!cached.values || cached.values.includes(category)) return null;
  const fresh = await loadAllowedCategories({ fresh: true });
  if (!fresh.values || fresh.values.includes(category)) return null;
  return categoryRejection(fresh);
}

/**
 * GET /
 * 查询战略决策列表
 * 支持 ?status=active|executed|expired&limit=100&category=xxx
 */
router.get('/', async (req, res) => {
  try {
    const { status, category, made_by, author, limit = '100' } = req.query;
    const params = [];
    const conditions = ['category IS NOT NULL'];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (made_by) {
      params.push(made_by);
      conditions.push(`made_by = $${params.length}`);
    }
    if (author) {
      params.push(author);
      conditions.push(`author = $${params.length}`);
    }

    params.push(parseInt(limit, 10) || 100);
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await pool.query(
      `SELECT id, category, topic, decision, reason, status, confidence,
              author, made_by, priority, area, alternatives, decided_at,
              executed_at, created_at, updated_at
       FROM decisions
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({ success: true, data: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('[strategic-decisions] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /
 * 新建战略决策
 * Body: { category, topic, decision, reason, status? }
 */
router.post('/', async (req, res) => {
  try {
    const {
      category, topic, decision, reason, status = 'active',
      author = 'user', made_by = 'user', priority = 'P2',
      area = null, alternatives = null, decided_at = null,
      source_ref = null,
    } = req.body;

    if (!topic || !decision) {
      return res.status(400).json({ success: false, error: 'topic 和 decision 为必填项' });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: `status 非法，合法值：${VALID_STATUSES.join('|')}` });
    }

    const rejection = await checkCategory(category);
    if (rejection) return res.status(rejection.status).json(rejection.body);

    const result = await pool.query(
      `INSERT INTO decisions
         (category, topic, decision, reason, status, trigger, author, made_by, priority, area, alternatives, decided_at, source_ref)
       VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, category, topic, decision, reason, status, author, made_by, priority, created_at`,
      [category || 'general', topic, decision, reason || null, status,
       author, made_by, priority, area, alternatives, decided_at, source_ref]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[strategic-decisions] POST error:', err.message);
    if (err.code === '23514' && err.constraint === CATEGORY_CONSTRAINT) {
      const rejection = categoryRejection(await loadAllowedCategories({ fresh: true }));
      return res.status(rejection.status).json(rejection.body);
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /:id
 * 更新决策状态或内容
 * Body: { status?, reason?, decision? }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason, decision, executed_at } = req.body;

    const sets = [];
    const params = [];

    if (status !== undefined) {
      params.push(status);
      sets.push(`status = $${params.length}`);
    }
    if (reason !== undefined) {
      params.push(reason);
      sets.push(`reason = $${params.length}`);
    }
    if (decision !== undefined) {
      params.push(decision);
      sets.push(`decision = $${params.length}`);
    }
    if (executed_at !== undefined) {
      params.push(executed_at);
      sets.push(`executed_at = $${params.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, error: '没有可更新的字段' });
    }

    sets.push('updated_at = NOW()');
    params.push(id);

    const result = await pool.query(
      `UPDATE decisions SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, category, topic, decision, reason, status, updated_at`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Decision not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[strategic-decisions] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
