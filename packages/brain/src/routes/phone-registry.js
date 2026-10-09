/**
 * 手机台账 API（任务 b923b1f7，决策 432172f7 方案 C）。
 *
 *   GET /api/brain/phone-registry          全量行（含 disabled），按 serial 排序
 *   PUT /api/brain/phone-registry/:serial  upsert（internalAuthOrLoopback，不裸奔）
 *
 * phone_registry（迁移 490）是 昵称/别名/技术名/抖音号 → 手机 的唯一真身，秋米路由按它定手机
 * （routing/phone-resolver.js）。PUT 只改请求里出现的字段：没传的列在冲突更新时保留台账原值，
 * 停用一台只需 {"enabled": false}（走 UPDATE，台账里没有这台回 404）；新增必须带 nickname。
 */
import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

const router = Router();

const COLUMNS = 'serial, nickname, aliases, host, profile, model, owner, role, douyin_accounts, wechat, enabled, updated_at, updated_by';
const SERIAL_RE = /^[A-Za-z0-9._-]{1,64}$/;
const TEXT_FIELDS = ['nickname', 'host', 'profile', 'model', 'owner', 'role', 'updated_by'];

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function validAccounts(list) {
  if (!Array.isArray(list)) return false;
  const shapeOk = list.every((a) => a && typeof a === 'object' && !Array.isArray(a)
    && isNonEmptyString(a.nickname)
    && (a.id === undefined || a.id === null || isNonEmptyString(a.id))
    && (a.current === undefined || typeof a.current === 'boolean'));
  return shapeOk && list.filter((a) => a.current === true).length <= 1;
}

/** 校验并挑出本次要写的字段；返回 { fields } 或 { error }。 */
export function pickPhoneFields(body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const fields = {};
  for (const k of TEXT_FIELDS) {
    if (b[k] === undefined) continue;
    if (k === 'nickname' ? !isNonEmptyString(b[k]) : !(b[k] === null || typeof b[k] === 'string')) return { error: `${k} 非法` };
    fields[k] = k === 'nickname' ? b[k].trim() : b[k];
  }
  if (b.aliases !== undefined) {
    if (!Array.isArray(b.aliases) || !b.aliases.every(isNonEmptyString)) return { error: 'aliases 必须是非空字符串数组' };
    fields.aliases = b.aliases.map((x) => x.trim());
  }
  if (b.douyin_accounts !== undefined) {
    if (!validAccounts(b.douyin_accounts)) return { error: 'douyin_accounts 必须是 [{id?, nickname, current?}]，且最多一个 current' };
    fields.douyin_accounts = b.douyin_accounts.map((a) => ({ id: a.id ?? null, nickname: a.nickname.trim(), current: a.current === true }));
  }
  if (b.wechat !== undefined) {
    if (!(b.wechat === null || (typeof b.wechat === 'object' && !Array.isArray(b.wechat)))) return { error: 'wechat 必须是对象或 null' };
    fields.wechat = b.wechat;
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { error: 'enabled 必须是布尔值' };
    fields.enabled = b.enabled;
  }
  if (Object.keys(fields).length === 0) return { error: '没有可写字段' };
  return { fields };
}

const JSONB_FIELDS = new Set(['douyin_accounts', 'wechat']);

router.get('/phone-registry', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM phone_registry ORDER BY serial`);
    res.json({ phones: rows, count: rows.length });
  } catch (err) {
    console.error('[phone-registry] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/phone-registry/:serial', internalAuthOrLoopback, async (req, res) => {
  const serial = String(req.params.serial ?? '');
  if (!SERIAL_RE.test(serial)) return res.status(400).json({ error: 'serial 非法（1-64 位字母数字 . _ -）' });
  const { fields, error } = pickPhoneFields(req.body);
  if (error) return res.status(400).json({ error });

  const cols = Object.keys(fields);
  const values = cols.map((c) => (JSONB_FIELDS.has(c) ? JSON.stringify(fields[c]) : fields[c]));
  const placeholders = cols.map((c, i) => (JSONB_FIELDS.has(c) ? `$${i + 2}::jsonb` : `$${i + 2}`));
  const assigns = cols.map((c, i) => `${c} = ${placeholders[i]}`);
  // 不带 nickname = 改已有行：走 UPDATE（INSERT…ON CONFLICT 会先撞 nickname NOT NULL，轮不到冲突分支）
  const sql = fields.nickname === undefined
    ? `UPDATE phone_registry SET ${[...assigns, 'updated_at = NOW()'].join(', ')} WHERE serial = $1 RETURNING ${COLUMNS}`
    : `INSERT INTO phone_registry (serial, ${cols.join(', ')})
    VALUES ($1, ${placeholders.join(', ')})
    ON CONFLICT (serial) DO UPDATE SET ${[...cols.map((c) => `${c} = EXCLUDED.${c}`), 'updated_at = NOW()'].join(', ')}
    RETURNING ${COLUMNS}`;
  try {
    const { rows } = await pool.query(sql, [serial, ...values]);
    if (!rows.length) return res.status(404).json({ error: '台账里还没有这台手机，新增必须带 nickname' });
    res.json({ phone: rows[0] });
  } catch (err) {
    console.error('[phone-registry] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
