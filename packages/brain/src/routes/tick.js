import { Router } from 'express';
import pool from '../db.js';
import { getTickStatus, enableTick, disableTick, _executeTick, runTickSafe, drainTick, getDrainStatus, cancelDrain, getStartupErrors, _check48hReport } from '../tick.js';
import { getCurrentAlertness, setManualOverride, clearManualOverride, evaluateAlertness, ALERTNESS_LEVELS, LEVEL_NAMES } from '../alertness/index.js';

const router = Router();


// ==================== Tick API（Action Loop）====================

/**
 * POST /api/brain/tick
 * 手动触发一次 tick
 */
router.post('/tick', async (req, res) => {
  try {
    const result = await runTickSafe('manual');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute tick', details: err.message });
  }
});

/**
 * GET /api/brain/tick/status
 * 获取 tick 状态
 */
router.get('/tick/status', async (req, res) => {
  try {
    const status = await getTickStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get tick status', details: err.message });
  }
});

/**
 * POST /api/brain/tick/enable
 * 启用自动 tick
 */
router.post('/tick/enable', async (req, res) => {
  try {
    const result = await enableTick();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to enable tick', details: err.message });
  }
});

/**
 * POST /api/brain/tick/disable
 * 禁用自动 tick
 */
router.post('/tick/disable', async (req, res) => {
  try {
    const result = await disableTick();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to disable tick', details: err.message });
  }
});

// ==================== Drain API ====================

/**
 * POST /api/brain/tick/drain
 * Graceful drain — stop dispatching new tasks, let in_progress finish
 */
router.post('/tick/drain', async (req, res) => {
  try {
    const result = await drainTick();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start drain', details: err.message });
  }
});

/**
 * GET /api/brain/tick/drain-status
 * Check drain progress
 */
router.get('/tick/drain-status', async (req, res) => {
  try {
    const result = await getDrainStatus();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get drain status', details: err.message });
  }
});

/**
 * POST /api/brain/tick/drain-cancel
 * Cancel drain mode, resume normal dispatching
 */
router.post('/tick/drain-cancel', (req, res) => {
  try {
    const result = cancelDrain();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel drain', details: err.message });
  }
});

/**
 * GET /api/brain/tick/startup-errors
 * 获取 Tick 启动错误历史，用于诊断 Brain 是否在启动时遇到问题
 */
router.get('/tick/startup-errors', async (req, res) => {
  try {
    const data = await getStartupErrors();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get startup errors', details: err.message });
  }
});

// ==================== Alertness API ====================

/**
 * GET /api/brain/alertness
 * 获取当前警觉级别和状态
 */
