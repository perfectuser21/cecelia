/**
 * Orphan PR Worker
 *
 * 扫描本机自己 push 的 cp-* PR，处理孤儿（无对应 Brain in_progress task）。
 *
 * 背景:
 *   PR #2406 #2408 两次因 Stop Hook 过早 exit 留下孤儿 PR。
 *   根因是 /dev harness_mode 快速通道没有兜底机制。本 worker 作为
 *   Brain 层面的兜底：每 30 分钟扫一次，自动处置孤儿 PR。
 *
 * 孤儿定义:
 *   - gh pr 作者是 @me
 *   - 分支前缀 cp-*
 *   - state == 'open'
 *   - 创建时间距今 > ageThresholdHours (默认 2h)
 *   - Brain 里无对应 in_progress task (task.result.pr_url == pr.url)
 *
 * 处置策略:
 *   - CI 全绿  → gh pr merge --squash --delete-branch
 *   - CI 有 fail → gh pr edit --add-label needs-attention
 *   - CI 还在跑 → skip (等下 tick 再查)
 *
 * 风格对齐:
 *   - ESM module（export async function）
 *   - 入参：pool + opts
 *   - 返回：{ scanned, merged, labeled, skipped, details }
 *   - 错误隔离：单个 PR 处理失败不阻止扫描其他 PR
 *   - 日志前缀：[orphan-pr-worker]
 *   - 参考 cleanup-worker.js / pipeline-watchdog.js
 *
 * 落位: packages/brain/src/orphan-pr-worker.js（与 cleanup-worker.js 同级）
 */

import { execSync } from 'child_process';

const DEFAULT_AGE_THRESHOLD_HOURS = parseFloat(
  process.env.ORPHAN_PR_AGE_THRESHOLD_HOURS || '2'
);

const DEFAULT_ORPHAN_LABEL =
  process.env.ORPHAN_PR_LABEL || 'needs-attention';

/**
 * 封装 gh CLI 调用。保持 execSync 同步（与现有 brain 脚本一致）。
 * 失败时抛错由外层 try/catch 捕获并转换为日志。
 *
 * @param {string} cmd
 * @param {{ timeout?: number }} [opts]
 * @returns {string} stdout trimmed
 */
