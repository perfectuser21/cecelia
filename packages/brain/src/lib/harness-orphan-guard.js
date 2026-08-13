/**
 * harness-orphan-guard.js — harness 执行体生存守卫(守卫补链刀,2026-07-19)
 *
 * 背景(2026-07-18 夜实弹):两个 relay 容器退出(exit 0/1)、callback 都回到了 Brain,
 * 但任务卡 in_progress 2.5h 无人收——zombie-reaper 对 harness_* 全豁免,
 * callback 侧只 ack 不管任务状态,心跳链(phase-event)实测从未 fire。
 *
 * 本守卫补三条链:
 *   1) handleRelayExitConsistency — callback 收到容器退出且任务非终态 → requeue(带封顶)
 *   2) sweepOrphanHarnessTasks    — 定时兜底:in_progress harness 任务无活容器且无新鲜心跳 → requeue
 *   3) WAIT_SUICIDE_PATTERN       — "结束发言等通知"自杀措辞检测,标记计数(病族遥测)
 *
 * 原则:
 *   - requeue 封顶 3 次(payload.orphan_requeue_count),超限转 failed 防死循环
 *   - 判活 fail-open:docker 查询失败一律不动(宁漏给下轮,不误杀活人)
 *   - 只动 status='in_progress' 的行(UPDATE 带条件守卫,防与正常回写竞态)
 */

import { execSync } from 'child_process';
import defaultPool from '../db.js';
import {
  assessKernelLiveness,
  isKernelRuntimeTask,
  latestKernelHeartbeatMs,
} from './kernel-liveness.js';
import {
  finalizeKernelRun,
  reconcileKernelTaskTerminal,
} from '../orchestrator/kernel-run-store.js';
import { terminalizeRunsForTask, ORPHAN_RUN_FAILURE_REASON } from './harness-run-guard.js';
import { reconcileOwnerlessKernelRuns } from '../orchestrator/kernel-controller-lifecycle.js';
import { captureRelayForensicsByShortId } from './relay-forensics.js';

export const WAIT_SUICIDE_PATTERN = /等\s*(?:待)?.{0,10}(?:Monitor|监控|通知)|waiting\s+for\s+.{0,12}(?:Monitor|notification|CI\b)/i;

const MAX_ORPHAN_REQUEUES = 3;

function shortIdOf(taskOrContainerId) {
  if (typeof taskOrContainerId === 'string') {
    const m = taskOrContainerId.match(/^cecelia-relay-([a-f0-9]{8})-/);
    return m ? m[1] : null;
  }
  return String(taskOrContainerId.id || '').replace(/-/g, '').slice(0, 8) || null;
}

function defaultExecFn(cmd) {
  return execSync(cmd, { encoding: 'utf8', timeout: 10000 });
}

/** 该 initiative 是否还有活容器(可排除某个正在退出的容器名)。抛错=判活失败,由调用方 fail-open。 */
export function findLiveRelayContainers(execFn, shortId, excludeName = null) {
  const out = execFn(`docker ps --format '{{.Names}}' --filter name=cecelia-relay-${shortId}`) || '';
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((n) => n !== excludeName);
}

/**
 * 心跳新鲜度(第二信号)。两代运行时的心跳取 max —— 任一信号新鲜即视为活:
 *   - 旧 relay：initiative_run_events.ts / ts_end
 *   - Kernel v1：initiative_runs.orchestrator_heartbeat_at（orchestrator 全目录
 *     对 initiative_run_events 零引用，只看旧表必然误判死）
 * 单边查询失败不代表死亡，继续看另一边;两边都没有才按不新鲜处理,交给容器判活兜。
 */
