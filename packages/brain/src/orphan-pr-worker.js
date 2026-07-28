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
 *   - 确认是孤儿后，标题与某个已 MERGED 的 PR 高度相似（superseded）→ 直接 close
 *     （不看 CI 状态、不受 age 阈值限制；无 keep label 才生效；判断顺序在
 *     hasActiveBrainTask 之后，避免误关正被 Brain task 追踪的 PR）
 *   - CI 全绿  → 标记为等待统一 merge authorization（本 worker 永不 merge）
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
import { findDuplicateSibling } from './dispatch-dedup.js';

const DEFAULT_AGE_THRESHOLD_HOURS = parseFloat(
  process.env.ORPHAN_PR_AGE_THRESHOLD_HOURS || '2'
);

const DEFAULT_ORPHAN_LABEL =
  process.env.ORPHAN_PR_LABEL || 'needs-attention';

// 7 天：保守估计，暂无精确历史数据支撑（同 dispatcher.js 的 DUPLICATE_TASK_WINDOW_HOURS
// 一样是经验值）。选 7 天而非更短的原因是红色孤儿常见于跨天排查/等真机复测（如 memory
// 里 Line04 真机簇要等 xian-rog 复测），太短会误关还在等结果的 PR；关闭不删分支+可
// gh pr reopen 恢复，即使阈值定得偏保守也不会造成不可逆损失。如误判率偏高可调小。
const DEFAULT_STALE_CLOSE_DAYS = parseFloat(
  process.env.ORPHAN_PR_STALE_CLOSE_DAYS || '7'
);
const KEEP_LABEL = 'keep';

// superseded 检测阈值：用真实撞车案例校准（#3650 "skill-eval-worker 超时回收 + pm2
// 常驻脚本 + 并发冒烟" vs 孤儿 "skill-eval-worker 常驻 daemon + running 超时回收"，
// 实测 Jaccard ≈0.4167，与 dispatch-dedup.js 里 findDuplicateSibling 默认阈值 0.6 校准的
// "同一 PR 追加后缀" 场景不同——superseded 场景两个标题往往是不同人/不同轮次对同一件事
// 的独立措辞，重叠词更少。0.4 定得比实测值略低留一点容错，同时仍远高于无关标题的 0 相似度，
// 边际足够安全。
const SUPERSEDED_TITLE_THRESHOLD = parseFloat(
  process.env.ORPHAN_PR_SUPERSEDED_THRESHOLD || '0.4'
);

// harness sub_task PR 分支模式 cp-<MMDDHHMM>-ws-<init8>-...（实证 cp-06171703-ws-3f893d17-ws1）。
// 这类 PR 由 harness sub-graph 的 evaluator pre-merge gate 自管，orphan-worker 绝不偷合
// （否则会合掉还在等裁判的 PR，绕过 evaluate_verdict gate）。普通 /dev 的 cp-<stamp>-<slug> 不撞。
const HARNESS_SUBTASK_BRANCH_RE = /^cp-\d{8,10}-ws-[0-9a-f]{6,8}/;

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
 * @returns {Array<{number:number, url:string, headRefName:string, createdAt:string, updatedAt:string, ageHours:number, labels:Array<{name:string}>}>}
 */
function listOrphanCandidates(ageThresholdHours) {
  const raw = gh(
    "gh pr list --author @me --state open --limit 100 --json number,url,headRefName,createdAt,updatedAt,labels,title"
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
      labels: pr.labels || [],
      title: pr.title || '',
    });
  }
  return candidates;
}

/**
 * 查询 Brain 是否拥有这个 PR。
 *
 * Kernel run 的 PR 权威落在 initiative_runs.pr_url；旧 one-session 则主要写
 * tasks.result.pr_url。两者任一命中都必须视为受保护，不能被孤儿 worker 合并或关闭。
 *
 * @param {import('pg').Pool} pool
 * @param {string} prUrl
 * @returns {Promise<boolean>} true = 有任务在管（不是孤儿）
 */
