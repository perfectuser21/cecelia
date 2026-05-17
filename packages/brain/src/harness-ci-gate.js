/**
 * Harness v2 M4 — CI Gate 非 LLM 节点
 *
 * 轮询 GitHub Actions 状态，供 harness-graph.js 的 ci_gate 节点调用。
 * 不跑 Docker，不调 LLM — 纯 gh CLI 查询。
 *
 * 三个返回状态：
 *   - { status: 'PASS', checks }                   — 所有 required check 为 SUCCESS
 *   - { status: 'FAIL', failedCheck, logSnippet }  — 任一 check 为 FAILURE
 *   - { status: 'TIMEOUT', checks }                — 超过 timeoutMs（默认 30 min）
 *
 * Usage:
 *   import { pollPRChecks } from './harness-ci-gate.js';
 *   const result = await pollPRChecks(prUrl, { intervalMs: 30000, timeoutMs: 1800000 });
 *
 * 测试注入：
 *   pollPRChecks(url, { exec: mockExec, sleep: mockSleep })
 */

import { execSync } from 'child_process';

const DEFAULT_INTERVAL_MS = 30 * 1000;       // 30 秒
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;   // 30 分钟
const LOG_SNIPPET_MAX_BYTES = 4000;

/**
 * 跑一次 gh pr checks --json，返回解析后的数组。
 *
 * --required 只查必需 check，不受 flaky 非必需 check 干扰；
 * 如果用户 repo 没配 required check，gh 会返回全部 check，一样能判断。
 *
 * @param {string}   prUrl
 * @param {Function} exec   execSync 等价物（测试注入用）
 * @returns {Array<{name, state, bucket, workflow, link}>}
 */
function runGhChecks(prUrl, exec) {
  const raw = exec(
    `gh pr checks ${JSON.stringify(prUrl)} --json name,state,bucket,workflow,link --required`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const str = typeof raw === 'string' ? raw : (raw ? raw.toString('utf8') : '');
  try {
    const arr = JSON.parse(str || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * 取某个失败 check 的日志片段（最多 4KB）。
 *
 * gh run view <run-id> --log-failed 输出失败 job 的完整 log；
 * 截取最后 LOG_SNIPPET_MAX_BYTES 注入 Generator 的 Fix prompt。
 *
 * @param {string|null|undefined} link
 * @param {Function}              exec
 * @returns {string}
 */
function fetchLogSnippet(link, exec) {
  if (!link) return '';
  // link 形如 https://github.com/<owner>/<repo>/actions/runs/<run_id>/job/<job_id>
  const m = String(link).match(/\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/);
  if (!m) return '';
  const runId = m[1];
  try {
    const raw = exec(`gh run view ${runId} --log-failed`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    });
    const str = typeof raw === 'string' ? raw : (raw ? raw.toString('utf8') : '');
    return str.length > LOG_SNIPPET_MAX_BYTES
      ? str.slice(-LOG_SNIPPET_MAX_BYTES)
      : str;
  } catch (err) {
    return `(failed to fetch log: ${err.message})`;
  }
}

/**
 * 判别 checks 的整体状态。
 *
 * 规则：
 *   - 任一 check 为 fail / cancelled / failure → FAIL
 *   - 所有 check 为 pass / success / skipping  → PASS
 *   - 其他（含 pending / in_progress / queued） → PENDING
 *
 * gh pr checks --json bucket 字段取值：pass | fail | pending | skipping | cancel
 *
 * @param {Array} checks
 * @returns {{overall: 'PASS'|'FAIL'|'PENDING', failed: object|null}}
 */
export function classifyChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return { overall: 'PENDING', failed: null };
  }
  const failed = checks.find((c) => {
    const b = String(c.bucket || c.state || '').toLowerCase();
    return b === 'fail' || b === 'cancel' || b === 'cancelled' || b === 'failure';
  });
  if (failed) return { overall: 'FAIL', failed };
  const allPass = checks.every((c) => {
    const b = String(c.bucket || c.state || '').toLowerCase();
    return b === 'pass' || b === 'success' || b === 'skipping' || b === 'skip';
  });
  if (allPass) return { overall: 'PASS', failed: null };
  return { overall: 'PENDING', failed: null };
}

/**
 * 主入口 — 轮询直到 PASS / FAIL / TIMEOUT。
 *
 * 每 intervalMs 跑一次 gh pr checks；按 classifyChecks 路由。
 *
 * @param {string}    prUrl
 * @param {Object}    [opts]
 * @param {number}    [opts.intervalMs=30000]     轮询间隔
 * @param {number}    [opts.timeoutMs=1800000]    总超时（30 min）
 * @param {Function}  [opts.exec]                 child_process.execSync 替换（测试用）
 * @param {Function}  [opts.sleep]                sleep 函数（测试用）— 默认 setTimeout promise
 * @returns {Promise<{status:'PASS'|'FAIL'|'TIMEOUT', checks?, failedCheck?, logSnippet?}>}
 */
export async function pollPRChecks(prUrl, opts = {}) {
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : DEFAULT_INTERVAL_MS;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const exec = opts.exec || execSync;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  if (!prUrl || typeof prUrl !== 'string') {
    return { status: 'FAIL', failedCheck: null, logSnippet: 'prUrl 缺失' };
  }

  const deadline = Date.now() + timeoutMs;
  let lastChecks = [];

  while (Date.now() < deadline) {
    try {
      lastChecks = runGhChecks(prUrl, exec);
    } catch (err) {
      // gh 命令本身失败（未登录 / 网络问题 / PR 不存在）→ 当作 FAIL
      return {
        status: 'FAIL',
        failedCheck: null,
        logSnippet: `gh pr checks 失败: ${err.message}`,
      };
    }

    const { overall, failed } = classifyChecks(lastChecks);
    if (overall === 'PASS') {
      return { status: 'PASS', checks: lastChecks };
    }
    if (overall === 'FAIL') {
      const logSnippet = fetchLogSnippet(failed && failed.link, exec);
      return {
        status: 'FAIL',
        failedCheck: failed,
        logSnippet,
      };
    }

    // PENDING — 继续等
    await sleep(intervalMs);
  }

  return { status: 'TIMEOUT', checks: lastChecks };
}