async function hasFreshHeartbeat(pool, initiativeId, idleMinutes, task = null) {
  let lastHbMs = 0;
  try {
    const { rows } = await pool.query(
      `SELECT GREATEST(COALESCE(MAX(ts), 0), COALESCE(MAX(ts_end), 0)) AS last_hb
       FROM initiative_run_events WHERE initiative_id = $1::uuid`,
      [initiativeId]
    );
    const lastHb = Number(rows?.[0]?.last_hb || 0);
    if (lastHb > 0) lastHbMs = lastHb * 1000;
  } catch {
    /* 单信号失败 → 继续看 kernel 心跳 */
  }
  if (isKernelRuntimeTask(task)) {
    try {
      const kernelMs = await latestKernelHeartbeatMs({ pool, task });
      if (kernelMs && kernelMs > lastHbMs) lastHbMs = kernelMs;
    } catch {
      /* fail-open：拿不到不代表死 */
    }
  }
  return lastHbMs > 0 && Date.now() - lastHbMs < idleMinutes * 60 * 1000;
}

async function reconcileKernelOrphan(pool, task, {
  assessKernel,
  reconcileKernelTerminal,
  finalizeRun,
}) {
  if (!isKernelRuntimeTask(task)) return { handled: false };

  try {
    const r = await assessKernel({ pool, task });
    if (r?.verdict === 'alive') {
      console.warn(
        `[orphan-guard][kernel-v1] task=${task.id} 判活=alive(${r?.reason ?? '-'}) → 持有`
      );
      return { handled: true, action: 'held' };
    }
    if (r?.verdict === 'unknown' && r?.reason === 'no_kernel_run') {
      const terminal = await reconcileKernelTerminal(
        pool,
        task.id,
        { finalizeRun },
      );
      if (terminal.reconciled) {
        console.warn(
          `[orphan-guard][kernel-v1] task=${task.id} 已按 linked run=${terminal.runId} 对账终态`
        );
        return { handled: true, action: 'reconciled', ...terminal };
      }
      console.warn(
        `[orphan-guard][kernel-v1] task=${task.id} 无 active/terminal linked run → unresolved`
      );
      return { handled: true, action: 'unresolved', reason: terminal.reason };
    }
    if (r?.verdict === 'unknown') {
      console.warn(
        `[orphan-guard][kernel-v1] task=${task.id} 判活=unknown(${r?.reason ?? '-'}) → 持有`
      );
      return { handled: true, action: 'held' };
    }
    if (r?.verdict === 'dead') {
      if (!r.runId) {
        console.warn(
          `[orphan-guard][kernel-v1] task=${task.id} dead 但缺 runId → unresolved`
        );
        return { handled: true, action: 'unresolved', reason: 'dead_without_run_id' };
      }
      await finalizeRun(pool, {
        runId: r.runId,
        expectedTaskId: task.id,
        outcome: 'failed',
        reason: `kernel_orphan_dead:${r.reason ?? 'unknown'}`,
      });
      console.warn(
        `[orphan-guard][kernel-v1] task=${task.id} run=${r.runId} 已原子 failed`
      );
      return { handled: true, action: 'failed', runId: r.runId };
    }
  } catch (err) {
    console.warn(`[orphan-guard][kernel-v1] task=${task.id} 判活异常,fail-open: ${err.message}`);
    return { handled: true, action: 'held', reason: `probe_error:${err.message}` };
  }
  return { handled: false };
}

/**
 * generator 已经创建 PR，但退出前没来得及把 generator_done 写回 task 时，
 * 以 initiative_runs.pr_url 为持久证据补齐交接，避免把有效交付误判为裸孤儿。
 */
