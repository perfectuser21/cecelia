/**
 * startup-sync.js — S0：brain 启动时批量恢复孤儿 relay 任务
 *
 * BEHAVIOR-7: scanOrphanedRelayTasks
 * - 查所有 in_progress + harness_initiative + skill-relay v2 任务且 run 未完成
 * - 对每条 run 调用 classifyDeath → 路由处置（oom/auth → spawn；rate_limit → defer；unknown → log_only）
 */

import { execSync } from 'node:child_process';
import { classifyDeath } from './harness-death-classifier.js';
import { findLiveRelayContainers } from './lib/harness-orphan-guard.js';
import { terminalizeRunsForTask, REVIVED_RUN_FAILURE_REASON } from './lib/harness-run-guard.js';

/**
 * orphan-guard requeue 超限时写进 tasks.error_message 的签名。
 * 复活闸只认这一个签名 —— 它唯一标识"基础设施死因"(容器 OOM / 早退 / spawn-guard 死锁),
 * 业务失败(Evaluator FAIL、合同不满足)绝不在此列,不能被复活。
 */
export const REVIVAL_ERROR_SIGNATURE = '[orphan-guard] requeue 超限';

/** 每条任务最多被复活几次。防"每次 Brain 启动复活一次"的无限循环。 */
export const MAX_HARNESS_REVIVALS = 1;

function defaultExecFn(cmd) {
  return execSync(cmd, { encoding: 'utf8', timeout: 10000 });
}

function shortIdOf(taskId) {
  return String(taskId || '').replace(/-/g, '').slice(0, 8) || null;
}

/**
 * 批量恢复孤儿 relay 任务
 *
 * @param {Object} opts
 * @param {Object} opts.pool - DB pool（必须）
 * @param {Function} opts.spawnFn - spawnSkillRelaySession（必须）
 * @param {Function} [opts.execFn] - execSync 替代（可选，用于 tmux kill）
 * @param {Function} [opts.classifyFn] - 分类器替代（测试注入，默认用真实 classifyDeath）
 * @returns {{ scanned: number, recovered: number }}
 */
export async function scanOrphanedRelayTasks({
  pool,
  spawnFn,
  execFn: _execFn = null,
  classifyFn = classifyDeath,
} = {}) {
  // 查所有 in_progress 且 run 未完成的 skill-relay v2 任务。
  //
  // 2026-08-07 修:原 SELECT 取 r.tmux_session / r.last_container_exit_code / r.stdout_tail,
  // 这三列 initiative_runs 上根本不存在,查询每次必抛 "column r.tmux_session does not exist",
  // 被 server.js 的 .catch 当 non-fatal 咽掉 —— 唯一的开机孤儿复活路径自诞生起 100% 空转。
  // 容器退出码真正的落库位置是 tasks.payload.last_container_exit_code
  // (harness-callback.js 的 relay 分支写的),从那里取。
  const result = await pool.query(`
    SELECT t.id AS initiative_id, t.title, t.payload,
           r.id,
           r.orchestrator_host,
           r.phase
    FROM tasks t
    JOIN initiative_runs r ON r.initiative_id = t.id
    WHERE t.status = 'in_progress'
      AND (t.payload->>'orchestrator') = 'skill-relay'
      AND r.orchestrator_version = 'v2'
      AND r.phase NOT IN ('done', 'failed')
    ORDER BY t.created_at ASC
  `);

  const recovered = [];

  for (const row of result.rows) {
    try {
      const rawExit = row.payload?.last_container_exit_code;
      const exitCode = rawExit === undefined || rawExit === null ? null : Number(rawExit);
      const stdoutTail = row.payload?.stdout_tail ?? null;

      const classified = classifyFn({
        exitCode,
        stdoutTail,
        tmuxPane: null, // S0 headless 路径，无 tmux pane
      });

      const taskId = row.initiative_id;

      // 审计日志（INV-06）含 source=startup-sync
      console.log(`[startup-sync] source=startup-sync cause=${classified.cause} action=${classified.action} initiative=${taskId}`);

      if (classified.cause === 'rate_limit') {
        // rate_limit → defer（不 spawn，不增 attempt）
        const deferUntil = row.payload?.retry_after_ts ?? (Date.now() + 60 * 60 * 1000);
        await pool.query(
          `UPDATE tasks SET payload = COALESCE(payload,'{}')::jsonb || jsonb_build_object('defer_until', $1::bigint) WHERE id=$2`,
          [deferUntil, taskId]
        );
        console.log(`[startup-sync] rate_limit defer initiative=${taskId} defer_until=${new Date(deferUntil).toISOString()}`);
      } else if (classified.cause === 'unknown' || classified.action === 'log_only') {
        // unknown → log_only，不 spawn
        console.log(`[startup-sync] log_only initiative=${taskId}`);
      } else {
        // oom / auth / ci_red / green_waiting_merge / interactive_stuck → 普通重点火
        if (spawnFn) {
          const r = await spawnFn(
            { id: taskId, title: row.title, payload: row.payload, task_type: 'harness_initiative' },
            { pool }
          );
          console.log(`[startup-sync] spawned initiative=${taskId} container=${r?.containerId}`);
        }
        recovered.push(taskId);
      }
    } catch (err) {
      console.warn(`[startup-sync] initiative=${row.id} 处理失败（non-fatal）: ${err.message}`);
    }
  }

  return { scanned: result.rows.length, recovered: recovered.length };
}

