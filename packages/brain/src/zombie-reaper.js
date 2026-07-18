/**
 * zombie-reaper.js — DB 层 zombie in_progress task 自动清理
 *
 * 背景：
 *   Brain dispatcher 依赖 task_pool available 槽位调度新任务。
 *   当 in_progress 任务 14+ 小时 updated_at 不更新（进程挂死/被杀/网络断开），
 *   任务状态卡在 in_progress，dispatcher available=0，新任务无法派发，形成死锁。
 *
 * 设计：
 *   每 ZOMBIE_REAPER_INTERVAL_MS（默认 5 min）扫一次 tasks 表。
 *   WHERE status='in_progress' AND updated_at < NOW() - INTERVAL '$idleMinutes minutes'
 *   → SET status='failed', error_message='[reaper] zombie: in_progress idle >Xmin'
 *
 * 配置：
 *   ZOMBIE_REAPER_IDLE_MIN      — idle 阈值（分钟），默认 60（B8: 30 太短，长 task 误判）
 *   ZOMBIE_REAPER_EXEMPT_TYPES  — 豁免 task_type 清单，逗号分隔（B8 新增）
 *
 * 安全：
 *   - 跑前打 log，标完打 log
 *   - 单任务 UPDATE 失败不影响其他任务（每行独立 try/catch）
 *   - 不做 retry 派发，只标 failed（YAGNI）
 *   - 不做飞书告警，只 console.warn（YAGNI）
 *   - B8: harness_* 系列豁免（GAN/generator 跑长，updated_at 不被 graph 内部活动 touch）
 */

import defaultPool from './db.js';
import { assessTaskLiveness } from './executor-contracts.js';

// ───── 配置 ─────
export const ZOMBIE_REAPER_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟扫一次
const DEFAULT_IDLE_MINUTES = parseInt(process.env.ZOMBIE_REAPER_IDLE_MIN || '60', 10);

/**
 * T7 第二判活信号：initiative_run_events 最后心跳（skill-relay 阶段自报）。
 * initiative_id 镜像 harness-skill-relay 的 fallback：payload.initiative_id || task.id。
 * 查询失败或无心跳一律返回 false（回退到 updated_at 单信号，不影响原处置）。
 */
async function hasFreshPhaseEventHeartbeat(pool, task, idleMinutes) {
  const initiativeId = task.payload_initiative_id || task.id;
  try {
    const { rows } = await pool.query(
      `SELECT GREATEST(COALESCE(MAX(ts), 0), COALESCE(MAX(ts_end), 0)) AS last_hb
       FROM initiative_run_events
       WHERE initiative_id = $1::uuid`,
      [initiativeId]
    );
    const lastHb = Number(rows?.[0]?.last_hb || 0);
    if (!lastHb) return false;
    return Math.floor(Date.now() / 1000) - lastHb < idleMinutes * 60;
  } catch (err) {
    console.warn(
      `[zombie-reaper] heartbeat check failed task=${task.id}: ${err.message} — fallback to updated_at only`
    );
    return false;
  }
}

/**
 * 扫描并按执行者合同处置 zombie in_progress tasks。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool] - PostgreSQL 连接池（测试可注入 mock）
 * @param {number} [opts.idleMinutes] - idle 阈值（分钟，默认 ZOMBIE_REAPER_IDLE_MIN env 或 60）
 * @param {object} [opts.ctx] - 运行上下文（activeProcesses Map 等，透传给 assessTaskLiveness）
 * @returns {Promise<{ reaped: number, scanned: number, errors: string[] }>}
 */