async function reconcileGeneratedPrEvidence(pool, taskId) {
  const { rows } = await pool.query(
    `WITH latest_run AS (
       SELECT id, pr_url
       FROM initiative_runs
       WHERE current_task_id = $1
       ORDER BY started_at DESC NULLS LAST, id DESC
       LIMIT 1
     ),
     pr_evidence AS (
       SELECT pr_url
       FROM latest_run
       WHERE pr_url IS NOT NULL
         AND BTRIM(pr_url) <> ''
     )
     UPDATE tasks AS t
     SET pr_url = pr_evidence.pr_url,
         payload = COALESCE(t.payload, '{}'::jsonb)
                   || jsonb_build_object(
                        'generator_done', true,
                        'generator_done_at', NOW()::text,
                        'pr_url', pr_evidence.pr_url
                      ),
         updated_at = NOW()
     FROM pr_evidence
     WHERE t.id = $1
       AND t.status = 'in_progress'
     RETURNING t.id, t.pr_url`,
    [taskId],
  );
  return rows?.[0]?.pr_url ? rows[0] : null;
}

/**
 * 带封顶的孤儿 requeue。返回 {action: 'requeued'|'failed'|'deferred'}
 *
 * 死锁解(2026-08-07 W1/W2/W3 全灭):动 tasks 之前先把该 task 名下的非终态
 * initiative_runs 打成 failed。原实现只改 tasks 不碰 run,打回 queued 的任务
 * 被 spawn-guard 按"还有活跃 run"一路拒绝重派,直到 requeue 超限终态 failed。
 * 顺序不可颠倒:先清 run 再回 queued,否则中间会留下"已 queued 但重派必被拒"的窗口。
 *
 * 终态化没成功就整轮不动(deferred):照样 requeue 等于亲手把死锁再造一遍——
 * task 回 queued、run 还活着、spawn-guard 继续拒,白烧一次 requeue 额度;
 * 照样转 failed 则把悬空活跃 run 留在终态任务上。任务留在 in_progress 是安全态,
 * 下一轮 sweep(5 分钟)会重试。
 */
export async function requeueOrphanTask(pool, task, reason, extraPayloadJson = '{}') {
  const cleared = await terminalizeRunsForTask(pool, task.id, ORPHAN_RUN_FAILURE_REASON);
  if (!cleared.ok) {
    console.warn(
      `[orphan-guard] task=${task.id} 残留 run 清不掉,本轮不动(留 in_progress 给下轮 sweep): ${reason}`
    );
    return { action: 'deferred', reason: 'run_terminalize_failed' };
  }

  const count = Number(task.payload?.orphan_requeue_count || 0);
  if (count >= MAX_ORPHAN_REQUEUES) {
    await pool.query(
      `UPDATE tasks
       SET status = 'failed',
           error_message = $1,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND status = 'in_progress'`,
      [`[orphan-guard] requeue 超限(${count}次),终态 failed: ${reason}`, task.id]
    );
    console.warn(`[orphan-guard] task=${task.id} requeue 超限 → failed (${reason})`);
    return { action: 'failed' };
  }
  await pool.query(
    `UPDATE tasks
     SET status = 'queued',
         claimed_by = NULL,
         claimed_at = NULL,
         payload = COALESCE(payload, '{}'::jsonb)
                   || jsonb_build_object('orphan_requeue_count', $1::int, 'run_status', null)
                   || $2::jsonb,
         updated_at = NOW()
     WHERE id = $3 AND status = 'in_progress'`,
    [count + 1, extraPayloadJson, task.id]
  );
  console.warn(`[orphan-guard] task=${task.id} requeued (第${count + 1}次, ${reason})`);
  return { action: 'requeued' };
}

/**
 * 件①:callback 一致性闸。容器退出回调到达时校验任务终态。
 * 返回 {action: 'noop'|'reconciled'|'requeued'|'failed', suicide?: boolean}。
 * 全程不抛(供 callback 路由 best-effort 调用)。
 */
