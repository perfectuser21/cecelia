// orphan-pr-worker.js — 孤儿 PR 兜底 Worker
//
// 周期扫描 cp-* PR：
//   - open > 2h
//   - 无关联 in_progress task
//   - CI success → gh pr merge --squash --delete-branch
//   - CI failure → gh pr edit --add-label needs-attention
//   - CI pending → skip
//
// 由 tick.js 按 ORPHAN_PR_WORKER_INTERVAL_MS 周期触发。

import { exec } from 'child_process';
import pool from './db.js';

const DEFAULT_AGE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_LIST_LIMIT = 50;

function execAsync(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function summarizeCiStatus(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'pending';
  let anyPending = false;
  let anyFailure = false;
  for (const check of rollup) {
    const status = (check.status || '').toUpperCase();
    const conclusion = (check.conclusion || '').toUpperCase();
    const state = (check.state || '').toUpperCase();
    if (
      status === 'IN_PROGRESS' ||
      status === 'QUEUED' ||
      status === 'PENDING' ||
      status === 'WAITING' ||
      state === 'PENDING'
    ) {
      anyPending = true;
    } else if (
      conclusion === 'FAILURE' ||
      conclusion === 'TIMED_OUT' ||
      conclusion === 'CANCELLED' ||
      conclusion === 'ACTION_REQUIRED' ||
      state === 'FAILURE' ||
      state === 'ERROR'
    ) {
      anyFailure = true;
    }
  }
  if (anyFailure) return 'failure';
  if (anyPending) return 'pending';
  return 'success';
}

/**
 * @param {object} [opts]
 * @param {object} [opts.db]            pg pool（default: ./db.js）
 * @param {function} [opts.ghRunner]    async (cmd, opts) => {stdout, stderr}（注入便于测试）
 * @param {number} [opts.now]           epoch ms（测试可覆盖）
 * @param {number} [opts.ageThresholdMs] 孤儿 PR 年龄下限（default 2h）
 * @param {number} [opts.timeoutMs]     单次 gh 命令超时（default 60s）
 * @param {number} [opts.listLimit]     gh pr list --limit（default 50）
 * @param {boolean} [opts.dryRun]       不调用 gh pr merge / gh pr edit（仅累计计数）
 * @returns {Promise<{scanned:number, merged:number, labeled:number, skipped:number, errors:Array}>}
 */
export async function runOrphanPrWorker(opts = {}) {
  const {
    db = pool,
    ghRunner = execAsync,
    now = Date.now(),
    ageThresholdMs = DEFAULT_AGE_THRESHOLD_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    listLimit = DEFAULT_LIST_LIMIT,
    dryRun = false,
  } = opts;

  const stats = { scanned: 0, merged: 0, labeled: 0, skipped: 0, errors: [] };

  let prList;
  try {
    const r = await ghRunner(
      `gh pr list --state open --limit ${listLimit} --json number,headRefName,createdAt,labels,statusCheckRollup`,
      { timeout: timeoutMs }
    );
    prList = JSON.parse(r.stdout || '[]');
  } catch (err) {
    stats.errors.push({ stage: 'list', message: err.message });
    return stats;
  }

  for (const pr of prList) {
    if (!pr.headRefName || !pr.headRefName.startsWith('cp-')) continue;
    stats.scanned++;

    const ageMs = now - new Date(pr.createdAt).getTime();
    if (!(ageMs >= ageThresholdMs)) {
      stats.skipped++;
      continue;
    }

    let hasActiveTask = false;
    try {
      const q = await db.query(
        `SELECT 1 FROM tasks
         WHERE status = 'in_progress'
           AND (payload->>'branch' = $1 OR metadata->>'branch' = $1)
         LIMIT 1`,
        [pr.headRefName]
      );
      const n = typeof q.rowCount === 'number' ? q.rowCount : (q.rows?.length || 0);
      hasActiveTask = n > 0;
    } catch (err) {
      stats.errors.push({ stage: 'db', pr: pr.number, message: err.message });
      stats.skipped++;
      continue;
    }

    if (hasActiveTask) {
      stats.skipped++;
      continue;
    }

    const ci = summarizeCiStatus(pr.statusCheckRollup);

    if (ci === 'success') {
      if (dryRun) {
        stats.merged++;
        continue;
      }
      try {
        await ghRunner(`gh pr merge ${pr.number} --squash --delete-branch`, { timeout: timeoutMs });
        stats.merged++;
      } catch (err) {
        stats.errors.push({ stage: 'merge', pr: pr.number, message: err.message });
      }
    } else if (ci === 'failure') {
      const already = (pr.labels || []).some((l) => l.name === 'needs-attention');
      if (already) {
        stats.skipped++;
        continue;
      }
      if (dryRun) {
        stats.labeled++;
        continue;
      }
      try {
        await ghRunner(`gh pr edit ${pr.number} --add-label needs-attention`, { timeout: timeoutMs });
        stats.labeled++;
      } catch (err) {
        stats.errors.push({ stage: 'label', pr: pr.number, message: err.message });
      }
    } else {
      stats.skipped++;
    }
  }

  return stats;
}

export default runOrphanPrWorker;
