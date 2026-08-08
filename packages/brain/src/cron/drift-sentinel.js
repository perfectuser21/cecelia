/**
 * drift-sentinel.js — G2 部署漂移哨兵（S0 常驻对账）
 *
 * 每 30min 执行一次（由 tick-runner.js 调度，同 launchd-patrol 模式）：
 *   1. fetchMainSha: 获取 origin/main HEAD SHA（网络失败→保守跳过）
 *   2. fetchProdSha: 调 /health 端点获取 git_sha（不可达→保守跳过）
 *   3. SHA 一致 → verdict=ok，清除 driftFirstSeenAt
 *   4. SHA 不一致，首次记录 driftFirstSeenAt，< 30min → verdict=drifting
 *   5. SHA 不一致，≥ 30min → SHA 二次核验，通过后调 brain-deploy.sh → verdict=redeploying，redeployCount++
 *   6. redeployCount ≥ 2 且仍漂移 → 停止重试，sendBark P1，写 issue → verdict=escalated
 *   7. 连续 3 次 network_error → sendBark P2 告警
 *
 * 审计日志格式: [drift_check] sha_main=X sha_prod=Y verdict=<ok|drifting|redeploying|escalated>
 *
 * 禁止：
 *   - INV-01: 不得引入路径判据（changed_paths/file filter/path filter）
 *   - INV-02: 补部署必须走 brain-deploy.sh 全闸，不得绕过
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { raise } from '../alerting.js';
import { sendBark } from '../notifier.js';

// 容器内 cwd = /app，scripts/ 不在镜像里；必须用 REPO_ROOT 或绝对路径定位 brain-deploy.sh
const _filePath = fileURLToPath(import.meta.url);
// drift-sentinel.js 在 packages/brain/src/cron/，向上 4 级到仓库根
const REPO_ROOT = process.env.REPO_ROOT || resolve(dirname(_filePath), '../../../../..');
const BRAIN_DEPLOY_SCRIPT = resolve(REPO_ROOT, 'scripts/brain-deploy.sh');

const execAsync = promisify(exec);

/** 每 30min 触发一次（DRIFT_SENTINEL_INTERVAL_MS 可由 env 覆盖） */
export const DRIFT_SENTINEL_INTERVAL_MS = parseInt(
  process.env.DRIFT_SENTINEL_INTERVAL_MS || String(30 * 60 * 1000),
  10
);

/** 防抖窗口：SHA 首次不一致后，等待 30min 再触发部署 */
export const DRIFT_WINDOW_MS = parseInt(
  process.env.DRIFT_WINDOW_MS || String(30 * 60 * 1000),
  10
);

/** 最大自动补部署次数，超过后上报告警不再重试 */
const MAX_REDEPLOY_COUNT = 2;

/** 连续网络失败次数达到此值时触发 P2 告警 */
const NETWORK_ERROR_BARK_THRESHOLD = 3;

/** KV 状态 key */
const KV_KEY = 'drift_sentinel_state';

// ─────────────────────────────────────────────────────────────────────────────
// DB 状态存取（brain_kv / working_memory 兼容模式）
// ─────────────────────────────────────────────────────────────────────────────

async function loadState(db = pool) {
  try {
    const res = await db.query(
      'SELECT value FROM working_memory WHERE key = $1',
      [KV_KEY]
    );
    if (res.rows.length > 0 && res.rows[0].value) {
      return JSON.parse(res.rows[0].value);
    }
  } catch {
    // 静默降级：首次运行或 working_memory 不含 value 列时
  }
  return {
    driftFirstSeenAt: null,
    redeployCount: 0,
    consecutiveNetworkErrors: 0,
  };
}