export async function handleRelayExitConsistency({
  pool, execFn = defaultExecFn, containerId, exitCode, resultText = '',
  assessKernel = assessKernelLiveness,
  reconcileKernelTerminal = reconcileKernelTaskTerminal,
  finalizeRun = finalizeKernelRun,
}) {
  try {
    const shortId = shortIdOf(containerId);
    if (!shortId) return { action: 'noop' };

    const { rows } = await pool.query(
      `SELECT id, status, task_type, payload FROM tasks
       WHERE REPLACE(id::text, '-', '') LIKE $1 LIMIT 1`,
      [`${shortId}%`]
    );
    const task = rows[0];
    if (!task || task.status !== 'in_progress') return { action: 'noop' };
    // 收权分界(终审必修):generator_done=true 即 PR 已开,收口归 harness-relay-watchdog
    // (它有 PR 态感知:MERGED→finalize/OPEN+绿→静等/红→重点火);本闸只收开 PR 前的裸孤儿。
    if (task.payload?.generator_done === true) return { action: 'noop' };

    const generatedPr = await reconcileGeneratedPrEvidence(pool, task.id);
    if (generatedPr) {
      console.warn(`[orphan-guard] task=${task.id} 从 run.pr_url 补齐 generator_done`);
      return {
        action: 'noop',
        reason: 'generated_pr_reconciled',
        prUrl: generatedPr.pr_url,
      };
    }

    let live;
    try {
      live = findLiveRelayContainers(execFn, shortId, containerId);
    } catch (err) {
      console.warn(`[orphan-guard] docker 判活失败,fail-open: ${err.message}`);
      return { action: 'noop' };
    }
    if (live.length > 0) return { action: 'noop' }; // 还有别的执行体在干,别抢

    const kernel = await reconcileKernelOrphan(pool, task, {
      assessKernel,
      reconcileKernelTerminal,
      finalizeRun,
    });
    if (kernel.handled) {
      if (kernel.action === 'failed') return { action: 'failed' };
      if (kernel.action === 'reconciled') return { action: 'reconciled' };
      return { action: 'noop' };
    }

    const suicide = WAIT_SUICIDE_PATTERN.test(resultText || '');
    const extra = suicide
      ? JSON.stringify({ wait_suicide_count: Number(task.payload?.wait_suicide_count || 0) + 1 })
      : '{}';
    const r = await requeueOrphanTask(
      pool, task,
      suicide ? `callback-exit-wait-suicide(exit=${exitCode})` : `callback-exit-nonterminal(exit=${exitCode})`,
      extra
    );
    return { ...r, suicide };
  } catch (err) {
    console.error(`[orphan-guard] handleRelayExitConsistency 异常(不影响 ack): ${err.message}`);
    return { action: 'noop' };
  }
}

/**
 * 件②:定时兜底扫描(callback 丢失时的保险带)。
 * in_progress 的 harness% 任务,idle 超阈值 + 无活容器 + 无新鲜心跳 → requeue(同封顶)。
 */