/**
 * 孤儿复活:把死于基础设施的 harness 任务捞回队列(TOP2 刀1 件②,2026-08-07)
 *
 * 病:W1/W2/W3 三条 harness_initiative 因 spawn-guard 死锁被 orphan-guard requeue 三次后
 * 终态 failed。三条的死因全是基础设施(一条容器 exit=137 被 OOM 杀、两条 provider 早退 exit=0),
 * 不是业务失败,重跑本来就该成——但系统里没有任何一条路径能把 failed 捞回来,
 * 连 Brain 重启也不行(scanOrphanedRelayTasks 本身是坏的,见上)。三条就此永久躺尸。
 *
 * 药:开机扫一遍"死于 infra 且已无活容器"的 failed 任务,清干净残留 run 后打回 queued,
 * 下一 tick 干净重跑。tmpfs 无断点,不做续传。
 *
 * 三道闸,一道都不能少:
 *   1) 只认 orphan-guard requeue 超限这一个 error_message 签名——
 *      "failed 不能回 queued" 的死规矩只对 infra 死因开这一个口子,业务失败一律不碰;
 *   2) 判活:还有活容器就不复活,防与在跑的执行体双跑(docker 报错 fail-open 跳过);
 *   3) 复活次数封顶,防每次 Brain 启动复活一次的无限循环。
 *
 * @returns {Promise<{scanned:number, revived:number, skipped:number, errors:string[]}>}
 */
export async function reviveOrphanedHarnessTasks({
  pool,
  execFn = defaultExecFn,
  lookbackHours = 24,
  maxRevivals = MAX_HARNESS_REVIVALS,
} = {}) {
  const out = { scanned: 0, revived: 0, skipped: 0, errors: [] };

  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, title, status, payload, error_message
       FROM tasks
       WHERE status = 'failed'
         AND (task_type LIKE 'harness%' OR task_type = 'golden_path_proposal')
         AND error_message LIKE $1 || '%'
         AND COALESCE((payload->>'harness_revival_count')::int, 0) < $2
         AND updated_at > NOW() - ($3 || ' hours')::interval
       ORDER BY updated_at DESC
       LIMIT 20`,
      [REVIVAL_ERROR_SIGNATURE, maxRevivals, String(lookbackHours)]
    ));
  } catch (err) {
    out.errors.push(`SELECT: ${err.message}`);
    return out;
  }
  out.scanned = rows.length;

  for (const task of rows) {
    try {
      const shortId = shortIdOf(task.id);
      if (!shortId) { out.skipped++; continue; }

      let live;
      try {
        live = findLiveRelayContainers(execFn, shortId);
      } catch (err) {
        // fail-open:判活失败宁可不复活,也不能盲目重派出双跑
        console.warn(`[startup-sync][revive] task=${task.id} 判活失败,跳过: ${err.message}`);
        out.skipped++;
        continue;
      }
      if (live.length > 0) {
        console.log(`[startup-sync][revive] task=${task.id} 仍有活容器 ${live.join(',')} → 跳过`);
        out.skipped++;
        continue;
      }

      // 顺序死规矩:先把残留 run 终态化,任务才回 queued。
      // 反过来的话,复活出来的任务下一 tick 重派会立刻撞上 spawn-guard,等于白复活。
      await terminalizeRunsForTask(pool, task.id, REVIVED_RUN_FAILURE_REASON);

      const revivalCount = Number(task.payload?.harness_revival_count || 0) + 1;
      const trace = {
        at: new Date().toISOString(),
        source: 'startup-sync',
        reason: 'infra_death',
        previous_error: task.error_message,
      };
      await pool.query(
        `UPDATE tasks
         SET status = 'queued',
             claimed_by = NULL,
             claimed_at = NULL,
             completed_at = NULL,
             error_message = NULL,
             payload = COALESCE(payload, '{}'::jsonb)
                       || jsonb_build_object(
                            'orphan_requeue_count', 0,
                            'harness_revival_count', $2::int,
                            'revived_from', $3::jsonb
                          ),
             updated_at = NOW()
         WHERE id = $1 AND status = 'failed'`,
        [task.id, revivalCount, JSON.stringify(trace)]
      );
      console.warn(
        `[startup-sync][revive] task=${task.id} "${task.title}" 复活回 queued`
        + ` (第${revivalCount}次, 原死因: ${task.error_message})`
      );
      out.revived++;
    } catch (err) {
      out.errors.push(`task ${task.id}: ${err.message}`);
    }
  }

  if (out.scanned > 0) {
    console.log(
      `[startup-sync][revive] done: scanned=${out.scanned}`
      + ` revived=${out.revived} skipped=${out.skipped} errors=${out.errors.length}`
    );
  }
  return out;
}
