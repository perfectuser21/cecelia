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
// B6: codex 路径上限更低（外部 codex API 更贵，不允许无限重试）
export const MAX_CODEX_RELAY_ATTEMPTS = 2;

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
  const out = { scanned: 0, resumed: 0, capped: 0, housekept: 0, mergedPr: 0 };

  // 每个 initiative 取最新一行 + 点火次数（每次 spawn INSERT 一行 = attempts 天然计数）
  // 已知缺口（Notion Issue 1ea53e09-b088-4d2a-b03a-ad8c976bbc6c）：这个计数只统计
  // initiative_runs 里已成功 INSERT 的行，早期 spawn 失败（例如 spawn 前就挂掉，
  // 从未写入 initiative_runs）不计数，可能导致 attempts 长期低估、MAX_RELAY_ATTEMPTS
  // 封顶判断失效，从而无限重跑不收敛。暂未修，先记录跟踪。
  const runsQ = await dbPool.query(
    `SELECT DISTINCT ON (initiative_id) initiative_id, phase, deadline_at, pr_url, orchestrator_host, completed_at, tmux_killed_at, (SELECT COUNT(*) FROM initiative_runs r2 WHERE r2.initiative_id = r.initiative_id AND r2.orchestrator_version = 'v2') AS attempts FROM initiative_runs r WHERE orchestrator_version = 'v2' AND (phase NOT IN ('done', 'failed') OR (orchestrator_host = 'skill-relay-codex-headed' AND phase = 'done' AND tmux_killed_at IS NULL)) ORDER BY initiative_id, started_at DESC LIMIT 20`
  );
  // 护栏:注入的 pool 对未知 SQL 返回 undefined 时(集成测试 fake),按空处理
  const runs = runsQ && Array.isArray(runsQ.rows) ? runsQ.rows : [];
  out.scanned = runs.length;

  for (const run of runs) {
    try {
      const taskQ = await dbPool.query(
        `SELECT id, status, title, description, payload, pr_url FROM tasks WHERE id = $1`,
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

      const short = shortId(task.id);

      // ─── headed 分支：ssh+tmux 存活检测 + 收窗幂等 ────────────────────────
      if (run.orchestrator_host === 'skill-relay-codex-headed') {
        const { needsRefire } = await _handleHeadedRun(run, task, { dbPool, execFn, short });
        if (needsRefire) {
          // session 消失 → 重点火（走 spawnFn，即 headed 路径）
          const spawnFn = deps.spawnFn
            || (await import('./harness-skill-relay.js')).spawnSkillRelaySession;
          const r = await spawnFn(task, { pool: dbPool });
          // r?.ok===true（spawnSkillRelaySession 结果）或 r 非 falsy（直接 mock spawnFn 结果）时计 resumed
          if (r?.ok !== false && r) {
            out.resumed++;
            console.log(`[relay-watchdog][headed] 重点火 initiative=${run.initiative_id}`);
          } else {
            console.warn(`[relay-watchdog][headed] 重点火失败 initiative=${run.initiative_id}: ${r?.error}`);
          }
        }
        continue;
      }
      // ─── end headed ────────────────────────────────────────────────────────

      // 在跑容器存活检查（spawn 命名规约 cecelia-relay-<task8>-*）
      let running = '';
      try {
        running = execFn(`docker ps -q --filter "name=cecelia-relay-${short}"`).trim();
      } catch { running = ''; /* docker 不可用时保守跳过（不盲目重点火） */ continue; }
      if (running) continue;

      // PR merge 状态前置检查：容器消失时，先查 PR 是否已 MERGED
      // fallback 链：run.pr_url → tasks.pr_url → task.payload.pr_url
      // 防御：只取经 https://github.com/ 前缀校验的字符串，杜绝 payload JSON blob 注入 shell
      const rawPrUrl = run.pr_url || task.pr_url || task.payload?.pr_url || null;
      const effectivePrUrl = (typeof rawPrUrl === 'string' && rawPrUrl.startsWith('https://github.com/')) ? rawPrUrl : null;
      // MERGED → 直接标 completed/done，不重点火不标 failed
      if (effectivePrUrl) {
        try {
          const ghOut = execFn(`gh pr view "${effectivePrUrl}" --json state`);
          const prState = JSON.parse(ghOut).state;
          if (prState === 'MERGED') {
            await dbPool.query(
              `UPDATE initiative_runs SET phase='done', completed_at=NOW()
                WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
              [run.initiative_id]
            );
            await dbPool.query(
              `UPDATE tasks SET status='completed', completed_at=NOW()
                WHERE id=$1 AND status='in_progress'`,
              [run.initiative_id]
            );
            out.mergedPr++;
            console.log(`[relay-watchdog] PR 已 MERGED → 标 completed initiative=${run.initiative_id} pr=${effectivePrUrl}`);
            continue;
          }
        } catch {
          // gh 不可用或 PR 查询失败 → 保守跳过，不盲目重点火
          console.warn(`[relay-watchdog] gh pr view 失败，initiative=${run.initiative_id} 保守跳过`);
          continue;
        }
      }

      // B6: 上限熔断（codex=2，claude=5）
      const attempts = parseInt(run.attempts, 10) || 0;
      const maxAttempts = run.orchestrator_host === 'skill-relay-codex'
        ? MAX_CODEX_RELAY_ATTEMPTS
        : MAX_RELAY_ATTEMPTS;
      if (attempts >= maxAttempts) {
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

// ─── headed 辅助：tmux 存活检测 + 收窗幂等 ───────────────────────────────────

const HEADED_TMUX_SESSION_PREFIX = 'codex-relay-';
// run done 后多久触发收窗（毫秒）
const HEADED_KILL_AFTER_MS = 30 * 60 * 1000; // 30 分钟

/**
 * 处理 headed run。
 * 返回 { needsRefire: boolean } 告知调用方是否需要重点火。
 *
 * 逻辑：
 * 1. run phase=done + tmux_killed_at 已有 → 幂等跳过
 * 2. run phase=done + completed_at 超 30min + tmux_killed_at 为空 → kill-session + 写 tmux_killed_at
 * 3. run phase=A_planning → ssh tmux has-session 检查（fail-open on ssh 连接失败）
 *    - ssh 本身失败（连接错误/超时）→ fail-open，不重点火
 *    - session 消失（exit 非零，status=1）→ 返回 { needsRefire: true }
 *    - session 存在 → 正常，不重点火
 */
async function _handleHeadedRun(run, task, { dbPool, execFn, short }) {
  const tmuxSession = `${HEADED_TMUX_SESSION_PREFIX}${short}`;
  const sshHost = task.payload?.ssh_host || process.env.HEADED_SSH_HOST || 'localhost';

  // 收窗逻辑：run done
  if (run.phase === 'done') {
    // 幂等：已收窗跳过
    if (run.tmux_killed_at) {
      return { needsRefire: false };
    }
    const completedAt = run.completed_at ? new Date(run.completed_at).getTime() : 0;
    if (completedAt && Date.now() - completedAt > HEADED_KILL_AFTER_MS) {
      // 触发收窗（ssh 失败 fail-open 不阻塞 tmux_killed_at 写入）
      try {
        execFn(`ssh ${sshHost} "tmux kill-session -t ${tmuxSession}"`);
        console.log(`[relay-watchdog][headed] 收窗 kill-session: session=${tmuxSession} initiative=${run.initiative_id}`);
      } catch (err) {
        console.warn(`[relay-watchdog][headed] kill-session ssh 失败（fail-open）: ${err.message}`);
      }
      // 写 tmux_killed_at（幂等标）
      await dbPool.query(
        `UPDATE initiative_runs SET tmux_killed_at=NOW()
          WHERE initiative_id=$1 AND orchestrator_version='v2' AND tmux_killed_at IS NULL`,
        [run.initiative_id]
      );
      console.log(`[relay-watchdog][headed] tmux_killed_at 已写入 initiative=${run.initiative_id}`);
    }
    return { needsRefire: false };
  }

  // 存活检测：A_planning 阶段 → ssh tmux has-session（fail-open on ssh 连接错误）
  if (run.phase === 'A_planning') {
    try {
      execFn(`ssh ${sshHost} "tmux has-session -t ${tmuxSession}"`);
      // exit 0 → session 存在，正常
      return { needsRefire: false };
    } catch (err) {
      // 区分 ssh 连接失败（fail-open）vs tmux session 消失（触发重点火）
      const isSshFailure = err.message?.includes('Connection refused')
        || err.message?.includes('connection refused')
        || err.message?.includes('timed out')
        || err.message?.includes('ETIMEDOUT')
        || err.code === 'ETIMEDOUT'
        || err.code === 'ECONNREFUSED';
      if (isSshFailure) {
        // ssh 本身失败：fail-open，跳过（不重点火）
        console.warn(`[relay-watchdog][headed] ssh 失败 fail-open，initiative=${run.initiative_id}: ${err.message}`);
        return { needsRefire: false };
      }
      // session 消失（tmux has-session exit 1）→ 需要重点火
      console.log(`[relay-watchdog][headed] session 消失，触发重点火 initiative=${run.initiative_id}`);
      return { needsRefire: true };
    }
  }

  return { needsRefire: false };
}

// ─── end headed ──────────────────────────────────────────────────────────────

/**
 * B8 — 8h 逾期 scanStuckHarness 收尸（orchestrator_host='skill-relay-codex'）。
 * 扫描 deadline_at < NOW() 且 orchestrator_host='skill-relay-codex' 的 initiative_runs，
 * 标 phase='failed', failure_reason='relay_deadline_exceeded' 并更新关联 task status='failed'。
 */
export async function scanStuckHarness(opts = {}) {
  const dbPool = opts.pool || pool;

  const overdueQ = await dbPool.query(
    `SELECT id, initiative_id, orchestrator_host, phase, deadline_at
       FROM initiative_runs
      WHERE orchestrator_host = 'skill-relay-codex'
        AND deadline_at < NOW()
        AND phase NOT IN ('done', 'failed')
        AND completed_at IS NULL
      LIMIT 50`
  );

  const rows = overdueQ?.rows ?? [];
  for (const row of rows) {
    try {
      await dbPool.query(
        `UPDATE initiative_runs
            SET phase = 'failed',
                failure_reason = $2,
                completed_at = NOW()
          WHERE id = $1`,
        [row.id, 'relay_deadline_exceeded']
      );
      await dbPool.query(
        `UPDATE tasks SET status = 'failed', completed_at = NOW()
          WHERE id = $1 AND status NOT IN ('completed', 'cancelled', 'canceled')`,
        [row.initiative_id]
      );
      console.warn(`[relay-watchdog] scanStuckHarness: overdue codex run id=${row.id} initiative=${row.initiative_id} deadline=${row.deadline_at}`);
    } catch (err) {
      console.error(`[relay-watchdog] scanStuckHarness cleanup failed for run ${row.id}: ${err.message}`);
    }
  }
}