router.get('/alertness', async (req, res) => {
  try {
    const alertness = getCurrentAlertness();
    res.json({
      success: true,
      ...alertness,
      levels: ALERTNESS_LEVELS,
      level_names: LEVEL_NAMES
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get alertness', details: err.message });
  }
});

/**
 * POST /api/brain/alertness/evaluate
 * 重新评估警觉级别
 */
router.post('/alertness/evaluate', async (req, res) => {
  try {
    const result = await evaluateAlertness();
    res.json({
      success: true,
      ...result,
      level_name: LEVEL_NAMES[result.level]
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to evaluate alertness', details: err.message });
  }
});

/**
 * POST /api/brain/alertness/override
 * 手动覆盖警觉级别
 * Body: { level: 0-4, reason: "string", duration_minutes?: 30 }
 *
 * Levels: SLEEPING=0, CALM=1, AWARE=2, ALERT=3, PANIC=4
 */
router.post('/alertness/override', async (req, res) => {
  try {
    const { level, reason, duration_minutes = 30 } = req.body;

    if (level === undefined || level < 0 || level > 4) {
      return res.status(400).json({ error: 'level must be 0-4 (SLEEPING=0, CALM=1, AWARE=2, ALERT=3, PANIC=4)' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const durationMs = duration_minutes * 60 * 1000;
    const result = await setManualOverride(level, reason, durationMs);

    res.json({
      success: true,
      level,
      level_name: LEVEL_NAMES[level],
      reason,
      duration_minutes,
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set override', details: err.message });
  }
});

/**
 * POST /api/brain/alertness/clear-override
 * 清除手动覆盖
 */
router.post('/alertness/clear-override', async (req, res) => {
  try {
    const result = await clearManualOverride();
    const alertness = getCurrentAlertness();

    res.json({
      success: result.success,
      current_level: alertness.level,
      current_level_name: LEVEL_NAMES[alertness.level],
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear override', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/metrics
 * 获取最近的系统指标
 */
router.get('/alertness/metrics', async (req, res) => {
  try {
    const { getCurrentAlertness, getMetrics } = await import('./alertness/index.js');
    const metrics = await getMetrics();
    const alertness = getCurrentAlertness();

    res.json({
      success: true,
      alertness: alertness.levelName,
      metrics
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get metrics', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/history
 * 获取历史趋势数据
 */
router.get('/alertness/history', async (req, res) => {
  try {
    const { getHistory } = await import('./alertness/index.js');
    const minutes = parseInt(req.query.minutes || '60', 10);
    const history = await getHistory(minutes);

    res.json({
      success: true,
      minutes,
      count: history.length,
      history
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get history', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/diagnosis
 * 获取当前诊断结果
 */
router.get('/alertness/diagnosis', async (req, res) => {
  try {
    const { getDiagnosis } = await import('./alertness/index.js');
    const diagnosis = getDiagnosis();

    res.json({
      success: true,
      diagnosis: diagnosis || { issues: [], severity: 'none', summary: 'No diagnosis available' }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get diagnosis', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/escalation
 * 获取升级响应状态
 */
router.get('/alertness/escalation', async (req, res) => {
  try {
    const { getEscalationStatus } = await import('./alertness/escalation.js');
    const status = getEscalationStatus();

    res.json({
      success: true,
      escalation: status
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get escalation status', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/healing
 * 获取自愈恢复状态
 */
router.get('/alertness/healing', async (req, res) => {
  try {
    const { getRecoveryStatus } = await import('./alertness/healing.js');
    const status = getRecoveryStatus();

    res.json({
      success: true,
      healing: status
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get healing status', details: err.message });
  }
});


// ==================== Billing Pause API ====================

/**
 * GET /api/brain/billing-pause
 * 返回当前 billing pause 状态（配额耗尽熔断）
 */
router.get('/billing-pause', async (req, res) => {
  try {
    const { getBillingPause, clearBillingPause } = await import('./executor.js');
    const pause = getBillingPause();
    if (req.query.clear === 'true') {
      const cleared = clearBillingPause();
      return res.json({ success: true, cleared: cleared.cleared, previous: cleared.previous });
    }
    res.json({ success: true, ...pause });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get billing pause status', details: err.message });
  }
});

// ==================== Watchdog API ====================

/**
 * GET /api/brain/watchdog
 * 资源看门狗诊断 - 每个任务的实时 RSS/CPU/采样数/阈值
 */
router.get('/watchdog', async (req, res) => {
  try {
    const { getWatchdogStatus } = await import('./watchdog.js');
    const status = getWatchdogStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get watchdog status', details: err.message });
  }
});

/**
 * GET /api/brain/watchdog/trends
 * 资源趋势分析 - RSS 趋势、预测告警、快速增长标记
 */
router.get('/watchdog/trends', async (req, res) => {
  try {
    const { getWatchdogTrends } = await import('./watchdog.js');
    const trends = getWatchdogTrends();
    res.json({ success: true, ...trends });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get watchdog trends', details: err.message });
  }
});

// ==================== Session Tracking API ====================

/**
 * GET /api/brain/session/stats
 * 返回当前 session 开始时间、已运行分钟数、历史 session 记录（最近 10 条）
 * 用于分析 Anthropic spending cap 周期
 */
router.get('/session/stats', async (req, res) => {
  try {
    const { getSessionInfo } = await import('./executor.js');
    const current = getSessionInfo();

    // 查询最近 10 条历史 session 记录
    const historyResult = await pool.query(`
      SELECT payload, created_at
      FROM cecelia_events
      WHERE event_type = 'session_end'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const history = historyResult.rows.map(row => ({
      ...row.payload,
      recorded_at: row.created_at,
    }));

    res.json({
      success: true,
      current,
      history,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get session stats', details: err.message });
  }
});

// ==================== Token Usage API ====================

/**
 * GET /api/brain/token-usage
 * Token 消耗统计（今日 / 本周 / 本月 / 按 source 分组）
 */
router.get('/token-usage', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        source,
        payload->>'model' as model,
        COUNT(*) as calls,
        SUM((payload->>'input_tokens')::int) as input_tokens,
        SUM((payload->>'output_tokens')::int) as output_tokens,
        SUM((payload->>'total_tokens')::int) as total_tokens,
        ROUND(SUM((payload->>'cost_usd')::numeric)::numeric, 4) as cost_usd
      FROM cecelia_events
      WHERE event_type = 'token_usage'
        AND created_at >= CURRENT_DATE
      GROUP BY source, payload->>'model'
      ORDER BY cost_usd DESC
    `);

    const totalToday = result.rows.reduce((s, r) => s + parseFloat(r.cost_usd || 0), 0);

    res.json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      total_cost_usd: Math.round(totalToday * 10000) / 10000,
      breakdown: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get token usage', details: err.message });
  }
});


export default router;
