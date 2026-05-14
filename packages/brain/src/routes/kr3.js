/**
 * KR3 小程序配置状态路由
 *
 * GET  /kr3/check-config                       — 查询 KR3 前置配置状态（WX_PAY + AdminOID）
 * GET  /kr3/local-credentials-status           — 查看本地凭据文件配置状态（不暴露值）
 * GET  /kr3/progress                           — 查询 KR3 当前真实进度（calculator 计算）
 * POST /kr3/auto-mark-wx-pay                   — 读本地凭据文件，若齐全则自动标记 DB
 * POST /kr3/mark-wx-pay                        — 手动标记 WX_PAY 环境变量已配置完成
 * POST /kr3/mark-admin-oid                     — 标记管理员 OpenID 已初始化
 * POST /kr3/mark-cloud-functions-deployed      — 标记 9 个云函数已部署到生产（+10%）
 * POST /kr3/mark-internal-test-started         — 标记内测已启动（+5%）
 * POST /kr3/mark-real-device-bugs-cleared      — 标记真机 bug 清单已清零（+3%）
 * POST /kr3/mark-trial-version-submitted       — 标记体验版已提交微信审核（+5%）
 * POST /kr3/mark-audit-passed                  — 标记微信审核已通过（+12%）
 */

import { Router } from 'express';
import {
  checkKR3ConfigDB,
  markWxPayConfigured,
  markAdminOidInitialized,
  markKR3Milestone,
  readLocalPayCredentials,
  autoMarkKR3IfLocalCredentialsReady,
} from '../kr3-config-checker.js';
import { KR3_MILESTONE_KEYS, calculateAndWrite } from '../kr3-progress-calculator.js';

const router = Router();

/**
 * GET /kr3/check-config
 * 返回 KR3 上线前置配置的当前状态（DB + 本地凭据文件双重来源）。
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
 * GET /kr3/local-credentials-status
 * 返回本地 ~/.credentials/wechat-pay.env 配置状态。
 * 不暴露实际值，只显示每个字段是否已填写。
 */
router.get('/local-credentials-status', (req, res) => {
  try {
    const creds = readLocalPayCredentials();
    res.json({
      ok: true,
      path: '~/.credentials/wechat-pay.env',
      ...creds,
      nextStep: creds.allCredentialsReady
        ? '凭据齐全 — 调用 POST /api/brain/kr3/auto-mark-wx-pay 自动标记 Brain DB'
        : '请登录 https://pay.weixin.qq.com 获取 MCHID/V3_KEY/SERIAL_NO 并填入 ~/.credentials/wechat-pay.env',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/auto-mark-wx-pay
 * 读取本地凭据文件，若 MCHID/V3_KEY/SERIAL_NO/PRIVATE_KEY 均已填写，
 * 自动在 Brain DB 中标记 kr3_wx_pay_configured。
 */
router.post('/auto-mark-wx-pay', async (req, res) => {
  try {
    const result = await autoMarkKR3IfLocalCredentialsReady();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/mark-wx-pay
 * body: { note?: string }
 * 手动标记微信支付商户号已在云控制台配置完成。
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

/**
 * GET /kr3/progress
 * 查询 KR3 当前真实进度（基于 calculator 里程碑计算，不依赖 key_results.progress 陈旧值）。
 */
router.get('/progress', async (req, res) => {
  try {
    const result = await calculateAndWrite();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/mark-cloud-functions-deployed
 * 标记 9 个云函数已部署到生产云环境 zenithjoycloud-8g4ca5pbb5b027e8（+10%）。
 */
router.post('/mark-cloud-functions-deployed', async (req, res) => {
  try {
    const { note } = req.body || {};
    await markKR3Milestone(undefined, KR3_MILESTONE_KEYS.CLOUD_FUNCTIONS_DEPLOYED, note || '9 个云函数已部署');
    const result = await calculateAndWrite();
    res.json({ ok: true, message: '云函数部署已标记', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/mark-internal-test-started
 * 标记内测已启动（5-10 人扫码）（+5%）。
 */
router.post('/mark-internal-test-started', async (req, res) => {
  try {
    const { note } = req.body || {};
    await markKR3Milestone(undefined, KR3_MILESTONE_KEYS.INTERNAL_TEST_STARTED, note || '内测已启动');
    const result = await calculateAndWrite();
    res.json({ ok: true, message: '内测启动已标记', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/mark-real-device-bugs-cleared
 * 标记真机 bug 清单（P0/P1）已全部修复（+3%）。
 */
router.post('/mark-real-device-bugs-cleared', async (req, res) => {
  try {
    const { note } = req.body || {};
    await markKR3Milestone(undefined, KR3_MILESTONE_KEYS.REAL_DEVICE_BUGS_CLEARED, note || '真机 bug 已清零');
    const result = await calculateAndWrite();
    res.json({ ok: true, message: '真机 bug 清零已标记', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/mark-trial-version-submitted
 * 标记已向微信平台提交体验版（+5%）。
 */
router.post('/mark-trial-version-submitted', async (req, res) => {
  try {
    const { note } = req.body || {};
    await markKR3Milestone(undefined, KR3_MILESTONE_KEYS.TRIAL_VERSION_SUBMITTED, note || '体验版已提交');
    const result = await calculateAndWrite();
    res.json({ ok: true, message: '体验版提交已标记', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /kr3/mark-audit-passed
 * 标记微信审核已通过（+12%）。
 */
router.post('/mark-audit-passed', async (req, res) => {
  try {
    const { note } = req.body || {};
    await markKR3Milestone(undefined, KR3_MILESTONE_KEYS.AUDIT_PASSED, note || '审核已通过');
    const result = await calculateAndWrite();
    res.json({ ok: true, message: '微信审核通过已标记', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