function gh(cmd, opts = {}) {
  const { timeout = 30_000 } = opts;
  return execSync(cmd, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * 列出本人当前 open 的 cp-* PR，按 createdAt 过滤年龄。
 *
 * @param {number} ageThresholdHours
 * @returns {Array<{number:number, url:string, headRefName:string, createdAt:string, updatedAt:string, ageHours:number}>}
 */
function listOrphanCandidates(ageThresholdHours) {
  const raw = gh(
    "gh pr list --author @me --state open --limit 100 --json number,url,headRefName,createdAt,updatedAt"
  );
  const list = raw ? JSON.parse(raw) : [];
  const now = Date.now();
  const thresholdMs = ageThresholdHours * 60 * 60 * 1000;
  const candidates = [];
  for (const pr of list) {
    if (!pr.headRefName || !pr.headRefName.startsWith('cp-')) continue;
    const createdMs = pr.createdAt ? new Date(pr.createdAt).getTime() : 0;
    const ageMs = now - createdMs;
    if (ageMs < thresholdMs) continue;
    candidates.push({
      number: pr.number,
      url: pr.url,
      headRefName: pr.headRefName,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      ageHours: Number((ageMs / (60 * 60 * 1000)).toFixed(2)),
    });
  }
  return candidates;
}

/**
 * 查询 Brain 里是否有 in_progress 任务盯着这个 PR。
 *
 * @param {import('pg').Pool} pool
 * @param {string} prUrl
 * @returns {Promise<boolean>} true = 有任务在管（不是孤儿）
 */
async function hasActiveBrainTask(pool, prUrl) {
  const { rows } = await pool.query(
    `
    SELECT id
      FROM tasks
     WHERE status = 'in_progress'
       AND result->>'pr_url' = $1
     LIMIT 1
    `,
    [prUrl]
  );
  return rows.length > 0;
}

/**
 * 查询 PR 的 CI check 状态并归类。
 *
 * gh pr checks 在有 failure 时 exit code != 0，这里用 try/catch
 * 吃掉非零退出，依然能拿到 JSON 输出。
 *
 * @param {number} prNumber
 * @returns {'success'|'failure'|'pending'|'unknown'}
 */
function classifyChecks(prNumber) {
  let out = '';
  try {
    out = gh(`gh pr checks ${prNumber} --json name,state,conclusion`);
  } catch (err) {
    // gh pr checks exit 非零（有 failure）时，stdout 仍可能有内容
    const stdoutBuf = err.stdout;
    out =
      (stdoutBuf && stdoutBuf.toString ? stdoutBuf.toString() : stdoutBuf) ||
      '';
    out = String(out).trim();
  }
  if (!out) return 'unknown';
  let checks;
  try {
    checks = JSON.parse(out);
  } catch {
    return 'unknown';
  }
  if (!Array.isArray(checks) || checks.length === 0) return 'unknown';

  let hasFail = false;
  let hasPending = false;
  let hasSuccess = false;

  for (const c of checks) {
    const state = String(c.state || '').toUpperCase();
    const conclusion = String(c.conclusion || '').toUpperCase();

    // 明确失败
    if (
      state === 'FAILURE' ||
      state === 'ERROR' ||
      conclusion === 'FAILURE' ||
      conclusion === 'CANCELLED' ||
      conclusion === 'TIMED_OUT' ||
      conclusion === 'ACTION_REQUIRED' ||
      conclusion === 'STARTUP_FAILURE'
    ) {
      hasFail = true;
      continue;
    }

    // 明确成功
    if (state === 'SUCCESS' || conclusion === 'SUCCESS') {
      hasSuccess = true;
      continue;
    }

    // 中性（跳过）：skipped / neutral / stale
    if (
      conclusion === 'SKIPPED' ||
      conclusion === 'NEUTRAL' ||
      conclusion === 'STALE'
    ) {
      continue;
    }

    // 其他都算进行中
    hasPending = true;
  }

  if (hasFail) return 'failure';
  if (hasPending) return 'pending';
  if (hasSuccess) return 'success';
  return 'unknown';
}

/**
 * 合并 PR。
 */
function mergePr(prNumber, dryRun) {
  if (dryRun) {
    console.log(`[orphan-pr-worker] [dry-run] would merge PR #${prNumber}`);
    return;
  }
  gh(`gh pr merge ${prNumber} --squash --delete-branch`);
}

/**
 * 给 PR 打 label。
 */
function labelPr(prNumber, label, dryRun) {
  if (dryRun) {
    console.log(
      `[orphan-pr-worker] [dry-run] would label PR #${prNumber} with "${label}"`
    );
    return;
  }
  gh(`gh pr edit ${prNumber} --add-label ${JSON.stringify(label)}`);
}

/**
 * 主入口: 扫描 + 处理
 *
 * @param {import('pg').Pool} pool
 * @param {{ ageThresholdHours?: number, dryRun?: boolean, label?: string }} [opts]
 * @returns {Promise<{
 *   scanned: number,
 *   merged: number,
 *   labeled: number,
 *   skipped: number,
 *   details: Array<{pr:number, url:string, branch:string, action:'merged'|'labeled'|'skipped'|'error', reason:string, error?:string}>
 * }>}
 */
export async function scanOrphanPrs(pool, opts = {}) {
  const threshold = Number.isFinite(opts.ageThresholdHours)
    ? opts.ageThresholdHours
    : DEFAULT_AGE_THRESHOLD_HOURS;
  const dryRun = Boolean(opts.dryRun);
  const label = opts.label || DEFAULT_ORPHAN_LABEL;

  const result = {
    scanned: 0,
    merged: 0,
    labeled: 0,
    skipped: 0,
    details: [],
  };

  // 1) 列出候选 PR
  let candidates;
  try {
    candidates = listOrphanCandidates(threshold);
  } catch (err) {
    console.warn(
      `[orphan-pr-worker] gh pr list failed (non-fatal): ${err.message}`
    );
    return result;
  }

  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  // 2) 逐个处理（单个失败不阻止其他）
  for (const pr of candidates) {
    try {
      // 2a) Brain 有 task 在管 → 不是孤儿，skip
      let active = false;
      try {
        active = await hasActiveBrainTask(pool, pr.url);
      } catch (dbErr) {
        // 查不动 DB → 保守认为它不是孤儿，避免误操作
        console.warn(
          `[orphan-pr-worker] brain lookup failed for PR #${pr.number} (treat as not-orphan): ${dbErr.message}`
        );
        active = true;
      }
      if (active) {
        result.skipped++;
        result.details.push({
          pr: pr.number,
          url: pr.url,
          branch: pr.headRefName,
          action: 'skipped',
          reason: 'brain_task_active',
        });
        continue;
      }

      // 2b) 检查 CI
      const ciStatus = classifyChecks(pr.number);

      if (ciStatus === 'success') {
        mergePr(pr.number, dryRun);
        result.merged++;
        result.details.push({
          pr: pr.number,
          url: pr.url,
          branch: pr.headRefName,
          action: 'merged',
          reason: 'ci_green',
        });
        console.log(
          `[orphan-pr-worker] merged orphan PR #${pr.number} (${pr.headRefName}) age=${pr.ageHours}h${dryRun ? ' [dry-run]' : ''}`
        );
        continue;
      }

      if (ciStatus === 'failure') {
        labelPr(pr.number, label, dryRun);
        result.labeled++;
        result.details.push({
          pr: pr.number,
          url: pr.url,
          branch: pr.headRefName,
          action: 'labeled',
          reason: 'ci_failure',
        });
        console.log(
          `[orphan-pr-worker] labeled orphan PR #${pr.number} (${pr.headRefName}) -> ${label}${dryRun ? ' [dry-run]' : ''}`
        );
        continue;
      }

      // pending / unknown → 等下次 tick
      result.skipped++;
      result.details.push({
        pr: pr.number,
        url: pr.url,
        branch: pr.headRefName,
        action: 'skipped',
        reason: `ci_${ciStatus}`,
      });
    } catch (prErr) {
      // 单 PR 失败：记录但不中断
      result.skipped++;
      result.details.push({
        pr: pr.number,
        url: pr.url,
        branch: pr.headRefName,
        action: 'error',
        reason: 'exception',
        error: prErr.message,
      });
      console.warn(
        `[orphan-pr-worker] PR #${pr.number} handling failed (non-fatal): ${prErr.message}`
      );
    }
  }

  if (result.merged > 0 || result.labeled > 0) {
    console.log(
      `[orphan-pr-worker] summary scanned=${result.scanned} merged=${result.merged} labeled=${result.labeled} skipped=${result.skipped}`
    );
  }

  return result;
}

// 导出常量/辅助便于测试
export const _internals = {
  DEFAULT_AGE_THRESHOLD_HOURS,
  DEFAULT_ORPHAN_LABEL,
  listOrphanCandidates,
  hasActiveBrainTask,
  classifyChecks,
  mergePr,
  labelPr,
};

// CLI 直接跑：node orphan-pr-worker.js [--dry-run] [--threshold-hours=N]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const thresholdArg = args.find((a) => a.startsWith('--threshold-hours='));
  const ageThresholdHours = thresholdArg
    ? parseFloat(thresholdArg.split('=')[1])
    : undefined;

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      process.env.CECELIA_DATABASE_URL ||
      'postgres://localhost/cecelia',
  });

  try {
    const r = await scanOrphanPrs(pool, { dryRun, ageThresholdHours });
    console.log(JSON.stringify(r, null, 2));
  } catch (err) {
    console.error('[orphan-pr-worker] fatal:', err);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}
