// ability_groups（能力轴 L2 子领域）CRUD 端点 —— 供主理人手动维护子领域清单。
// L1 领域 = journeys；L2 子领域 = 本表；L3 提案态 = golden_paths（migration 340 挂 group_id）。
// 校验/错误码风格对齐 routes/golden-paths.js：非法 uuid → 400、不存在 → 404、唯一冲突 → 409。
import express from 'express';
import pool from '../db.js';

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /ability-groups?journey_id= — 列子领域（可按 L1 领域过滤）
router.get('/ability-groups', async (req, res) => {
  try {
    const { journey_id } = req.query;
    if (journey_id !== undefined && !UUID_RE.test(journey_id)) {
      return res.status(400).json({ success: false, error: `invalid journey_id: ${journey_id}` });
    }
    const { rows } = journey_id
      ? await pool.query(
        'SELECT * FROM ability_groups WHERE journey_id = $1 ORDER BY created_at ASC', [journey_id])
      : await pool.query('SELECT * FROM ability_groups ORDER BY created_at ASC');
    res.json({ success: true, ability_groups: rows });
  } catch (err) {
    console.error('[ability-groups] GET 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /ability-groups — 建子领域
router.post('/ability-groups', async (req, res) => {
  try {
    const { name, journey_id } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'name 必填' });
    }
    if (journey_id !== undefined && journey_id !== null && !UUID_RE.test(journey_id)) {
      return res.status(400).json({ success: false, error: `invalid journey_id: ${journey_id}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO ability_groups (name, journey_id)
       VALUES ($1, $2)
       RETURNING *`,
      [String(name).trim(), journey_id || null]
    );
    res.status(201).json({ success: true, ability_group: rows[0] });
  } catch (err) {
    // 同域重名（唯一约束）→ 409
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: '同一领域下子领域名已存在', code: 'DUPLICATE_NAME' });
    }
    // journey_id 指向不存在的 journeys 行（FK 违反）→ 400
    if (err.code === '23503') {
      return res.status(400).json({ success: false, error: 'journey_id 不存在', code: 'INVALID_JOURNEY' });
    }
    console.error('[ability-groups] POST 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /ability-groups/:id — 改名
router.patch('/ability-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ success: false, error: `invalid id: ${id}` });
    }
    const { name } = req.body || {};
    if (name === undefined) {
      return res.status(400).json({ success: false, error: '无可更新字段（仅支持改 name）' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'name 不能为空' });
    }
    const { rows } = await pool.query(
      `UPDATE ability_groups SET name = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [String(name).trim(), id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ability_group not found', code: 'GROUP_NOT_FOUND' });
    }
    res.json({ success: true, ability_group: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: '同一领域下子领域名已存在', code: 'DUPLICATE_NAME' });
    }
    console.error('[ability-groups] PATCH 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /ability-groups/:id — 删子领域（挂在其下的 golden_paths.group_id 由 FK ON DELETE SET NULL 置空）
router.delete('/ability-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ success: false, error: `invalid id: ${id}` });
    }
    const { rows } = await pool.query('DELETE FROM ability_groups WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'ability_group not found', code: 'GROUP_NOT_FOUND' });
    }
    res.json({ success: true, deleted_id: rows[0].id });
  } catch (err) {
    console.error('[ability-groups] DELETE 失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