export async function reapZombies({ pool = defaultPool, idleMinutes = DEFAULT_IDLE_MINUTES, ctx = {} } = {}) {
  const result = { reaped: 0, scanned: 0, errors: [] };

  console.log(`[zombie-reaper] Scanning for zombie in_progress tasks (idle > ${idleMinutes} min)...`);

  // SELECT: 找出所有超时 in_progress 任务，SELECT 含 executor_kind/last_attempt_at/claimed_by 供 assessTaskLiveness 使用
  let zombies;
  try {
    const selectResult = await pool.query(
      `SELECT id, title, task_type, executor_kind, last_attempt_at, claimed_by, updated_at,
              payload->>'initiative_id' AS payload_initiative_id
       FROM tasks
       WHERE status = 'in_progress'
         AND updated_at < NOW() - INTERVAL '${idleMinutes} minutes'
       ORDER BY updated_at ASC
       LIMIT 100`
    );
    zombies = selectResult.rows;
    result.scanned = zombies.length;
  } catch (err) {
    const msg = `SELECT failed: ${err.message}`;
    result.errors.push(msg);
    console.error(`[zombie-reaper] ${msg}`);
    return result;
  }

  if (zombies.length === 0) {
    console.log('[zombie-reaper] No zombie tasks found.');
    return result;
  }

  console.warn(`[zombie-reaper] Found ${zombies.length} zombie task(s) — assessing liveness`);

  // UPDATE: 逐行按合同处置（独立 try/catch，单行失败不阻断）
  for (const task of zombies) {
    try {
      const liveness = await assessTaskLiveness(task, ctx);

      // alive / unknown → fail-open，跳过
      if (liveness.verdict === 'alive' || liveness.verdict === 'unknown') {
        console.log(`[zombie-reaper] Skip task id=${task.id} verdict=${liveness.verdict}`);
        continue;
      }

      // T7: 第二判活信号——phase-event 心跳新鲜则不杀（任一信号活即不判死）
      if (await hasFreshPhaseEventHeartbeat(pool, task, idleMinutes)) {
        console.log(`[zombie-reaper] Skip task id=${task.id} — phase-event heartbeat fresh`);
        continue;
      }

      // dead — 按 onStale 分支处置
      if (liveness.onStale === 'fail') {
        await pool.query(
          `UPDATE tasks
           SET status = 'failed',
               error_message = $1,
               completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $2
             AND status = 'in_progress'`,
          [`[reaper] zombie: in_progress idle >${idleMinutes}min`, task.id]
        );
        result.reaped++;
        console.warn(
          `[zombie-reaper] Reaped (failed) zombie task id=${task.id} title=${JSON.stringify(task.title || '')}`
        );
      } else if (liveness.onStale === 'release-claim-and-alert') {
        await pool.query(
          `UPDATE tasks
           SET status = 'queued',
               claimed_by = NULL,
               claimed_at = NULL,
               updated_at = NOW()
           WHERE id = $1
             AND status = 'in_progress'`,
          [task.id]
        );
        result.reaped++;
        console.warn(`[reaper] headed-session stale: released claim id=${task.id}`);
      } else {
        // 其他 onStale（requeue/reignite/never 等）→ 跳过，由专属守护刀处理
        console.log(`[zombie-reaper] Skip task id=${task.id} onStale=${liveness.onStale} (not handled by reaper)`);
      }
    } catch (err) {
      const msg = `task ${task.id}: ${err.message}`;
      result.errors.push(msg);
      console.error(`[zombie-reaper] ${msg}`);
    }
  }

  console.log(
    `[zombie-reaper] Done: reaped=${result.reaped} scanned=${result.scanned} errors=${result.errors.length}`
  );

  return result;
}

/**
 * 启动 zombie reaper 定时器（每 ZOMBIE_REAPER_INTERVAL_MS 触发一次）。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool] - PostgreSQL 连接池（测试可注入 mock）
 * @param {number} [opts.idleMinutes] - idle 阈值（分钟）
 * @returns {NodeJS.Timeout} setInterval 返回的 timer ID
 */
export function startZombieReaper({ pool = defaultPool, idleMinutes = DEFAULT_IDLE_MINUTES, ctx = {} } = {}) {
  const timer = setInterval(async () => {
    try {
      await reapZombies({ pool, idleMinutes, ctx });
    } catch (err) {
      console.error('[zombie-reaper] Unexpected error during reap:', err.message);
    }
  }, ZOMBIE_REAPER_INTERVAL_MS);

  // 不阻止进程退出
  if (timer.unref) {
    timer.unref();
  }

  console.log(
    `[zombie-reaper] Started (interval=${ZOMBIE_REAPER_INTERVAL_MS}ms, idleThreshold=${idleMinutes}min)`
  );

  return timer;
}

/**
 * 扫描并处置 waiting_ci 超时任务（6h 守卫 / 24h 总窗口）。
 *
 * 处置规则：
 *   - waiting_ci_since < NOW() - 6h 且 PR 状态为 MERGED  → completed
 *   - waiting_ci_since < NOW() - 6h 且 PR 状态为 CLOSED  → failed(pr_closed)
 *   - waiting_ci_since < NOW() - 6h 且 PR 状态为 OPEN    → 续期（更新 waiting_ci_since）
 *   - waiting_ci_since < NOW() - 24h                    → failed(waiting_ci_timeout)
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool] - PostgreSQL 连接池（测试可注入 mock）
 * @param {Function} [opts.execFn] - execSync 替代（测试注入，默认用真实 execSync）
 * @returns {Promise<{ reaped: number, renewed: number, scanned: number, errors: string[] }>}
 */
