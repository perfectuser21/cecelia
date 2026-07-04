/**
 * harness-relay-watchdog — skill-relay run 的重点火看门狗（eval-1 实证的产品化）。
 *
 * 病：relay session 会在 25-47 turns 后自判完成早退（v1.1.0 硬约束 6 的 prompt 纪律拦不住）。
 * 药：外部有界重点火——外部真相接续已四次实证（run-3 两段、eval-1 两段），
 *     新 session 从台账+git/PR 接续，重点火即免费恢复（relay-loop.sh 雏形一轮收敛到 merge）。
 *
 * 管辖分工：
 * - v2 run（orchestrator_version='v2'）归本 watchdog；harness-initiative-patrol 已排除 v2
 * - task 状态 queued 的不管（dispatcher 自然路径会经 relay 分支重 spawn，防双 spawn）
 * - deadline 逾期的不管（scanStuckHarness 既有逻辑负责标 failed）
 */
import pool from './db.js';
import { execSync } from 'node:child_process';

export const MAX_RELAY_ATTEMPTS = 5;

function shortId(id) {
  return String(id).replace(/-/g, '').slice(0, 8);
}

/**
 * @param {{pool?: object, execFn?: (cmd:string)=>string, spawnFn?: Function}} deps
 * @returns {Promise<{scanned:number, resumed:number, capped:number, housekept:number}>}
 */
export async function resumeStalledRelayRuns(deps = {}) {
  const dbPool = deps.pool || pool;
  const execFn = deps.execFn || ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 10000 }));
  const out = { scanned: 0, resumed: 0, capped: 0, housekept: 0 };

  // 每个 initiative 取最新一行 + 点火次数（每次 spawn INSERT 一行 = attempts 天然计数）
  const runsQ = await dbPool.query(
    `SELECT DISTINCT ON (initiative_id)
            initiative_id, phase, deadline_at,
            (SELECT COUNT(*) FROM initiative_runs r2
              WHERE r2.initiative_id = r.initiative_id
                AND r2.orchestrator_version = 'v2') AS attempts
       FROM initiative_runs r
      WHERE orchestrator_version = 'v2'
        AND phase NOT IN ('done', 'failed')
      ORDER BY initiative_id, started_at DESC
      LIMIT 20`
  );
  // 护栏:注入的 pool 对未知 SQL 返回 undefined 时(集成测试 fake),按空处理
  const runs = runsQ && Array.isArray(runsQ.rows) ? runsQ.rows : [];
  out.scanned = runs.length;

  for (const run of runs) {
    try {
      const taskQ = await dbPool.query(
        `SELECT id, status, title, description, payload FROM tasks WHERE id = $1`,
        [run.initiative_id]
      );
      const task = taskQ.rows[0];

      // house-keeping：task 已终态 → run 行收敛（防巡逻类误报/僵尸行堆积）
      if (!task || ['completed', 'cancelled', 'canceled'].includes(task.status)) {
        await dbPool.query(
          `UPDATE initiative_runs SET phase='done', completed_at=NOW()
            WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
          [run.initiative_id]
        );
        out.housekept++;
        continue;
      }
      if (task.status === 'failed') {
        await dbPool.query(
          `UPDATE initiative_runs SET phase='failed', completed_at=NOW()
            WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
          [run.initiative_id]
        );
        out.housekept++;
        continue;
      }

      // 只管 in_progress（queued 归 dispatcher，防双 spawn）
      if (task.status !== 'in_progress') continue;
      // 安全护栏：只碰 skill-relay 任务
      if (task.payload?.orchestrator !== 'skill-relay') continue;
      // deadline 逾期归 scanStuckHarness
      if (run.deadline_at && new Date(run.deadline_at).getTime() < Date.now()) continue;

      // 在跑容器存活检查（spawn 命名规约 cecelia-relay-<task8>-*）
      const short = shortId(task.id);
      let running = '';
      try {
        running = execFn(`docker ps -q --filter "name=cecelia-relay-${short}"`).trim();
      } catch { running = ''; /* docker 不可用时保守跳过（不盲目重点火） */ continue; }
      if (running) continue;

      // 上限熔断
      const attempts = parseInt(run.attempts, 10) || 0;
      if (attempts >= MAX_RELAY_ATTEMPTS) {
        await dbPool.query(
          `UPDATE initiative_runs SET phase='failed', completed_at=NOW(),
                  failure_reason='relay_watchdog_attempt_cap'
            WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
          [run.initiative_id]
        );
        await dbPool.query(
          `UPDATE tasks SET status='failed', completed_at=NOW(),
                  error_message='relay watchdog: 重点火 ' || $2 || ' 次仍未收敛到 merge'
            WHERE id=$1 AND status='in_progress'`,
          [run.initiative_id, String(attempts)]
        );
        out.capped++;
        console.warn(`[relay-watchdog] initiative=${run.initiative_id} 达重点火上限(${attempts})，标 failed`);
        continue;
      }

      // 重点火（spawnSkillRelaySession 会 INSERT 新 run 行 = attempts+1）
      const spawnFn = deps.spawnFn
        || (await import('./harness-skill-relay.js')).spawnSkillRelaySession;
      const r = await spawnFn(task, { pool: dbPool });
      if (r?.ok) {
        out.resumed++;
        console.log(`[relay-watchdog] 重点火 initiative=${run.initiative_id} attempt=${attempts + 1} container=${r.containerId}`);
      } else {
        console.warn(`[relay-watchdog] 重点火失败 initiative=${run.initiative_id}: ${r?.error}`);
      }
    } catch (err) {
      console.warn(`[relay-watchdog] initiative=${run.initiative_id} 处理失败（non-fatal）: ${err.message}`);
    }
  }
  return out;
}