async function saveState(state, db = pool) {
  const value = JSON.stringify(state);
  await db.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()`,
    [KV_KEY, value]
  );
}

async function clearDriftState(db = pool) {
  await db.query('DELETE FROM working_memory WHERE key = $1', [KV_KEY]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 默认 SHA 拉取函数（真实网络，可被测试注入覆盖）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从 git ls-remote 或 gh api 获取 origin/main HEAD SHA
 * @returns {Promise<string>} 40 位 SHA
 */
export async function defaultFetchMainSha() {
  try {
    const { stdout } = await execAsync(
      'git ls-remote origin HEAD refs/heads/main 2>/dev/null | head -1 | cut -f1',
      { timeout: 15000 }
    );
    const sha = stdout.trim().split('\n')[0].trim();
    if (sha && sha.length >= 7) return sha;
  } catch {
    // 降级到 gh api
  }
  const repo = process.env.GITHUB_REPO || 'chalexlch/cecelia';
  const { stdout } = await execAsync(
    `gh api repos/${repo}/commits/main --jq .sha`,
    { timeout: 15000 }
  );
  return stdout.trim();
}

/**
 * 调 /health 端点获取生产 git_sha
 * @returns {Promise<string>} git_sha 字段
 */
export async function defaultFetchProdSha() {
  const prodUrl = process.env.BRAIN_PROD_URL || 'https://brain.cecelia.ai';
  const { stdout } = await execAsync(
    `curl -sf --max-time 10 "${prodUrl}/health"`,
    { timeout: 15000 }
  );
  const data = JSON.parse(stdout);
  if (!data.git_sha) throw new Error('health endpoint missing git_sha');
  return data.git_sha;
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心检查逻辑（runDriftCheck — 可注入所有外部依赖，便于单测）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 执行一次漂移检查
 *
 * @param {object} opts 可注入选项（测试专用）
 * @param {() => Promise<string>} [opts.fetchMainSha]
 * @param {() => Promise<string>} [opts.fetchProdSha]
 * @param {Date} [opts.now]
 * @param {object} [opts._testInitialState] 测试专用初始状态注入
 * @param {import('pg').Pool} [opts.db]
 * @returns {Promise<{verdict: string, sha_main?: string, sha_prod?: string}>}
 */
export async function runDriftCheck({
  fetchMainSha = defaultFetchMainSha,
  fetchProdSha = defaultFetchProdSha,
  now = new Date(),
  _testInitialState = null,
  db = pool,
} = {}) {
  // ── 加载持久化状态 ──────────────────────────────────────────────────────────
  let state;
  if (_testInitialState) {
    // 测试模式：直接使用注入的初始状态，不读 DB
    state = {
      driftFirstSeenAt: _testInitialState.driftFirstSeenAt ?? null,
      redeployCount: _testInitialState.redeployCount ?? 0,
      consecutiveNetworkErrors: _testInitialState.consecutiveNetworkErrors ?? 0,
    };
  } else {
    state = await loadState(db);
  }

  const { redeployCount, consecutiveNetworkErrors } = state;
  let { driftFirstSeenAt } = state;

  // ── 1. 拉取 main SHA ───────────────────────────────────────────────────────
  let shaMain;
  try {
    shaMain = await fetchMainSha();
  } catch {
    const newConsecutive = consecutiveNetworkErrors + 1;
    const newState = { ...state, consecutiveNetworkErrors: newConsecutive };
    if (!_testInitialState) await saveState(newState, db);

    // B8: 连续 3 次 network_error → sendBark P2 告警
    if (newConsecutive >= NETWORK_ERROR_BARK_THRESHOLD) {
      const logSuffix = ` consecutive_network_errors=${newConsecutive}`;
      console.log(`[drift_check] sha_main=UNKNOWN sha_prod=UNKNOWN verdict=network_error${logSuffix}`);
      await sendBark(
        '[drift-sentinel] 连续网络失败告警 P2',
        `连续 ${newConsecutive} 次无法获取 main SHA，漂移检查已跳过`,
        { dedupeKey: `network-skip-x${newConsecutive}`, level: 'P2' }
      );
    } else {
      console.log('[drift_check] sha_main=UNKNOWN sha_prod=UNKNOWN verdict=network_error');
    }
    return { verdict: 'network_error' };
  }

  // ── 2. 拉取 prod SHA ───────────────────────────────────────────────────────
  let shaProd;
  try {
    shaProd = await fetchProdSha();
  } catch {
    if (!_testInitialState) await saveState({ ...state, consecutiveNetworkErrors: 0 }, db);
    console.log(`[drift_check] sha_main=${shaMain} sha_prod=UNKNOWN verdict=prod_unreachable`);
    return { verdict: 'prod_unreachable', sha_main: shaMain };
  }

  // ── 3. SHA 对账（INV-01: 不得引入路径判据） ────────────────────────────────
  const isDrifted = shaMain !== shaProd;

  if (!isDrifted) {
    // SHA 一致 → 清除漂移状态
    if (!_testInitialState) await clearDriftState(db);
    console.log(`[drift_check] sha_main=${shaMain} sha_prod=${shaProd} verdict=ok`);
    return { verdict: 'ok', sha_main: shaMain, sha_prod: shaProd };
  }

  // ── 4. SHA 不一致，检查防抖窗口 ───────────────────────────────────────────
  // 重置连续网络错误计数（本次网络正常）
  const nowMs = now.getTime();

  if (!driftFirstSeenAt) {
    // 首次发现漂移，记录时间戳
    driftFirstSeenAt = now.toISOString();
    const newState = { ...state, driftFirstSeenAt, consecutiveNetworkErrors: 0 };
    if (!_testInitialState) await saveState(newState, db);
    console.log(`[drift_check] sha_main=${shaMain} sha_prod=${shaProd} verdict=drifting`);
    return { verdict: 'drifting', sha_main: shaMain, sha_prod: shaProd };
  }

  const firstSeenMs = new Date(driftFirstSeenAt).getTime();
  const driftDurationMs = nowMs - firstSeenMs;

  if (driftDurationMs < DRIFT_WINDOW_MS) {
    // 防抖窗口内，等待
    const newState = { ...state, driftFirstSeenAt, consecutiveNetworkErrors: 0 };
    if (!_testInitialState) await saveState(newState, db);
    console.log(`[drift_check] sha_main=${shaMain} sha_prod=${shaProd} verdict=drifting`);
    return { verdict: 'drifting', sha_main: shaMain, sha_prod: shaProd };
  }

  // ── 5. 防抖窗口已过，检查是否已触发最大次数 ────────────────────────────────
  if (redeployCount >= MAX_REDEPLOY_COUNT) {
    // 已达最大重试次数，上报告警停止重试
    const newState = { ...state, driftFirstSeenAt, consecutiveNetworkErrors: 0 };
    if (!_testInitialState) await saveState(newState, db);
    console.log(`[drift_check] sha_main=${shaMain} sha_prod=${shaProd} verdict=escalated`);

    // INV-02 告警走 sendBark + raise（INV-06）
    await sendBark(
      '[drift-sentinel] 部署漂移告警 P1 — 自动修复失败',
      `补部署已尝试 ${redeployCount} 次仍漂移：main=${shaMain.slice(0, 8)} prod=${shaProd.slice(0, 8)}`,
      { dedupeKey: 'drift-escalated', ttl: 6 * 60 * 60, level: 'P1' }
    );
    await raise('P1', 'drift_escalated', `部署漂移 escalated: sha_main=${shaMain} sha_prod=${shaProd}`);
    return { verdict: 'escalated', sha_main: shaMain, sha_prod: shaProd };
  }

  // ── 6. INV-10 SHA 二次核验：触发部署前再次确认漂移持续 ─────────────────────
  let shaProd2;
  try {
    shaProd2 = await fetchProdSha();
  } catch {
    // 二次核验失败→保守跳过，不触发部署
    const newState = { ...state, driftFirstSeenAt, consecutiveNetworkErrors: 0 };
    if (!_testInitialState) await saveState(newState, db);
    console.log(`[drift_check] sha_main=${shaMain} sha_prod=UNKNOWN verdict=prod_unreachable`);
    return { verdict: 'prod_unreachable', sha_main: shaMain };
  }

  if (shaMain === shaProd2) {
    // 二次核验 SHA 一致（漂移已自行恢复），清除状态
    if (!_testInitialState) await clearDriftState(db);
    console.log(`[drift_check] sha_main=${shaMain} sha_prod=${shaProd2} verdict=ok`);
    return { verdict: 'ok', sha_main: shaMain, sha_prod: shaProd2 };
  }

  // ── 7. 触发自动补部署（INV-02: 必须走 brain-deploy.sh 全闸） ───────────────
  const newRedeployCount = redeployCount + 1;
  const newState = {
    driftFirstSeenAt,
    redeployCount: newRedeployCount,
    consecutiveNetworkErrors: 0,
  };
  if (!_testInitialState) await saveState(newState, db);

  console.log(`[drift_check] sha_main=${shaMain} sha_prod=${shaProd2} verdict=redeploying`);

  // 执行 brain-deploy.sh（INV-02: 不得绕过，必须是这个脚本）
  // cwd 必须显式设为 REPO_ROOT：容器内 cwd=/app，scripts/ 不在镜像里，相对路径 ENOENT。
  await new Promise((resolve, reject) => {
    exec(`bash "${BRAIN_DEPLOY_SCRIPT}"`, { timeout: 300000, cwd: REPO_ROOT }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });

  return { verdict: 'redeploying', sha_main: shaMain, sha_prod: shaProd2, redeployCount: newRedeployCount };
}

/** 模块自 gate（同 launchd-patrol.js 模式）：scheduler-jobs 60s 轮询下保证每 30min 才真跑 */
let lastRunAt = 0;
/** 测试隔离钩子 */
export function _resetLastRunAt() { lastRunAt = 0; }

/**
 * scheduler-jobs.js 调用入口（含 30min 自 gate，fire-and-forget 封装）
 * @param {import('pg').Pool} [db]
 */
export async function runDriftSentinel(db = pool) {
  const now = Date.now();
  if (now - lastRunAt < DRIFT_SENTINEL_INTERVAL_MS) {
    return { skipped: true, reason: 'interval_not_reached' };
  }
  lastRunAt = now;
  try {
    const result = await runDriftCheck({ db });
    return result;
  } catch (err) {
    console.error('[drift-sentinel] unexpected error:', err.message);
    return { verdict: 'error', error: err.message };
  }
}