export async function sweepOrphanHarnessTasks({
  pool, execFn = defaultExecFn, idleMinutes = 15, assessKernel = assessKernelLiveness,
  reconcileKernelTerminal = reconcileKernelTaskTerminal,
  finalizeRun = finalizeKernelRun,
} = {}) {
  const result = {
    scanned: 0,
    requeued: 0,
    failed: 0,
    deferred: 0,
    kernelHeld: 0,
    terminalReconciled: 0,
    kernelUnresolved: 0,
    prHandoffs: 0,
    errors: [],
  };
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, title, status, payload,
              COALESCE(payload->>'initiative_id', id::text) AS initiative_id
       FROM tasks
       WHERE status = 'in_progress'
         AND (
           task_type LIKE 'harness%'
           OR task_type = 'golden_path_proposal'
         )
         AND COALESCE(payload->>'generator_done', 'false') <> 'true'
         AND updated_at < NOW() - INTERVAL '${Number(idleMinutes)} minutes'
       ORDER BY updated_at ASC
       LIMIT 50`
    ));
  } catch (err) {
    result.errors.push(`SELECT: ${err.message}`);
    return result;
  }
  result.scanned = rows.length;

  for (const task of rows) {
    try {
      const shortId = shortIdOf(task);
      if (!shortId) continue;
      let live;
      try {
        live = findLiveRelayContainers(execFn, shortId);
      } catch {
        continue; // fail-open
      }
      if (live.length > 0) continue;
      const generatedPr = await reconcileGeneratedPrEvidence(pool, task.id);
      if (generatedPr) {
        result.prHandoffs++;
        continue;
      }
      const kernel = await reconcileKernelOrphan(pool, task, {
        assessKernel,
        reconcileKernelTerminal,
        finalizeRun,
      });
      if (kernel.handled) {
        if (kernel.action === 'failed') result.failed++;
        else if (kernel.action === 'reconciled') result.terminalReconciled++;
        else if (kernel.action === 'unresolved') result.kernelUnresolved++;
        else result.kernelHeld++;
        continue;
      }
      if (await hasFreshHeartbeat(pool, task.initiative_id || task.id, idleMinutes, task)) continue;
      // 容器死得连回调都没发出来时(如直接吃 SIGKILL),这里是抢在 janitor prune 之前
      // 保全 docker logs 的最后机会。容器已被 prune 则拿不到,best-effort 不影响收割。
      await captureRelayForensicsByShortId({ shortId, execFn });
      const r = await requeueOrphanTask(pool, task, `sweep-orphan(idle>${idleMinutes}min,无活容器)`);
      if (r.action === 'requeued') result.requeued++;
      else if (r.action === 'deferred') result.deferred++;
      else result.failed++;
    } catch (err) {
      result.errors.push(`task ${task.id}: ${err.message}`);
    }
  }
  if (result.scanned > 0) {
    console.log(
      `[orphan-guard] sweep done: scanned=${result.scanned}`
      + ` requeued=${result.requeued} failed=${result.failed}`
      + ` deferred=${result.deferred}`
      + ` kernelHeld=${result.kernelHeld}`
      + ` terminalReconciled=${result.terminalReconciled}`
      + ` kernelUnresolved=${result.kernelUnresolved}`
      + ` prHandoffs=${result.prHandoffs}`
    );
  }
  return result;
}

/** 定时器(与 zombie-reaper 同节奏 5 分钟,由 server.js 启动)。 */
export async function startHarnessOrphanGuard({
  pool = defaultPool,
  execFn = defaultExecFn,
  idleMinutes = 15,
  intervalMs = 5 * 60 * 1000,
  reconcileOwnerless = reconcileOwnerlessKernelRuns,
} = {}) {
  // 启动首轮是接流量前的安全闸；timer 仅为后备巡检。
  const timer = setInterval(async () => {
    try {
      await sweepOrphanHarnessTasks({ pool, execFn, idleMinutes });
    } catch (err) {
      console.error('[orphan-guard] sweep 异常:', err.message);
    }
    // Session Controller 生命周期恢复（sprint 08131104）：无主 Kernel Run（Controller fatal /
    // lease 过期 / 迁移前无主历史 run）fail-closed 进恢复，绝不静默放行。与孤儿巡检同节奏。
    try {
      const recovered = await reconcileOwnerless(pool);
      if (recovered.length > 0) {
        console.log(`[orphan-guard] ownerless kernel runs recovered=${recovered.length}`);
      }
    } catch (err) {
      console.error('[orphan-guard] ownerless-run 恢复异常:', err.message);
    }
  }, intervalMs);
  if (timer.unref) timer.unref();
  try {
    const initialRecovered = await reconcileOwnerless(pool);
    if (initialRecovered.length > 0) {
      console.log(`[orphan-guard] startup ownerless kernel runs recovered=${initialRecovered.length}`);
    }
  } catch (error) {
    // server listener 前已有一次硬闸；这里失败仍保留周期后备，避免永久失去巡检。
    console.error('[orphan-guard] startup ownerless-run 恢复异常:', error.message);
  }
  console.log(`[orphan-guard] started (interval=${intervalMs}ms, idle=${idleMinutes}min)`);
  return timer;
}
