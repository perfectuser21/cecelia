/**
 * credentials-health-scheduler.js
 *
 * 凭据健康巡检调度器（Gate 5）
 *
 * 每天北京时间凌晨 03:00（UTC 19:00）巡检所有凭据：
 *   1. NotebookLM  — 通过 bridge 调用 notebooklm auth check --test
 *   2. Claude OAuth (account1/2/3) — 读取 ~/.claude-accountN/.credentials.json expiresAt
 *   3. Codex (team1-5) — 通过 Codex bridge /accounts 验证 token
 *   4. 发布器 cookies — 周期性 P2 提醒人工核查（Windows PC 不可远程访问）
 *
 * 告警级别（via raise()）：
 *   - 已过期 / 检查失败  → P0 告警 + 创建 P0 Brain task
 *   - 7 天内到期         → P0 告警 + 创建 P1 Brain task
 *   - 30 天内到期        → P1 告警 + 创建 P2 Brain task
 *   - 发布器定期提醒     → P2（每次巡检日写一次）
 *
 * 去重：同凭据同级别每日只告警一次（内存 Map，Brain 重启清零；每日 cron 只跑一次保证幂等）
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { raise } from './alerting.js';
import { createTask } from './actions.js';

// ── 告警阈值 ─────────────────────────────────────────────────────────────────

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;
const DAYS_7_MS  =  7 * 24 * 60 * 60 * 1000;

// ── 触发时间窗口：UTC 19:00 = 北京时间 03:00 ─────────────────────────────────

export const TRIGGER_HOUR_UTC = 19;
export const TRIGGER_WINDOW_MINUTES = 5;

// ── 服务地址 ──────────────────────────────────────────────────────────────────

const BRIDGE_URL = process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457';
const CODEX_BRIDGE_URL = process.env.XIAN_CODEX_BRIDGE_URL || 'http://100.86.57.69:3458';

// ── 账号列表 ──────────────────────────────────────────────────────────────────

const CLAUDE_ACCOUNTS = ['account1', 'account2']; // H14: account3 退订（403），见 docs/learnings/cp-0510075509-h14-remove-account3.md
const CODEX_ACCOUNTS  = ['team1', 'team2', 'team3', 'team4', 'team5'];
const PUBLISHER_PLATFORMS = ['douyin', 'xiaohongshu', 'zhihu', 'weibo', 'toutiao', 'kuaishou', 'wechat'];

// ── 内存去重：key → 上次告警时间戳 ────────────────────────────────────────────

const _alertDedup = new Map();
const ALERT_DEDUP_MS = 24 * 60 * 60 * 1000; // 24h 内同凭据同级别只告警一次

/** 测试用：重置去重缓存 */
export function _resetAlertDedup() { _alertDedup.clear(); }

// ── 时间窗口判断 ──────────────────────────────────────────────────────────────

/**
 * 判断是否在每日巡检窗口内（UTC 19:00~19:05）
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInCredentialsHealthWindow(now = new Date()) {
  return now.getUTCHours() === TRIGGER_HOUR_UTC && now.getUTCMinutes() < TRIGGER_WINDOW_MINUTES;
}

// ── 去重检查 ──────────────────────────────────────────────────────────────────

/**
 * 检查今天是否已运行过凭据巡检（DB 去重，任务 type=credentials_health）
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasTodayCredentialsCheck(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM tasks
       WHERE task_type = 'credentials_health'
         AND created_by = 'credentials-health-scheduler'
         AND created_at >= CURRENT_DATE::timestamptz
         AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamptz
       LIMIT 1`
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ── 凭据检查函数 ──────────────────────────────────────────────────────────────

/**
 * 检查 NotebookLM auth 状态（通过 cecelia-bridge 真调 API）
 * @returns {Promise<{ok: boolean, error?: string, elapsed_ms?: number}>}
 */
