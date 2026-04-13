/**
 * KR3 小程序配置状态路由
 *
 * GET  /kr3/check-config         — 查询 KR3 前置配置状态（WX_PAY + AdminOID）
 * POST /kr3/mark-wx-pay          — 标记 WX_PAY 环境变量已配置完成
 * POST /kr3/mark-admin-oid       — 标记管理员 OpenID 已初始化
 */

import { Router } from 'express';
import {
  checkKR3ConfigDB,
  markWxPayConfigured,
  markAdminOidInitialized,
} from '../kr3-config-checker.js';

const router = Router();

/**
 * GET /kr3/check-config
 * 返回 KR3 上线前置配置的当前状态。
 */
router.get('/check-config', async (req, res) => {
  try {
    const config = await checkKR3ConfigDB();
    const allReady = config.wxPayConfigured && config.adminOidReady;
    res.json({
      ok: true,
      allReady,
      ...config,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/mark-wx-pay
 * body: { note?: string }
 *
 * 标记微信支付商户号环境变量已在云控制台配置完成。
 * 调用后 Brain 将把 WX_PAY 配置状态标记为就绪。
 */
router.post('/mark-wx-pay', async (req, res) => {
  try {
    const { note } = req.body || {};
    await markWxPayConfigured(undefined, note || '已配置');
    res.json({ ok: true, message: 'WX_PAY 配置状态已标记为就绪' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/mark-admin-oid
 * body: { note?: string }
 *
 * 标记管理员 OpenID 已通过 bootstrapAdmin 初始化。
 */
router.post('/mark-admin-oid', async (req, res) => {
  try {
    const { note } = req.body || {};
    await markAdminOidInitialized(undefined, note || '已初始化');
    res.json({ ok: true, message: '管理员 OpenID 初始化状态已标记' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
