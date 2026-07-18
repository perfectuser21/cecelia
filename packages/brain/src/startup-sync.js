/**
 * startup-sync.js — S0：brain 启动时批量恢复孤儿 relay 任务
 *
 * BEHAVIOR-7: scanOrphanedRelayTasks
 * - 查所有 in_progress + harness_initiative + skill-relay v2 任务且 run 未完成
 * - 对每条 run 调用 classifyDeath → 路由处置（oom/auth → spawn；rate_limit → defer；unknown → log_only）
 */

import { classifyDeath } from './harness-death-classifier.js';

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
  // 查所有 in_progress 且 run 未完成的 skill-relay v2 任务
  const result = await pool.query(`
    SELECT t.id AS initiative_id, t.title, t.payload,
           r.id,
           r.orchestrator_host, r.tmux_session,
           r.phase,
           r.last_container_exit_code,
           r.stdout_tail
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
      const exitCode = row.last_container_exit_code ?? null;
      const stdoutTail = row.stdout_tail ?? null;

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
 * 启动时再分类 waiting_ci 任务：
 *   - CI green → 保持 waiting_ci（不动）
 *   - CI red   → 回 in_progress（触发重点火）
 *   - 其他/未知 → 保守保持 waiting_ci
 *
 * @param {Object} opts
 * @param {Object} opts.pool - DB pool（必须）
 * @param {Function} [opts.execFn] - execSync 替代（测试注入）
 * @returns {{ scanned: number, reclassified: number }}
 */
export async function reclassifyWaitingCiTasks({ pool, execFn } = {}) {
  const result = await pool.query(`
    SELECT id, title, payload
    FROM tasks
    WHERE status = 'waiting_ci'
    ORDER BY created_at ASC
  `);

  let reclassified = 0;

  for (const task of result.rows) {
    try {
      const prUrl = task.payload?.waiting_pr_url;
      if (!prUrl) {
        // 无 pr_url → 保守保持 waiting_ci
        console.log(`[startup-sync] waiting_ci id=${task.id} 无 pr_url，保守保持`);
        continue;
      }

      // 查 CI 状态
      let ciStatus = 'unknown';
      try {
        const execSync = execFn ?? (await import('child_process')).execSync;
        const output = execSync(
          `gh pr view "${prUrl}" --json statusCheckRollup --jq '.statusCheckRollup[].state' 2>/dev/null | sort -u`,
          { encoding: 'utf8', timeout: 10000 }
        ).trim();
        const states = output.split('\n').filter(Boolean).map(s => s.toUpperCase());
        if (states.includes('FAILURE') || states.includes('ERROR')) {
          ciStatus = 'red';
        } else if (states.length > 0 && states.every(s => s === 'SUCCESS')) {
          ciStatus = 'green';
        } else {
          ciStatus = 'pending';
        }
      } catch {
        ciStatus = 'unknown';
      }

      if (ciStatus === 'red') {
        // CI red → 回 in_progress
        await pool.query(
          `UPDATE tasks SET status='in_progress', payload=payload - 'waiting_ci_since' WHERE id=$1 AND status='waiting_ci'`,
          [task.id]
        );
        reclassified++;
        console.log(`[startup-sync] waiting_ci CI red → in_progress id=${task.id}`);
      } else {
        // green / pending / unknown → 保持 waiting_ci
        console.log(`[startup-sync] waiting_ci CI ${ciStatus} → 保持 waiting_ci id=${task.id}`);
      }
    } catch (err) {
      console.warn(`[startup-sync] waiting_ci reclassify id=${task.id} 失败（non-fatal）: ${err.message}`);
    }
  }

  return { scanned: result.rows.length, reclassified };
}