export async function reapWaitingCiZombies({ pool = defaultPool, execFn } = {}) {
  const result = { reaped: 0, renewed: 0, scanned: 0, errors: [] };

  // 扫描所有 waiting_ci_since < NOW() - 6h 的任务
  let staleRows;
  try {
    const selectResult = await pool.query(`
      SELECT id, title, payload
      FROM tasks
      WHERE status = 'waiting_ci'
        AND (payload->>'waiting_ci_since')::bigint < extract(epoch from now() - interval '6 hours')
      ORDER BY (payload->>'waiting_ci_since')::bigint ASC
      LIMIT 100
    `);
    staleRows = selectResult.rows;
    result.scanned = staleRows.length;
  } catch (err) {
    const msg = `SELECT waiting_ci zombies failed: ${err.message}`;
    result.errors.push(msg);
    console.error(`[zombie-reaper] ${msg}`);
    return result;
  }

  if (staleRows.length === 0) {
    return result;
  }

  console.warn(`[zombie-reaper] Found ${staleRows.length} stale waiting_ci task(s)`);

  const nowSec = Math.floor(Date.now() / 1000);
  const TWENTY_FOUR_HOURS_SEC = 86400;

  for (const task of staleRows) {
    try {
      const prUrl = task.payload?.waiting_pr_url;
      const since = parseInt(task.payload?.waiting_ci_since || '0', 10);
      const over24h = (nowSec - since) > TWENTY_FOUR_HOURS_SEC;

      // 超过 24h 总守卫窗口 → 直接 timeout，不查 PR
      if (over24h) {
        await pool.query(
          `UPDATE tasks SET status='failed', error_message=$2 WHERE id=$1 AND status='waiting_ci'`,
          [task.id, 'waiting_ci_timeout']
        );
        result.reaped++;
        console.warn(`[zombie-reaper] waiting_ci_timeout id=${task.id} (over 24h)`);
        continue;
      }

      // 查 PR 状态
      if (!prUrl) {
        // 无 pr_url → 无法确认，保守续期
        await pool.query(
          `UPDATE tasks SET payload=payload||jsonb_build_object('waiting_ci_since', $2::bigint) WHERE id=$1 AND status='waiting_ci'`,
          [task.id, nowSec]
        );
        result.renewed++;
        continue;
      }

      let prState = 'OPEN';
      try {
        const execSync = execFn ?? (await import('child_process')).execSync;
        const output = execSync(
          `gh pr view "${prUrl}" --json state --jq '.state'`,
          { encoding: 'utf8', timeout: 15000 }
        ).trim();
        prState = output.toUpperCase();
      } catch (ghErr) {
        console.warn(`[zombie-reaper] gh pr view 失败 id=${task.id}: ${ghErr.message}，保守续期`);
        await pool.query(
          `UPDATE tasks SET payload=payload||jsonb_build_object('waiting_ci_since', $2::bigint) WHERE id=$1 AND status='waiting_ci'`,
          [task.id, nowSec]
        );
        result.renewed++;
        continue;
      }

      if (prState === 'MERGED') {
        await pool.query(
          `UPDATE tasks SET status='completed', completed_at=NOW() WHERE id=$1 AND (status='in_progress' OR status='waiting_ci')`,
          [task.id]
        );
        result.reaped++;
        console.log(`[zombie-reaper] waiting_ci MERGED → completed id=${task.id}`);
      } else if (prState === 'CLOSED') {
        await pool.query(
          `UPDATE tasks SET status='failed', error_message=$2 WHERE id=$1 AND status='waiting_ci'`,
          [task.id, 'pr_closed']
        );
        result.reaped++;
        console.warn(`[zombie-reaper] waiting_ci CLOSED → failed(pr_closed) id=${task.id}`);
      } else {
        // OPEN → 续期
        await pool.query(
          `UPDATE tasks SET payload=payload||jsonb_build_object('waiting_ci_since', $2::bigint) WHERE id=$1 AND status='waiting_ci'`,
          [task.id, nowSec]
        );
        result.renewed++;
        console.log(`[zombie-reaper] waiting_ci OPEN → 续期 id=${task.id}`);
      }
    } catch (err) {
      const msg = `处置 waiting_ci task id=${task.id} 失败: ${err.message}`;
      result.errors.push(msg);
      console.error(`[zombie-reaper] ${msg}`);
    }
  }

  console.log(
    `[zombie-reaper] waiting_ci 守卫完成: reaped=${result.reaped} renewed=${result.renewed} scanned=${result.scanned} errors=${result.errors.length}`
  );

  return result;
}

export default { reapZombies, startZombieReaper, reapWaitingCiZombies, ZOMBIE_REAPER_INTERVAL_MS };