async function hasActiveBrainTask(pool, prUrl) {
  const { rows } = await pool.query(
    `
    SELECT 'brain_owned' AS owner_kind
     WHERE EXISTS (
       SELECT 1
         FROM tasks
        WHERE status = 'in_progress'
          AND result->>'pr_url' = $1
     )
        OR EXISTS (
       SELECT 1
         FROM initiative_runs
        WHERE pr_url = $1
     )
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
 * PR 是否带 keep 豁免标签（人工点名要救的 PR，永不自动关闭）。
 */
function hasKeepLabel(pr) {
  return Array.isArray(pr?.labels) && pr.labels.some((l) => l?.name === KEEP_LABEL);
}

/**
 * 红色（CI failure）孤儿是否该超期关闭：无 keep label 且 age 超过阈值天数。
 */
function shouldCloseStaleFail(pr, staleCloseDays) {
  if (hasKeepLabel(pr)) return false;
  const ageDays = (pr.ageHours || 0) / 24;
  return ageDays > staleCloseDays;
}

/**
 * 关闭 PR（不删分支，可恢复），并留痕评论。
 */
function closePr(prNumber, reason, dryRun) {
  if (dryRun) {
    console.log(`[orphan-pr-worker] [dry-run] would close PR #${prNumber} (${reason})`);
    return;
  }
  gh(`gh pr comment ${prNumber} --body ${JSON.stringify(reason)}`);
  gh(`gh pr close ${prNumber}`);
}