export async function checkNotebookLmAuth() {
  try {
    const resp = await fetch(`${BRIDGE_URL}/notebook/auth-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(35000),
    });
    const data = await resp.json();
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 读取 Claude OAuth 账号凭据（检查 30d/7d 过期阈值）
 * @returns {Array<{account: string, status: string, remainingMs: number|null, expiresAt?: string, error?: string}>}
 */
export function checkClaudeCredentials() {
  return CLAUDE_ACCOUNTS.map(account => {
    const credPath = `${homedir()}/.claude-${account}/.credentials.json`;
    if (!existsSync(credPath)) {
      return { account, status: 'missing', remainingMs: null };
    }
    try {
      const raw = JSON.parse(readFileSync(credPath, 'utf8'));
      const expiresAtMs = raw?.claudeAiOauth?.expiresAt;
      if (!expiresAtMs) {
        return { account, status: 'unknown', remainingMs: null, error: 'no expiresAt field' };
      }
      const remainingMs = expiresAtMs - Date.now();
      const expiresAt = new Date(expiresAtMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

      let status;
      if (remainingMs < 0) {
        status = 'expired';
      } else if (remainingMs < DAYS_7_MS) {
        status = 'critical';
      } else if (remainingMs < DAYS_30_MS) {
        status = 'warning';
      } else {
        status = 'ok';
      }
      return { account, status, remainingMs, expiresAt };
    } catch (err) {
      return { account, status: 'error', remainingMs: null, error: err.message };
    }
  });
}

/**
 * 检查 Codex 账号 auth 状态（通过 Codex bridge /accounts）
 * @returns {Promise<Array<{account: string, status: string, error?: string}>>}
 */
export async function checkCodexAuth() {
  try {
    const resp = await fetch(`${CODEX_BRIDGE_URL}/accounts`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      return CODEX_ACCOUNTS.map(a => ({
        account: a,
        status: 'bridge_error',
        error: `HTTP ${resp.status}`,
      }));
    }
    const data = await resp.json();

    // bridge 返回格式：{ team1: { used_percent, auth_failed, ... }, ... } 或 数组
    if (Array.isArray(data)) {
      return data.map(item => ({
        account: item.accountId || item.account || 'unknown',
        status: item.auth_failed ? 'expired' : 'ok',
        error: item.error,
      }));
    }
    return CODEX_ACCOUNTS.map(account => {
      const info = data[account] || {};
      return {
        account,
        status: (info.auth_failed || info.error) ? 'expired' : 'ok',
        error: info.error,
      };
    });
  } catch (err) {
    return CODEX_ACCOUNTS.map(a => ({
      account: a,
      status: 'bridge_unreachable',
      error: err.message,
    }));
  }
}

// ── 告警 + 任务创建 ───────────────────────────────────────────────────────────

/**
 * 发送 Feishu 告警并创建 Brain 任务（内存去重）
 * @param {string} credKey  - 去重 key（如 "notebooklm", "claude_account1"）
 * @param {'P0'|'P1'|'P2'} level
 * @param {string} message  - 告警消息
 * @param {'P0'|'P1'|'P2'|null} taskPriority - null 表示不创建任务
 */
async function alertAndMaybeCreateTask(credKey, level, message, taskPriority = null) {
  const dedupKey = `${credKey}_${level}`;
  const lastAlert = _alertDedup.get(dedupKey);
  if (lastAlert && (Date.now() - lastAlert) < ALERT_DEDUP_MS) {
    return;
  }
  _alertDedup.set(dedupKey, Date.now());

  await raise(level, `cred_health_${credKey}`, message);

  if (taskPriority) {
    try {
      await createTask({
        title: `[凭据刷新][${taskPriority}] ${credKey}`,
        task_type: 'credentials_health',
        priority: taskPriority,
        created_by: 'credentials-health-scheduler',
        tags: ['credential-alert', 'auto-generated'],
        payload: { credential: credKey, alert_message: message },
      });
    } catch (err) {
      console.error(`[cred-health] 创建任务失败 (${credKey}):`, err.message);
    }
  }
}

// ── 主调度入口 ────────────────────────────────────────────────────────────────

/**
 * 每天凌晨 03:00（北京时间）运行一次凭据健康巡检
 * @param {import('pg').Pool} pool
 * @param {Date} [now]
 * @returns {Promise<{skipped_window: boolean, skipped_today: boolean, results?: object}>}
 */
export async function runCredentialsHealthCheck(pool, now = new Date()) {
  if (!isInCredentialsHealthWindow(now)) {
    return { skipped_window: true, skipped_today: false };
  }

  try {
    if (await hasTodayCredentialsCheck(pool)) {
      return { skipped_window: false, skipped_today: true };
    }
  } catch { /* 去重失败不阻止执行 */ }

  console.log('[cred-health] 开始凭据健康巡检...');
  const results = {};

  // ── 1. NotebookLM ──────────────────────────────────────────────────────────
  try {
    const nlm = await checkNotebookLmAuth();
    results.notebooklm = nlm;
    if (!nlm.ok) {
      await alertAndMaybeCreateTask(
        'notebooklm', 'P0',
        `🚨 NotebookLM 凭据已过期/失效！去家里电脑跑 'notebooklm login' 然后重启 brain。错误: ${nlm.error || 'auth failed'}`,
        'P0'
      );
    } else {
      console.log('[cred-health] ✅ NotebookLM auth ok');
    }
  } catch (err) {
    console.error('[cred-health] NotebookLM 检查异常:', err.message);
    results.notebooklm = { ok: false, error: err.message };
  }

  // ── 2. Claude OAuth 账号 ───────────────────────────────────────────────────
  try {
    const claudeResults = checkClaudeCredentials();
    results.claude = claudeResults;

    for (const acc of claudeResults) {
      const days = acc.remainingMs != null ? Math.floor(acc.remainingMs / 86400000) : null;
      if (acc.status === 'expired' || acc.status === 'missing') {
        await alertAndMaybeCreateTask(
          `claude_${acc.account}`, 'P0',
          `🚨 Claude ${acc.account} 凭据已过期！去 Claude.ai 重新登录，scp ~/.claude-${acc.account}/.credentials.json 到服务器。`,
          'P0'
        );
      } else if (acc.status === 'critical') {
        await alertAndMaybeCreateTask(
          `claude_${acc.account}`, 'P0',
          `🚨 Claude ${acc.account} 凭据还有 ${days} 天过期（${acc.expiresAt}），请立即刷新！`,
          'P1'
        );
      } else if (acc.status === 'warning') {
        await alertAndMaybeCreateTask(
          `claude_${acc.account}`, 'P1',
          `⚠️ Claude ${acc.account} 凭据还有 ${days} 天过期（${acc.expiresAt}），记得在 30 天内刷新。`,
          'P2'
        );
      } else if (acc.status === 'ok') {
        console.log(`[cred-health] ✅ Claude ${acc.account} ok（还有 ${days} 天）`);
      }
    }
  } catch (err) {
    console.error('[cred-health] Claude OAuth 检查异常:', err.message);
    results.claude = { error: err.message };
  }

  // ── 3. Codex 账号 ──────────────────────────────────────────────────────────
  try {
    const codexResults = await checkCodexAuth();
    results.codex = codexResults;

    const allUnreachable = codexResults.every(a => a.status === 'bridge_unreachable');
    if (allUnreachable) {
      console.warn('[cred-health] Codex bridge 不可达，跳过 Codex 告警');
    } else {
      const failed = codexResults.filter(a => a.status === 'expired');
      if (failed.length > 0) {
        const names = failed.map(a => a.account).join(', ');
        await alertAndMaybeCreateTask(
          'codex', 'P0',
          `🚨 Codex 账号 [${names}] token 已过期！去 chatgpt.com 重新登录，scp ~/.codex-teamN/auth.json 到 ~/.codex-teamN/ 西安机器。`,
          'P0'
        );
      } else {
        const ok = codexResults.filter(a => a.status === 'ok').length;
        console.log(`[cred-health] ✅ Codex ${ok}/${CODEX_ACCOUNTS.length} 账号 ok`);
      }
    }
  } catch (err) {
    console.error('[cred-health] Codex 检查异常:', err.message);
    results.codex = { error: err.message };
  }

  // ── 4. 发布器 cookies（Windows PC，无法远程检查，发 P2 定期提醒）─────────────
  try {
    results.publishers = { platforms: PUBLISHER_PLATFORMS, status: 'manual_check_required' };
    await alertAndMaybeCreateTask(
      'publishers', 'P2',
      `📋 发布器 cookie 周期性提醒（${PUBLISHER_PLATFORMS.join(' / ')}）。` +
      `去 Windows PC 打开各平台主页验证登录状态；失效则用 Playwright 重新录制 cookie。`,
      null
    );
  } catch (err) {
    console.error('[cred-health] 发布器提醒失败:', err.message);
  }

  // ── 记录本次巡检（DB 去重 sentinel）────────────────────────────────────────
  try {
    await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority, created_by, payload, trigger_source, location)
       VALUES ($1, 'credentials_health', 'completed', 'P3', 'credentials-health-scheduler', $2, 'brain_auto', 'us')`,
      [
        `[cred-health] 凭据巡检完成 ${now.toISOString().slice(0, 10)}`,
        JSON.stringify({ results, checked_at: now.toISOString() }),
      ]
    );
  } catch (err) {
    console.warn('[cred-health] 记录巡检结果失败 (non-fatal):', err.message);
  }

  console.log('[cred-health] 凭据健康巡检完成');
  return { skipped_window: false, skipped_today: false, results };
}
