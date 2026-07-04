/**
 * Agent Credit 路由
 *
 * GET  /api/brain/agent/credit/balance?license_key=  — 查询积分余额
 * POST /api/brain/agent/credit/deduct                — 扣除积分
 *   Body: { license_key, amount, description? }
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /agent/credit/balance?license_key=CECE-...
router.get('/agent/credit/balance', async (req, res) => {
  try {
    const { license_key } = req.query;
    if (!license_key) {
      return res.status(400).json({ error: '缺少 license_key' });
    }

    const { rows } = await pool.query(
      `SELECT id, license_key, tier, credit_balance, status FROM licenses WHERE license_key = $1`,
      [license_key]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'License 不存在' });
    }

    const lic = rows[0];
    if (lic.status === 'revoked') {
      return res.status(403).json({ error: 'License 已被吊销' });
    }

    return res.json({
      license_key: lic.license_key,
      tier: lic.tier,
      credit_balance: parseFloat(lic.credit_balance),
    });
  } catch (err) {
    console.error('[agent-credit] balance error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /agent/credit/deduct
// Body: { license_key, amount, description? }
router.post('/agent/credit/deduct', async (req, res) => {
  try {
    const { license_key, amount, description } = req.body || {};

    if (!license_key) {
      return res.status(400).json({ error: '缺少 license_key' });
    }
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'amount 必须为正数' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 锁行防并发
      const { rows } = await client.query(
        `SELECT id, credit_balance, status FROM licenses WHERE license_key = $1 FOR UPDATE`,
        [license_key]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'License 不存在' });
      }

      const lic = rows[0];
      if (lic.status === 'revoked') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'License 已被吊销' });
      }

      const currentBalance = parseFloat(lic.credit_balance);
      if (currentBalance < amt) {
        await client.query('ROLLBACK');
        return res.status(402).json({
          error: '积分余额不足',
          credit_balance: currentBalance,
          required: amt,
        });
      }

      const newBalance = parseFloat((currentBalance - amt).toFixed(2));

      await client.query(
        `UPDATE licenses SET credit_balance = $1 WHERE id = $2`,
        [newBalance, lic.id]
      );

      await client.query(
        `INSERT INTO license_credit_transactions (license_id, amount, balance_after, description)
         VALUES ($1, $2, $3, $4)`,
        [lic.id, -amt, newBalance, description || null]
      );

      await client.query('COMMIT');

      return res.json({
        success: true,
        deducted: amt,
        credit_balance: newBalance,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[agent-credit] deduct error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