/**
 * 主入口: 扫描 + 处理
 *
 * @param {import('pg').Pool} pool
 * @param {{ ageThresholdHours?: number, dryRun?: boolean, label?: string, staleCloseDays?: number }} [opts]
 * @returns {Promise<{
 *   scanned: number,
 *   merged: number,
 *   labeled: number,
 *   closed: number,
 *   skipped: number,
 *   details: Array<{pr:number, url:string, branch:string, action:'merged'|'labeled'|'closed'|'skipped'|'error', reason:string, error?:string}>
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
    closed: 0,
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

  // 1.5) 拉一次全量 MERGED PR（供 superseded 检测复用，避免每个候选都单独调一次 gh）
  let mergedPrs = [];
  try {
    const raw = gh(
      `gh pr list --author @me --state merged --limit 100 --json number,url,headRefName,title`
    );
    mergedPrs = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn(`[orphan-pr-worker] gh pr list --state merged failed (non-fatal, skip superseded check): ${err.message}`);
  }

  // 2) 逐个处理（单个失败不阻止其他）
  for (const pr of candidates) {
    try {
      // 2.0) harness sub_task PR 豁免：交给 sub-graph merge_pr gate 自管，orphan-worker 不碰
      // （否则会偷合还在等裁判的 PR，绕过 evaluate_verdict pre-merge gate）。
      if (HARNESS_SUBTASK_BRANCH_RE.test(pr.headRefName)) {
        result.skipped++;
        result.details.push({
          pr: pr.number,
          url: pr.url,
          branch: pr.headRefName,
          action: 'skipped',
          reason: 'harness_subtask_pr',
        });
        continue;
      }

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

      // 2a.5) Superseded 检测：走到这里说明已确认是真孤儿（无 Brain task 在管）。
      //        已有语义高度相似的 MERGED PR → 当前这个是重复的败者，直接关闭。
      //        不看 CI 状态、不受 age 阈值限制——已经被取代的工作没有"再等等看会不会转绿"的价值。
      //        必须放在 hasActiveBrainTask 判断之后：如果放在前面，会绕过"孤儿"定义本身，
      //        误关正被 Brain in_progress task 实时追踪的 PR（可能是一次真实进行中的 harness run）。
      if (!hasKeepLabel(pr)) {
        // findDuplicateSibling 是"命中第一个超阈值的就返回"，不是全量比较取最相似的那个。
        // 如果 mergedPrs 里有多个候选都超过阈值，这里记录的 superseded_by 只是第一个命中的，
        // 不保证是语义上最贴切的那个——排查时留意这一点。
        const supersededBy = findDuplicateSibling(pr.title || '', mergedPrs, {
          threshold: SUPERSEDED_TITLE_THRESHOLD,
          keyFn: (p) => p.title || '',
        });
        // supersededBy.number !== pr.number 理论上恒真：pr 来自 open PR 列表、supersededBy
        // 来自 merged PR 列表，同一个 PR 不可能同时处于两种状态。保留此判断仅作防御性编程，
        // 防止未来 candidates/mergedPrs 来源改动后出现自比对。
        if (supersededBy && supersededBy.number !== pr.number) {
          closePr(pr.number, `[orphan-pr-worker] 已被 #${supersededBy.number} 取代（标题高度相似且已合并），自动关闭（如需保留请加 "${KEEP_LABEL}" 标签）`, dryRun);
          result.closed++;
          result.details.push({
            pr: pr.number,
            url: pr.url,
            branch: pr.headRefName,
            action: 'closed',
            reason: 'superseded',
            superseded_by: supersededBy.number,
          });
          console.log(
            `[orphan-pr-worker] closed superseded PR #${pr.number} (superseded by #${supersededBy.number})${dryRun ? ' [dry-run]' : ''}`
          );
          continue;
        }
      }

      // 2b) 检查 CI
      const ciStatus = classifyChecks(pr.number);

      if (ciStatus === 'success') {
        // Orphan worker 没有 evaluator/judge/human 的 SHA-bound authorization
        // receipt，因此无论 CI 多绿都没有 merge authority。只观察、不执行。
        result.skipped++;
        result.details.push({
          pr: pr.number,
          url: pr.url,
          branch: pr.headRefName,
          action: 'skipped',
          reason: 'ci_green_requires_merge_authorization',
        });
        console.log(
          `[orphan-pr-worker] green orphan PR #${pr.number} requires merge authorization (${pr.headRefName}) age=${pr.ageHours}h`
        );
        continue;
      }

      if (ciStatus === 'failure') {
        const staleCloseDays = Number.isFinite(opts.staleCloseDays)
          ? opts.staleCloseDays
          : DEFAULT_STALE_CLOSE_DAYS;
        if (shouldCloseStaleFail(pr, staleCloseDays)) {
          closePr(pr.number, `[orphan-pr-worker] CI 红色超过 ${staleCloseDays} 天未修复，自动关闭（如需保留请加 "${KEEP_LABEL}" 标签）`, dryRun);
          result.closed++;
          result.details.push({
            pr: pr.number,
            url: pr.url,
            branch: pr.headRefName,
            action: 'closed',
            reason: 'ci_failure_stale',
          });
          console.log(
            `[orphan-pr-worker] closed stale-failing orphan PR #${pr.number} (${pr.headRefName}) age=${pr.ageHours}h${dryRun ? ' [dry-run]' : ''}`
          );
          continue;
        }
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

  if (result.merged > 0 || result.labeled > 0 || result.closed > 0) {
    console.log(
      `[orphan-pr-worker] summary scanned=${result.scanned} merged=${result.merged} labeled=${result.labeled} closed=${result.closed} skipped=${result.skipped}`
    );
  }

  return result;
}

// 导出常量/辅助便于测试
export const _internals = {
  DEFAULT_AGE_THRESHOLD_HOURS,
  DEFAULT_ORPHAN_LABEL,
  DEFAULT_STALE_CLOSE_DAYS,
  SUPERSEDED_TITLE_THRESHOLD,
  listOrphanCandidates,
  hasActiveBrainTask,
  classifyChecks,
  labelPr,
  closePr,
  hasKeepLabel,
  shouldCloseStaleFail,
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
